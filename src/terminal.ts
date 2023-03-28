import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import { FdTable } from "./process-manager.js";
import syscallCallback from "./syscalls.js";
import { createFsaFilesystem } from "./filesystem/fsa-filesystem.js";
import { Stderr, Stdin, Stdout } from "./devices.js";
import { md5sum } from "./utils.js";
import { TopLevelFs } from "./filesystem/top-level-fs.js";

declare global {
  interface Window {
    logOutput: boolean;
    stdoutAttached: boolean;
    buffer: string;
  }
}

const DEFAULT_WORK_DIR = "/home/ant";

// binaries which need to be verified
const CHECKSUM_BINARIES = {
  "/usr/bin/wash": ["resources/wash.wasm", "resources/wash.md5"],
  "/usr/bin/init": ["resources/init.sh", "resources/init.md5"],
};
const ALWAYS_FETCH_BINARIES = {
  "/etc/motd": "resources/motd.txt",
  "/usr/bin/coreutils": "resources/coreutils.wasm",
};

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
  if (refetch || (await desc.getFilestat()).size === 0n) {
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
    if ((await washrc.desc.getFilestat()).size === 0n) {
      await washrc.desc.write(
        new TextEncoder().encode("export RUST_BACKTRACE=full\nexport DEBUG=1")
      );
      await washrc.desc.close();
    }
  })();

  const dummyBinariesPromise = Promise.all([
    fs.open("/usr/bin/mount", 0, constants.WASI_O_CREAT),
    fs.open("/usr/bin/umount", 0, constants.WASI_O_CREAT),
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

    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/unzip"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/hexdump"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/imgcat"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/purge"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/tree"),
    fs.addSymlink("/usr/local/bin/wasibox", "/usr/local/bin/tar"),
  ]);

  await Promise.all([
    washRcPromise,
    dummyBinariesPromise,
    symlinkCreationPromise,
  ]);

  const alwaysFetchPromises = Object.entries(ALWAYS_FETCH_BINARIES).map(
    ([filename, address]) => fetchFile(fs, filename, address, true)
  );

  await Promise.all(alwaysFetchPromises);
}

/* TODO: make this work on new filesystem
function initFsaDropImport(
  terminalContentWindow: Window,
  notifyDroppedFileSaved: (path: string, entryName: string) => void,
  processManager: ProcessManager
) {
  terminalContentWindow.addEventListener("dragover", (e: DragEvent) =>
    e.preventDefault()
  );
  terminalContentWindow.addEventListener("drop", async (e: DragEvent) => {
    e.preventDefault();

    const copyEntry = async (
      entry: FileSystemDirectoryHandle | FileSystemFileHandle,
      path: string
    ) => {
      const dir = (await processManager.filesystem.open("/")).desc;
      if (entry.kind === "directory") {
        // create directory in VFS, expand path and fill directory contents
        await processManager.filesystem.createDir(entry.name);
        for await (const [, handle] of entry.entries()) {
          await copyEntry(handle, `${path}/${entry.name}`);
        }
      } else {
        // create VFS file, open dragged file as stream and pipe it to VFS file
        const handle = await dir.handle.getFileHandle(entry.name, {
          create: true,
        });
        const writable = await handle.createWritable();
        const stream = (await entry.getFile()).stream();
        // @ts-ignore pipeTo is still experimental
        await stream.pipeTo(writable);
        if (notifyDroppedFileSaved) notifyDroppedFileSaved(path, entry.name);
      }
    };
    const pwd =
      processManager.processInfos[processManager.currentProcess].env["PWD"];
    const entryPromises = [];
    for (const item of e.dataTransfer?.items || []) {
      if (item.kind === "file") {
        entryPromises.push(async () => {
          const entry = await item.getAsFileSystemHandle();
          await copyEntry(entry, pwd);
        });
      }
    }
    await Promise.all(entryPromises);
  });
}*/

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

// anchor is any HTMLElement that will be used to initialize hterm
// notifyDroppedFileSaved is a callback that get triggers when the shell successfully saves file drag&dropped by the user
// you can use it to customize the behavior
export async function init(
  anchor: HTMLElement,
  notifyDroppedFileSaved:
    | ((path: string, entryName: string) => void)
    | null = null
): Promise<void> {
  if (!navigator.storage.getDirectory) {
    anchor.innerHTML =
      "Your browser doesn't support File System Access API yet.<br/>We recommend using Chrome for the time being.";
    return;
  }

  const tfs = new TopLevelFs();
  await tfs.addMount("/", await createFsaFilesystem("fsa1", true));

  initServiceWorker();
  // create flag file to indicate that the filesystem was already initiated
  const { err } = await tfs.open(
    "/filesystem-initiated",
    constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
    constants.WASI_O_CREAT | constants.WASI_O_EXCL
  );
  if (err === constants.WASI_ESUCCESS) {
    await initFs(tfs);
  }

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
          return undefined;
        }
      }
      return fetchFile(tfs, filename, address, true);
    }
  );
  await Promise.all(checksumPromises);
  // FIXME: for now we assume hterm is in scope
  // attempt to pass Terminal to initAll as a parameter would fail
  // @ts-ignore
  const terminal = new hterm.Terminal();

  const processManager = new ProcessManager(
    "process.js",
    (output: string) => {
      const replaced = output.replaceAll("\n", "\r\n");
      terminal.io.print(replaced);
      if (window.stdoutAttached) {
        window.buffer += replaced;
      }
      if (window.logOutput) {
        console.log(`[OUT] ${output}`);
      }
    },
    terminal,
    tfs
  );

  terminal.decorate(anchor);
  terminal.installKeyboard();

  terminal.keyboard.bindings.addBindings({
    "Ctrl-R": "PASS",
  });

  const io = terminal.io.push();

  const onTerminalInput = (data: string): void => {
    let code = data.charCodeAt(0);

    if (code === 13) {
      code = 10;
      data = String.fromCharCode(10);
    }

    if (code === 3 || code === 4 || code === 81) {
      // control characters
      if (code === 3) {
        processManager.sendSigInt(processManager.currentProcess);
      } else if (code === 4) {
        processManager.sendEndOfFile(processManager.currentProcess, -1);
      }
    } else {
      // regular characters
      processManager.pushToBuffer(data);
    }

    if (code === 10 || code >= 32) {
      // echo
      if (
        processManager.processInfos[processManager.currentProcess].shouldEcho
      ) {
        terminal.io.print(code === 10 ? "\r\n" : data);
      }
    }
  };
  io.onVTKeystroke = onTerminalInput;
  io.sendString = onTerminalInput;

  // TODO: maybe save all output and rewrite it on adjusted size?
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  io.onTerminalResize = (columns: number, rows: number) => {
    processManager.events.publishEvent(constants.WASI_EVENT_WINCH);
  };

  /* drag and drop support (save dragged files and folders to current directory)
   * hterm creates iframe child of provided anchor, we assume there's only one of those
  initFsaDropImport(
    anchor.getElementsByTagName("iframe")[0].contentWindow,
    notifyDroppedFileSaved,
    processManager
  );*/

  await processManager.spawnProcess(
    null, // parent_id
    null, // parent_lock
    syscallCallback,
    "/usr/bin/wash",
    new FdTable({
      0: new Stdin(processManager),
      1: new Stdout(processManager),
      2: new Stderr(processManager),
      3: (await tfs.open("/")).desc,
    }),
    ["/usr/bin/wash", "/usr/bin/init"],
    {
      PATH: "/usr/bin:/usr/local/bin",
      PWD: DEFAULT_WORK_DIR,
      OLDPWD: DEFAULT_WORK_DIR,
      TMPDIR: "/tmp",
      TERM: "xterm-256color",
      HOME: DEFAULT_WORK_DIR,
      SHELL: "/usr/bin/wash",
      LANG: "en_US.UTF-8",
      USER: "ant",
      HOSTNAME: "browser",
      PYTHONHOME: "/",
      PS1: "\x1b[1;34m\\u@\\h \x1b[1;33m\\w$\x1b[0m ",
      DEBUG: "1",
    },
    false,
    DEFAULT_WORK_DIR
  );
}
