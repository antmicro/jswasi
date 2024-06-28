import * as constants from "./constants.js";
import ProcessManager, { DescriptorEntry } from "./process-manager.js";
import { FdTable, DEFAULT_ENV, DEFAULT_WORK_DIR } from "./process-manager.js";
import { TopLevelFs } from "./filesystem/top-level-fs.js";
import { createDeviceFilesystem } from "./filesystem/virtual-filesystem/device-filesystem.js";
import { ProcFilesystem } from "./filesystem/proc-filesystem/proc-filesystem.js";
import {
  DriverManager,
  major,
} from "./filesystem/virtual-filesystem/driver-manager.js";
import { printk } from "./utils.js";
// @ts-ignore
import untar from "./third_party/js-untar.js";

declare global {
  interface Window {
    logOutput: boolean;
    stdoutAttached: boolean;
    buffer: string;
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

async function getDefaultFdTable(tfs: TopLevelFs): Promise<FdTable> {
  const descs = [
    await tfs.open("/dev/ttyH0", 0, 0, 0, constants.WASI_EXT_RIGHTS_STDIN, 0n),
    await tfs.open(
      "/dev/ttyH0",
      0,
      0,
      constants.WASI_FDFLAG_APPEND,
      constants.WASI_EXT_RIGHTS_STDOUT,
      0n
    ),
    await tfs.open(
      "/dev/ttyH0",
      0,
      0,
      constants.WASI_FDFLAG_APPEND,
      constants.WASI_EXT_RIGHTS_STDERR,
      0n
    ),
    await tfs.open("/"),
  ];

  for (var i = 0; i < descs.length; i++) {
    if (descs[i].err !== constants.WASI_ESUCCESS) {
      throw `Cannot open fd=${i}, error code=${descs[i].err}!`;
    } else if (descs[i] === undefined) {
      throw `Cannot open fd=${i}, descriptor is undefined!`;
    }
  }

  return new FdTable({
    0: new DescriptorEntry(descs[0].desc),
    1: new DescriptorEntry(descs[1].desc),
    2: new DescriptorEntry(descs[2].desc),
    3: new DescriptorEntry(descs[3].desc),
  });
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
  init: string[];
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

// anchor is any HTMLElement that will be used to initialize hterm
// notifyDroppedFileSaved is a callback that get triggers when the shell successfully saves file drag&dropped by the user
// you can use it to customize the behavior
export async function init(terminal: any, config?: KernelConfig): Promise<void> {
  if (!navigator.storage.getDirectory) {
    terminal.io.println(
      "Your browser doesn't support File System Access API yet."
    );
    terminal.io.println("We recommend using Chrome for the time being.");
    return;
  }

  terminal.io.println(printk('Registering service worker'));
  if (!(await initServiceWorker())) {
    terminal.io.println(printk("Service Worker registration failed"));
    return;
  }

  // If SharedArrayBuffer is undefined then most likely, the service
  // worker has not yet reloaded the page. In such case, stop further
  // execution so that it is not abruptly interrupted by the page being
  // reloaded.
  if (typeof SharedArrayBuffer === 'undefined') {
    terminal.io.println(printk("SharedArrayBuffer undefined, reloading page"));
    // On chromium, window.location.reload sometimes does not work.
    window.location.href = window.location.href;
    return;
  }

  const tfs = new TopLevelFs();

  if (config == undefined) {
    terminal.io.println(printk('Reading kernel config'));
    config = await getKernelConfig(tfs);
  }

  if (
    (await mountRootfs(tfs, config.mountConfig)) !==
    constants.WASI_ESUCCESS
  ) {
    terminal.io.println(printk("Failed to mount root filesystem"));
  }

  const driverManager = new DriverManager();
  const processManager = new ProcessManager("process.js", tfs, driverManager);

  // If the init system is present in the filesystem, assume that the rootfs
  // is already initialized
  terminal.io.println(printk("Reading init system"));
  const { err } = await tfs.open(
    config.init[0],
    constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
  );

  if (err !== constants.WASI_ESUCCESS) {
    terminal.io.println(printk('Init system not present'));
    terminal.io.println(printk('Starting rootfs initialization'));
    const rootfsTarResponse = await fetch(config.rootfs);
    const contentEncoding = rootfsTarResponse.headers.get("Content-Encoding");
    let tarStream = rootfsTarResponse.body;

    if (contentEncoding === "gzip") {
      tarStream = gunzip(tarStream);
    } else if (!contentEncoding) {
      const contentType = rootfsTarResponse.headers.get("Content-Type");
      if (contentType === "application/gzip")
        tarStream = gunzip(tarStream);
    }

    if (err === constants.WASI_ENOTRECOVERABLE) {
      terminal.io.println(printk('Root filesystem corrupted, attempting recovery mode'));
      tfs.removeMount("/");
      const conf = RECOVERY_MOUNT_CONFIG;

      // If there is an error, nothing can be done
      await mountRootfs(tfs, conf);
      terminal.io.println(printk('VirtualFilesystem mounted on /'));

      await initFs(tfs, await new Response(tarStream).arrayBuffer());
      await recoveryMotd(tfs);
    } else {
      await initFs(tfs, await new Response(tarStream).arrayBuffer());
    }
    terminal.io.println(printk('Rootfs initialized'));
  }

  await tfs.createDir("/dev");
  terminal.io.println(printk('Mounting device filesystem'));
  await tfs.addMountFs(
    "/dev",
    await createDeviceFilesystem(driverManager, processManager, {
      terminal,
      currentProcessId: 0,
    })
  );

  await tfs.createDir("/proc");
  terminal.io.println(printk('Mounting proc filesystem'));
  await tfs.addMountFs("/proc", new ProcFilesystem(processManager));

  await tfs.createDir("/tmp");
  terminal.io.println(printk('Mounting temp filesystem'));
  await tfs.addMount(undefined, "", undefined, "/tmp", "vfs", 0n, {});

  let fdTable;
  try {
    terminal.io.println(printk('Opening file descriptors for the init system'));
    fdTable = await getDefaultFdTable(tfs);
  } catch (error) {
    terminal.io.println(printk(
      `Cannot create file descriptor table for init process: ${error}`
    ));
    return;
  }

  terminal.io.println(printk('Starting init'));
  await processManager.spawnProcess(
    null, // parent_id
    null, // parent_lock
    "/usr/bin/wash",
    fdTable,
    config.init,
    DEFAULT_ENV,
    false,
    DEFAULT_WORK_DIR,
    { maj: major.MAJ_HTERM, min: 0 } // TODO: this should not be hardcoded
  );
}

export async function tearDown(println: (a: string) => void) {
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
