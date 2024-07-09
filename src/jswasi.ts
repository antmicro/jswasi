import * as constants from "./constants.js";
import ProcessManager, { DescriptorEntry } from "./process-manager.js";
import { FdTable, DEFAULT_ENV, DEFAULT_WORK_DIR } from "./process-manager.js";
import { TopLevelFs } from "./filesystem/top-level-fs.js";
import { createDeviceFilesystem, DeviceFilesystem } from "./filesystem/virtual-filesystem/devices/device-filesystem.js";
import { ProcFilesystem } from "./filesystem/proc-filesystem/proc-filesystem.js";
import {
  DriverManager,
  major,
} from "./filesystem/virtual-filesystem/devices/driver-manager.js";
import { printk } from "./utils.js";
// @ts-ignore
import untar from "./third_party/js-untar.js";
import { HtermDeviceDriver } from "./filesystem/virtual-filesystem/terminals/hterm-terminal.js";
import { JsInterface } from "./js-interface.js";

declare global {
  interface Window {
    logOutput: boolean;
    stdoutAttached: boolean;
    buffer: string;
  }
}

export class Jswasi {
  private processManager: ProcessManager;
  private topLevelFs: TopLevelFs;
  private driverManager: DriverManager;
  private deviceFilesystem: DeviceFilesystem;
  private devFsPromise: Promise<void>;
  public jsInterface: JsInterface;

  private __printk(msg: string) {
    try {
      const term = (this.driverManager.getDriver(major.MAJ_HTERM) as HtermDeviceDriver).terminals[0].terminal
      term.io.println(printk(msg));
    } catch (_) {}
  }

  constructor() {
    this.driverManager = new DriverManager();
    this.topLevelFs = new TopLevelFs();
    this.processManager = new ProcessManager("process.js", this.topLevelFs, this.driverManager);
    this.devFsPromise = createDeviceFilesystem(this.driverManager, this.processManager).then(devfs => {
      this.deviceFilesystem = devfs;
    });
    this.jsInterface = new JsInterface();
  }

  public async attachDevice(device: Object, major: major): Promise<number> {
    await this.devFsPromise;
    return this.driverManager.attachDevice(device, major);
  }

  public async tearDown(println: (a: string) => void) {
    println("Starting purge...");
    const handle = await navigator.storage.getDirectory();

    println("Cleaning storage...");
    // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
    // @ts-ignore
    for await (const name of handle.keys()) {
      println(`Removing ${name}...`);
      await handle.removeEntry(name, { recursive: true });
    }

    println("Cleaning metadata...");
    await new Promise((resolve) => {
      window.indexedDB.databases().then((r) => {
        Promise.all(
          r.map((database) => {
            window.indexedDB.deleteDatabase(database.name);
          })
        ).then(resolve);
      });
    });
    println("Purge complete");
  }

  public async init(config?: KernelConfig): Promise<void> {
    await this.devFsPromise;

    if (!navigator.storage.getDirectory) {
      this.__printk(
        "Your browser doesn't support File System Access API yet."
      );
      this.__printk("We recommend using Chrome for the time being.");
      return;
    }

    this.__printk('Registering service worker');
    if (!(await initServiceWorker())) {
      this.__printk("Service Worker registration failed");
      return;
    }

    // If SharedArrayBuffer is undefined then most likely, the service
    // worker has not yet reloaded the page. In such case, stop further
    // execution so that it is not abruptly interrupted by the page being
    // reloaded.
    if (typeof SharedArrayBuffer === 'undefined') {
      this.__printk("SharedArrayBuffer undefined, reloading page");
      // On chromium, window.location.reload sometimes does not work.
      window.location.href = window.location.href;
      return;
    }
    if (config == undefined) {
      this.__printk('Reading kernel config');
      config = await getKernelConfig(this.topLevelFs);
    }

    if (
      (await mountRootfs(this.topLevelFs, config.mountConfig)) !==
      constants.WASI_ESUCCESS
    ) {
      this.__printk("Failed to mount root filesystem");
    }

    // If the init system is present in the filesystem, assume that the rootfs
    // is already initialized
    this.__printk("Reading init system");
    const { err } = await this.topLevelFs.open(
      config.init,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
    );

    if (err !== constants.WASI_ESUCCESS) {
      this.__printk('Init system not present');
      this.__printk('Starting rootfs initialization');
      // Use the default rootfs if it is not defined in the kernel config
      let __rootfs = config.rootfs;
      if (__rootfs === undefined) {
        this.__printk('Rootfs image not configured in kernel config, using default');
        __rootfs = "https://antmicro.github.io/jswasi-rootfs/rootfs.tar.gz";
      }

      const rootfsTarResponse = await fetch(__rootfs);
      const contentEncoding = rootfsTarResponse.headers.get("Content-Encoding");
      let tarStream = rootfsTarResponse.body;

      if (contentEncoding === "gzip") {
        tarStream = gunzip(tarStream);
      } else if (!contentEncoding) {
        const contentType = rootfsTarResponse.headers.get("Content-Type");
        if (contentType === "application/gzip" || contentType === "application/x-gzip")
          tarStream = gunzip(tarStream);
      }

      if (err === constants.WASI_ENOTRECOVERABLE) {
        this.__printk('Root filesystem corrupted, attempting recovery mode');
        this.topLevelFs.removeMount("/");
        const conf = RECOVERY_MOUNT_CONFIG;

        // If there is an error, nothing can be done
        await mountRootfs(this.topLevelFs, conf);
        this.__printk('VirtualFilesystem mounted on /');

        await initFs(this.topLevelFs, await new Response(tarStream).arrayBuffer());
        await recoveryMotd(this.topLevelFs);
      } else {
        await initFs(this.topLevelFs, await new Response(tarStream).arrayBuffer());
      }
      this.__printk('Rootfs initialized');
    }

    await this.topLevelFs.createDir("/dev");
    this.__printk('Mounting device filesystem');
    await this.topLevelFs.addMountFs(
      "/dev",
      this.deviceFilesystem 
    );

    await this.topLevelFs.createDir("/proc");
    this.__printk('Mounting proc filesystem');
    await this.topLevelFs.addMountFs("/proc", new ProcFilesystem(this.processManager));

    await this.topLevelFs.createDir("/tmp");
    this.__printk('Mounting temp filesystem');
    await this.topLevelFs.addMount(undefined, "", undefined, "/tmp", "vfs", 0n, {});

    let res = await this.topLevelFs.open("/");
    if (res.err) {
      this.__printk("Could not open root file descriptor for the init system");
      return;
    }
    this.__printk('Starting init');
    await this.processManager.spawnProcess(
      null, // parent_id
      null, // parent_lock
      config.init,
      new FdTable({
        3: new DescriptorEntry(res.desc),
      }),
      config.initArgs,
      DEFAULT_ENV,
      false,
      DEFAULT_WORK_DIR,
      { maj: major.MAJ_HTERM, min: 0 } // TODO: this should not be hardcoded
    );
  }
}

const INIT_FSA_ID = "fsa0";
const BOOT_KERNEL_CONFIG_PATH = "/config.json";

const RECOVERY_MOUNT_CONFIG: MountConfig = {
  fsType: "vfs",
  opts: {},
};

async function recoveryMotd(tfs: TopLevelFs) {
  const { err, desc } = await tfs.open(
    "/etc/motd",
    constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
    constants.WASI_O_CREAT | constants.WASI_O_TRUNC
  );
  if (err !== constants.WASI_ESUCCESS) return;

  await desc.write(
    new TextEncoder().encode(
      "\n[WARNING] Could not mount filesystem, volatile filesystem used as root for recovery\n"
    )
  );

  await desc.close();
}

async function fetchFile(
  fs: TopLevelFs,
  filename: string,
  address: string,
  refetch: boolean = true
): Promise<number> {
  const { err, desc } = await fs.open(
    filename,
    constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
    constants.WASI_O_CREAT
  );
  if (err !== constants.WASI_ESUCCESS) {
    console.warn(`Unable to resolve path for ${filename}`);
    return err;
  }

  // only fetch binary if not yet present
  if (refetch || (await desc.getFilestat()).filestat.size === 0n) {
    await desc.truncate(0n);
    const response = await fetch(address);
    if (response.status != 200) {
      return constants.WASI_ENOENT;
    } else {
      const { err, stream } = await desc.writableStream();
      if (err != constants.WASI_ESUCCESS) {
        return err;
      }
      await response.body?.pipeTo(stream);
    }
  }

  await desc.close();
  return constants.WASI_ESUCCESS;
}

const enum TAR_FILETYPE {
  FILE = "0",
  LINK = "1",
  SYMLINK = "2",
  CHRDEV = "3",
  BLKDEV = "4",
  DIRECTORY = "5",
  FIFO = "6",
}

function gunzip(tarStream: ReadableStream): ReadableStream {
  // @ts-ignore
  const stream = new DecompressionStream("gzip");
  return tarStream.pipeThrough(stream);
}

// setup filesystem
async function initFs(fs: TopLevelFs, tar: ArrayBuffer) {
  const untared = await untar(tar);

  for (const entry of untared) {
    switch (entry.type) {
      case "":
      case TAR_FILETYPE.FILE: {
        let { err, desc } = await fs.open(
          entry.name, 0, constants.WASI_O_CREAT);

        if (err !== constants.WASI_ESUCCESS)
          throw Error("Corrupted rootfs image");

        const stream = (await desc.writableStream()).stream;
        await entry.blob.stream().pipeTo(stream);

        await desc.close();
        break;
      }
      case TAR_FILETYPE.DIRECTORY: {
        const err = await fs.createDir(entry.name)
        if (err !== constants.WASI_ESUCCESS)
          throw Error("Corrupted rootfs image");

        break;
      }
      case TAR_FILETYPE.SYMLINK: {
        if ((await fs.addSymlink(entry.linkname, entry.name) !== constants.WASI_ESUCCESS))
          throw Error("Corrupted rootfs image");

        break;
      }
    }
  }
}

function initServiceWorker(): Promise<boolean> {
  return new Promise(resolve => {
    navigator.serviceWorker.register("service-worker.js").then(
      registration => {
        if (registration !== undefined) {
          registration.onupdatefound = () => resolve(true);

          if (registration.active)
            resolve(true);
        };
      },
      _ => resolve(false),
    );
  });
}

type KernelConfig = {
  init: string;
  initArgs: string[];
  rootfs: string;
  mountConfig: MountConfig;
};

type MountConfig = {
  fsType: string;
  opts: any;
};

async function getKernelConfig(tfs: TopLevelFs): Promise<KernelConfig> {
  await tfs.addMount(undefined, "", undefined, "/", "fsa", 0n, {
    name: INIT_FSA_ID,
    create: "true",
    keepMetadata: "false",
  });

  let kernelConfig: KernelConfig;

  const { err, desc } = await tfs.open(BOOT_KERNEL_CONFIG_PATH);
  if (err === constants.WASI_ESUCCESS) {
    let { err, content } = await desc.read_str();
    if (err === constants.WASI_ESUCCESS) {
      try {
        kernelConfig = JSON.parse(content);
      } catch (_) {}
    }
    await desc.close();
  } else {
    await fetchFile(tfs, BOOT_KERNEL_CONFIG_PATH, "resources/config.json");

    const { desc } = await tfs.open(BOOT_KERNEL_CONFIG_PATH);
    const { content } = await desc.read_str();
    kernelConfig = JSON.parse(content);
  }
  tfs.removeMount("/");

  return kernelConfig;
}

function mountRootfs(
  tfs: TopLevelFs,
  mountConfig: MountConfig
): Promise<number> {
  return tfs.addMount(
    undefined,
    "",
    undefined,
    "/",
    mountConfig.fsType,
    0n,
    mountConfig.opts
  );
}
