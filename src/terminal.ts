import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import syscallCallback from "./syscalls.js";
import { createFsaFilesystem } from "./filesystem/fsa-filesystem.js";
import { Stderr, Stdin, Stdout } from "./devices.js";
import { FileOrDir, LookupFlags, OpenFlags } from "./filesystem/enums.js";
import { Filesystem, OpenDirectory } from "./filesystem/interfaces";

declare global {
  interface Window {
    logOutput: boolean;
    stdoutAttached: boolean;
    buffer: string;
  }
}

const ENCODER = new TextEncoder();

const ALWAYS_FETCH_BINARIES = {
  "/etc/motd": "resources/motd.txt",
  "/usr/bin/shell": "resources/shell.wasm",
};

const NECESSARY_BINARIES = {
  "/usr/bin/coreutils": "resources/coreutils.async.wasm",
  "/usr/bin/tree": "resources/tree.wasm",
  "/usr/bin/purge": "resources/purge.wasm",
  "/usr/bin/nohup": "resources/nohup.wasm",
};

const OPTIONAL_BINARIES = {
  "/usr/bin/uutils": "resources/uutils.async.wasm",
  "/lib/python36.zip":
    "https://github.com/pgielda/wasmpython-bin/raw/main/python36.zip",
  "/usr/local/bin/duk":
    "https://registry-cdn.wapm.io/contents/_/duktape/0.0.3/build/duk.wasm",
  "/usr/local/bin/cowsay":
    "https://registry-cdn.wapm.io/contents/_/cowsay/0.2.0/target/wasm32-wasi/release/cowsay.wasm",
  "/usr/local/bin/qjs":
    "https://registry-cdn.wapm.io/contents/adamz/quickjs/0.20210327.0/build/qjs.wasm",
  "/usr/local/bin/viu":
    "https://registry-cdn.wapm.io/contents/_/viu/0.2.3/target/wasm32-wasi/release/viu.wasm",
  "/usr/local/bin/python":
    "https://registry-cdn.wapm.io/contents/_/rustpython/0.1.3/target/wasm32-wasi/release/rustpython.wasm",
  "/usr/local/bin/grep":
    "https://registry-cdn.wapm.io/contents/liftm/rg/12.1.1-1/rg.wasm",
  "/usr/local/bin/realpython":
    "https://registry-cdn.wapm.io/contents/_/python/0.1.0/bin/python.wasm",
  "/usr/local/bin/find":
    "https://registry-cdn.wapm.io/contents/liftm/fd/8.2.1-1/fd.wasm",
  "/usr/local/bin/du":
    "https://registry-cdn.wapm.io/contents/liftm/dust-wasi/0.5.4-3/dust.wasm",
  "/usr/local/bin/llc":
    "https://registry-cdn.wapm.io/contents/rapidlua/llc/0.0.4/llc.wasm",
  "/usr/local/bin/rsign2":
    "https://registry-cdn.wapm.io/contents/jedisct1/rsign2/0.6.1/rsign.wasm",
};

export async function fetchFile(
  dir: OpenDirectory,
  filename: string,
  address: string,
  refetch: boolean = true
) {
  const { err, entry } = await dir.getEntry(
    filename,
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );
  if (err !== constants.WASI_ESUCCESS) {
    console.warn(`Unable to resolve path for ${dir.name} and ${filename}`);
    return;
  }

  const file = await entry.handle.getFile();
  // only fetch binary if not yet present
  if (refetch || file.size === 0) {
    if (
      !(address.startsWith("http://") || address.startsWith("https://")) ||
      address.startsWith(location.origin)
    ) {
      // files served from same origin
    } else {
      // files requested from cross-origin that require proxy server
      // this will become obsolete once COEP: credentialless ships to Chrome (https://www.chromestatus.com/feature/4918234241302528)
      address = `proxy/${btoa(unescape(encodeURIComponent(address)))}`;
    }

    const response = await fetch(address);
    if (response.status === 200) {
      // @ts-ignore TODO: add API for file manipulation to File class
      const writable = await entry.handle.createWritable();
      await response.body.pipeTo(writable);
    } else {
      console.log(`Failed downloading ${filename} from ${address}`);
    }
  }
}

// setup filesystem
async function initFs(openedRootDir: OpenDirectory) {
  await openedRootDir.getEntry(
    "/tmp",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );
  // TODO: this will be a in-memory vfs in the future
  await openedRootDir.getEntry(
    "/proc",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );
  await openedRootDir.getEntry(
    "/etc",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );
  await openedRootDir.getEntry(
    "/home",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );
  await openedRootDir.getEntry(
    "/home/ant",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );

  const shellrc = (
    await openedRootDir.getEntry(
      "/home/ant/.shellrc",
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create
    )
  ).entry;
  if ((await shellrc.metadata()).size === 0n) {
    const openedShellrc = await shellrc.open();
    openedShellrc.write(
      ENCODER.encode(
        "export RUST_BACKTRACE=full\nexport DEBUG=1\nexport PYTHONHOME=/lib/python3.6"
      )
    );
  }

  await openedRootDir.getEntry(
    "/usr",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );
  await openedRootDir.getEntry(
    "/usr/bin",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );

  await openedRootDir.getEntry(
    "/lib",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );

  // create dummy files for browser executed commands
  await openedRootDir.getEntry(
    "/usr/bin/mount",
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );
  await openedRootDir.getEntry(
    "/usr/bin/umount",
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );
  await openedRootDir.getEntry(
    "/usr/bin/wget",
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );
  await openedRootDir.getEntry(
    "/usr/bin/download",
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );
  await openedRootDir.getEntry(
    "/usr/bin/ps",
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );
  await openedRootDir.getEntry(
    "/usr/bin/free",
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );
  await openedRootDir.getEntry(
    "/usr/bin/reset",
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );

  await openedRootDir.getEntry(
    "/usr/local",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );
  await openedRootDir.getEntry(
    "/usr/local/bin",
    FileOrDir.Directory,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create | OpenFlags.Directory
  );

  const alwaysFetchPromises = Object.entries(ALWAYS_FETCH_BINARIES).map(
    ([filename, address]) => fetchFile(openedRootDir, filename, address, true)
  );
  const necessaryPromises = Object.entries(NECESSARY_BINARIES).map(
    ([filename, address]) => fetchFile(openedRootDir, filename, address, false)
  );
  const optionalPromises = Object.entries(OPTIONAL_BINARIES).map(
    ([filename, address]) => fetchFile(openedRootDir, filename, address, false)
  );

  await Promise.all([
    ...alwaysFetchPromises,
    ...necessaryPromises,
    ...optionalPromises,
  ]);

  await Promise.all([
    openedRootDir.addSymlink("/usr/bin/ls", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/mkdir", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/rmdir", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/touch", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/rm", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/mv", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/cp", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/echo", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/date", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/printf", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/env", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/cat", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/realpath", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/ln", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/printenv", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/md5sum", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/wc", "/usr/bin/coreutils"),
  ]);
}

function initDropImport(
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
      const dir = (
        await processManager.filesystem
          .getRootDir()
          .open()
          .getEntry(
            path,
            FileOrDir.Directory,
            LookupFlags.SymlinkFollow,
            OpenFlags.Create
          )
      ).entry;
      if (entry.kind === "directory") {
        // create directory in VFS, expand path and fill directory contents
        await dir.handle.getDirectoryHandle(entry.name, { create: true });
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
      processManager.processInfos[processManager.currentProcess].env.PWD;
    const entryPromises = [];
    for (const item of e.dataTransfer.items) {
      if (item.kind === "file") {
        entryPromises.push(async () => {
          const entry = await item.getAsFileSystemHandle();
          await copyEntry(entry, pwd);
        });
      }
    }
    await Promise.all(entryPromises);
  });
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

// anchor is any HTMLElement that will be used to initialize hterm
// notifyDroppedFileSaved is a callback that get triggers when the shell successfully saves file drag&dropped by the user
// you can use it to customize the behavior
export async function init(
  anchor: HTMLElement,
  notifyDroppedFileSaved: (
    path: string,
    entryName: string
  ) => void | null = null
): Promise<void> {
  if (!navigator.storage.getDirectory) {
    anchor.innerHTML =
      "Your browser doesn't support File System Access API yet.<br/>We recommend using Chrome for the time being.";
    return;
  }

  const filesystem: Filesystem = await createFsaFilesystem();

  initServiceWorker();
  await initFs(filesystem.getRootDir().open());

  // FIXME: for now we assume hterm is in scope
  // attempt to pass Terminal to initAll as a parameter would fail
  // @ts-ignore
  const terminal = new hterm.Terminal();

  const processManager = new ProcessManager(
    "process.js",
    (output: string) => {
      terminal.io.print(output);
      if (window.stdoutAttached) {
        window.buffer += output;
      }
      if (window.logOutput) {
        console.log(`[OUT] ${output}`);
      }
    },
    terminal,
    filesystem
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
      if (window.stdoutAttached) {
        window.buffer += data;
      }
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
  io.onTerminalResize = (columns: number, rows: number) => {};

  // drag and drop support (save dragged files and folders to current directory)
  // hterm creates iframe child of provided anchor, we assume there's only one of those
  initDropImport(
    anchor.getElementsByTagName("iframe")[0].contentWindow,
    notifyDroppedFileSaved,
    processManager
  );

  const pwdDir = (
    await filesystem
      .getRootDir()
      .open()
      .getEntry("/home/ant", FileOrDir.Directory)
  ).entry;
  // pwdDir.setAsCwd();
  await processManager.spawnProcess(
    null, // parent_id
    null, // parent_lock
    syscallCallback,
    "/usr/bin/shell",
    [
      new Stdin(processManager),
      new Stdout(processManager),
      new Stderr(processManager),
      filesystem.getRootDir().open(),
      pwdDir.open(),
      // TODO: why must fds[5] be present for ls to work, and what should it be
      filesystem.getRootDir().open(),
    ],
    ["/usr/bin/shell"],
    {
      PATH: "/usr/bin:/usr/local/bin",
      PWD: "/home/ant",
      OLDPWD: "/home/ant",
      TMPDIR: "/tmp",
      TERM: "xterm-256color",
      HOME: "/home/ant",
      SHELL: "/usr/bin/shell",
      LANG: "en_US.UTF-8",
      USER: "ant",
      HOSTNAME: "browser",
      PS1: "\x1b[1;34m\\u@\\h \x1b[1;33m\\w$\x1b[0m ",
      DEBUG: "1",
    },
    false
  );
}
