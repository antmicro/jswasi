import * as constants from "./constants.js";
import ProcessManager, { DescriptorEntry } from "./process-manager.js";
import { FdTable, DEFAULT_ENV, DEFAULT_WORK_DIR } from "./process-manager.js";
import { md5sum } from "./utils.js";
import { getFilesystem, TopLevelFs } from "./filesystem/top-level-fs.js";
import { createDeviceFilesystem } from "./filesystem/virtual-filesystem/device-filesystem.js";
import { ProcFilesystem } from "./filesystem/proc-filesystem/proc-filesystem.js";
import {
  DriverManager,
  major,
} from "./filesystem/virtual-filesystem/driver-manager.js";

declare global {
  interface Window {
    logOutput: boolean;
    stdoutAttached: boolean;
    buffer: string;
  }
}

const INIT_FSA_ID = "fsa0";
const BOOT_KERNEL_CONFIG_PATH = "/config.json";
// binaries which need to be verified
const CHECKSUM_BINARIES = {
  "/usr/bin/wash": ["resources/wash", "resources/wash.md5"],
};
const ALWAYS_FETCH_FILES = {
  "/etc/motd": "resources/motd.txt",
  "/usr/bin/coreutils": "resources/coreutils",
  "/usr/local/bin/wasibox": "resources/wasibox",
};

async function essentialBins(tfs: TopLevelFs): Promise<number[]> {
  // verify if wash and init are up to date and refetch them if they are not
  await tfs.createDir("/usr");
  await tfs.createDir("/usr/bin");
  const checksumPromises = Object.entries(CHECKSUM_BINARIES).map(
    async ([filename, [address, checksum]]) => {
      const file = await tfs.open(filename);
      if (file.err === constants.EXIT_SUCCESS) {
        // 1 << 16 + 1 is a chunk size to read from file, the choice of this number is arbitrary
        let actual_sum = await md5sum(file.desc, 1 << (16 + 1));
        let exp_sum = new TextDecoder().decode(
          (await (await fetch(checksum)).arrayBuffer()).slice(0, 32)
        );
        if (actual_sum === exp_sum) {
          return constants.WASI_ESUCCESS;
        }
      }
      return fetchFile(tfs, filename, address, true);
    }
  );

  return await Promise.all(checksumPromises);
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

export async function fetchFile(
  fs: TopLevelFs,
  filename: string,
  address: string,
  refetch: boolean = true
): Promise<number> {
  if (
    !(
      !(address.startsWith("http://") || address.startsWith("https://")) ||
      address.startsWith(location.origin)
    )
  ) {
    // files requested from cross-origin that require proxy server
    // this will become obsolete once COEP: credentialless ships to Chrome (https://www.chromestatus.com/feature/4918234241302528)
    address = `proxy/${btoa(unescape(encodeURIComponent(address)))}`;
  }

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

// setup filesystem
async function initFs(fs: TopLevelFs) {
  // top level directories creation
  await Promise.all([
    fs.createDir("/tmp"),
    // TODO: mount memfs on proc once it is ready
    fs.createDir("/proc"),
    fs.createDir("/etc"),
    fs.createDir("/home"),
    fs.createDir("/usr"),
    fs.createDir("/lib"),
    fs.createDir("/dev"),
  ]);

  // 2nd level directories creation
  await Promise.all([
    fs.createDir(DEFAULT_WORK_DIR),
    fs.createDir("/usr/bin"),
    fs.createDir("/usr/local"),
  ]);

  // 3rd level directories/files/symlinks creation
  await Promise.all([
    fs.createDir("/usr/local/bin"),
    fs.createDir(`${DEFAULT_WORK_DIR}/.config`),
  ]);

  // 4th level directories/files/symlinks creation
  await Promise.all([fs.createDir(`${DEFAULT_WORK_DIR}/.config/ox`)]);

  const washRcPromise = (async () => {
    // TODO: this should be moved to shell
    const washrc = await fs.open(
      `${DEFAULT_WORK_DIR}/.washrc`,
      0,
      constants.WASI_O_CREAT
    );
    if ((await washrc.desc.getFilestat()).filestat.size === 0n) {
      await washrc.desc.write(
        new TextEncoder().encode("export RUST_BACKTRACE=full\nexport DEBUG=1")
      );
      await washrc.desc.close();
    }
  })();

  const dummyBinariesPromise = Promise.all([
    fs.open("/usr/bin/wget", 0, constants.WASI_O_CREAT),
    fs.open("/usr/bin/download", 0, constants.WASI_O_CREAT),
    fs.open("/usr/bin/ps", 0, constants.WASI_O_CREAT),
    fs.open("/usr/bin/free", 0, constants.WASI_O_CREAT),
    fs.open("/usr/bin/reset", 0, constants.WASI_O_CREAT),
  ]);

  const symlinkCreationPromise = Promise.all([
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/ls"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/mkdir"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/rmdir"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/touch"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/rm"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/mv"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/cp"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/echo"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/date"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/printf"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/env"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/cat"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/realpath"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/ln"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/printenv"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/md5sum"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/test"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/["),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/wc"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/true"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/false"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/sleep"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/seq"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/head"),
    fs.addSymlink("/usr/bin/coreutils", "/usr/bin/tail"),

    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/unzip"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/hexdump"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/imgcat"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/kill"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/purge"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/tree"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/tar"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/stty"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/mount"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/umount"),
  ]);

  await Promise.all([
    washRcPromise,
    dummyBinariesPromise,
    symlinkCreationPromise,
  ]);

  await Promise.all(
    Object.entries(ALWAYS_FETCH_FILES).map(([filename, address]) =>
      fetchFile(fs, filename, address, true)
    )
  );
}

function initServiceWorker() {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").then(
      () => {
        // Registration was successful
      },
      (err) => {
        // registration failed :(
        console.warn("ServiceWorker registration failed: ", err);
      }
    );
  });
}

type KernelConfig = {
  init: string[];
  mountConfig: MountConfig;
};

type MountConfig = {
  fsType: string;
  opts: any;
};

const RECOVERY_MOUNT_CONFIG: MountConfig = {
  fsType: "vfs",
  opts: {},
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
}

// anchor is any HTMLElement that will be used to initialize hterm
// notifyDroppedFileSaved is a callback that get triggers when the shell successfully saves file drag&dropped by the user
// you can use it to customize the behavior
export async function init(terminal: any): Promise<void> {
  if (!navigator.storage.getDirectory) {
    terminal.io.println(
      "Your browser doesn't support File System Access API yet."
    );
    terminal.io.println("We recommend using Chrome for the time being.");
    return;
  }

  const tfs = new TopLevelFs();
  const kernelConfig = await getKernelConfig(tfs);
  if (
    (await mountRootfs(tfs, kernelConfig.mountConfig)) !==
    constants.WASI_ESUCCESS
  ) {
    terminal.io.println("Failed to mount root filesystem");
  }

  initServiceWorker();
  const driverManager = new DriverManager();
  const processManager = new ProcessManager("process.js", tfs, driverManager);

  // create flag file to indicate that the filesystem was already initiated
  const { err } = await tfs.open(
    "/filesystem-initiated",
    constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
    constants.WASI_O_CREAT | constants.WASI_O_EXCL
  );

  if (err === constants.WASI_ESUCCESS) await initFs(tfs);

  if (
    (await essentialBins(tfs)).some((err) => err !== constants.WASI_ESUCCESS)
  ) {
    tfs.removeMount("/");
    const conf = RECOVERY_MOUNT_CONFIG;

    const __filesystem = await getFilesystem(conf.fsType, conf.opts);

    // If there is an error, nothing can be done
    await tfs.addMountFs("/", __filesystem.filesystem);

    await initFs(tfs);
    await essentialBins(tfs);
    await recoveryMotd(tfs);
  }

  await tfs.createDir("/dev");
  await tfs.addMountFs(
    "/dev",
    await createDeviceFilesystem(driverManager, processManager, {
      terminal,
      currentProcessId: 0,
    })
  );

  await tfs.createDir("/proc");
  await tfs.addMountFs("/proc", new ProcFilesystem(processManager));

  await tfs.createDir("/tmp");
  await tfs.addMount(undefined, "", undefined, "/tmp", "vfs", 0n, {});

  let fdTable;
  try {
    fdTable = await getDefaultFdTable(tfs);
  } catch (error) {
    terminal.io.println(
      `Cannot create file descriptor table for init process: ${error}`
    );
    return;
  }

  await processManager.spawnProcess(
    null, // parent_id
    null, // parent_lock
    "/usr/bin/wash",
    fdTable,
    kernelConfig.init,
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
