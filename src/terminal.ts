import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import syscallCallback from "./syscalls.js";
import { FileOrDir, OpenFlags, Filesystem, Directory } from "./filesystem.js";
import { Stdin, Stdout, Stderr } from "./devices.js";

declare global {
  interface Window {
    logOutput: boolean;
    stdoutAttached: boolean;
    buffer: string;
  }
}

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
};

// TODO: node (in ci/grab-screencast.js) doesn't accept top level await
//   it can potentially be fixed by making the script an ESModule
// export const filesystem: Filesystem = new Filesystem(await navigator.storage.getDirectory());
export let filesystem: Filesystem;
navigator.storage
  .getDirectory()
  .then((rootHandle: FileSystemDirectoryHandle) => {
    filesystem = new Filesystem(rootHandle);
  });

export async function fetchFile(
  dir: Directory,
  filename: string,
  address: string,
  refetch: boolean = true
) {
  const { err, entry } = await dir.getEntry(
    filename,
    FileOrDir.File,
    OpenFlags.Create
  );
  if (err !== constants.WASI_ESUCCESS) {
    console.warn(`Unable to resolve path for ${dir.path} and ${filename}`);
    return;
  }
  // @ts-ignore TODO: add API for file manipulation to File class
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

async function initFs() {
  // setup filesystem
  const root = await navigator.storage.getDirectory();
  await root.getDirectoryHandle("tmp", { create: true });
  // TODO: this will be a in-memory vfs in the future
  await root.getDirectoryHandle("proc", { create: true });
  const home = await root.getDirectoryHandle("home", { create: true });
  const ant = await home.getDirectoryHandle("ant", { create: true });

  const shellrc = await ant.getFileHandle(".shellrc", { create: true });
  if ((await shellrc.getFile()).size === 0) {
    const w = await shellrc.createWritable();
    await w.write({
      type: "write",
      position: 0,
      data: "export RUST_BACKTRACE=full\nexport DEBUG=1\nexport PYTHONHOME=/lib/python3.6",
    });
    await w.close();
  }

  await root.getDirectoryHandle("etc", { create: true });

  const usr = await root.getDirectoryHandle("usr", { create: true });
  const bin = await usr.getDirectoryHandle("bin", { create: true });

  await root.getDirectoryHandle("lib", { create: true });

  // create dummy files for browser executed commands
  await bin.getFileHandle("mount", { create: true });
  await bin.getFileHandle("umount", { create: true });
  await bin.getFileHandle("wget", { create: true });
  await bin.getFileHandle("download", { create: true });
  await bin.getFileHandle("ps", { create: true });
  await bin.getFileHandle("free", { create: true });

  const local = await usr.getDirectoryHandle("local", { create: true });
  await local.getDirectoryHandle("bin", { create: true });

  const alwaysFetchPromises = Object.entries(ALWAYS_FETCH_BINARIES).map(
    ([filename, address]) =>
      fetchFile(filesystem.rootDir, filename, address, true)
  );
  const necessaryPromises = Object.entries(NECESSARY_BINARIES).map(
    ([filename, address]) =>
      fetchFile(filesystem.rootDir, filename, address, false)
  );
  const optionalPromises = Object.entries(OPTIONAL_BINARIES).map(
    ([filename, address]) =>
      fetchFile(filesystem.rootDir, filename, address, false)
  );

  await Promise.all(alwaysFetchPromises);
  await Promise.all(necessaryPromises);
  // don't await this on purpose
  // TODO: it means however that if you invoke optional binary right after shell first boot it will fail,
  //       it can say that command is not found or just fail at instantiation
  Promise.all(optionalPromises);
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
      const dir = (await filesystem.rootDir.getEntry(path, FileOrDir.Directory))
        .entry;
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
      (registration: ServiceWorkerRegistration) => {
        // Registration was successful
        console.log(
          "ServiceWorker registration successful with scope: ",
          registration.scope
        );
      },
      (err) => {
        // registration failed :(
        console.log("ServiceWorker registration failed: ", err);
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
  initServiceWorker();
  await initFs();

  // FIXME: for now we assume hterm is in scope
  // attempt to pass Terminal to initAll as a parameter would fail
  // @ts-ignore
  const terminal = new hterm.Terminal();

  const processManager = new ProcessManager(
    "process.js",
    // receive_callback
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
  io.onTerminalResize = (columns: number, rows: number) => {};

  // drag and drop support (save dragged files and folders to current directory)
  // hterm creates iframe child of provided anchor, we assume there's only one of those
  const terminalContentWindow =
    anchor.getElementsByTagName("iframe")[0].contentWindow;
  initDropImport(terminalContentWindow, notifyDroppedFileSaved, processManager);

  const pwdDir = (
    await filesystem.rootDir.getEntry("/home/ant", FileOrDir.Directory)
  ).entry;
  pwdDir.path = ".";
  await processManager.spawnProcess(
    null, // parent_id
    null, // parent_lock
    syscallCallback,
    "/usr/bin/shell",
    [
      new Stdin(processManager),
      new Stdout(processManager),
      new Stderr(processManager),
      filesystem.rootDir.open(),
      pwdDir.open(),
      // TODO: why must fds[5] be present for ls to work, and what should it be
      filesystem.rootDir.open(),
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
