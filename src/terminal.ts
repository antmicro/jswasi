import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import { FdTable } from "./process-manager.js";
import syscallCallback from "./syscalls.js";
import { createFsaFilesystem, FsaDirectory } from "./filesystem/fsa-filesystem";
import { Stderr, Stdin, Stdout } from "./devices.js";
import { FileOrDir, LookupFlags, OpenFlags } from "./filesystem/enums.js";
import { Filesystem, OpenDirectory } from "./filesystem/interfaces";
import { md5sum } from "./utils.js";

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
  dir: OpenDirectory,
  filename: string,
  address: string,
  refetch: boolean = true,
  stdout: Stdout = undefined,
  stderr: Stderr = undefined,
  to_stdout: boolean = false
) {
  let position = 0;
  let bar_position = 0;
  let size = -1;
  let progress = new TransformStream({
    transform(data, controller) {
      position += data.length;
      if (size == -1) {
        stdout?.write(
          new TextEncoder().encode(`\r[${".".repeat(50)}: ${position}]`)
        );
      } else if (position == size) {
        stdout?.write(
          new TextEncoder().encode(`\r[${"#".repeat(50)}: ${size}]`)
        );
      } else if (Math.round((position / size) * 50) != bar_position) {
        bar_position = Math.round((position / size) * 50);
        stdout?.write(
          new TextEncoder().encode(
            `\r[${"#".repeat(bar_position)}${"-".repeat(
              50 - bar_position
            )}: ${size}]`
          )
        );
      }
      controller.enqueue(data);
    },
    flush() {
      size = position;
      stdout?.write(
        new TextEncoder().encode(`\r[${"#".repeat(50)}: ${size}]\n`)
      );
    },
  });

  let stdout_writer = new WritableStream({
    write(data) {
      position += data.length;
      stdout?.write(new TextEncoder().encode(`Content until ${position}\n`));
    },
  });

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

  if (to_stdout) {
    const response = await fetch(new Request(address));
    if (response.status != 200) {
      stdout.write(
        new TextEncoder().encode("Error: returned " + response.status + "\n")
      );
      return;
    }
    let clen = response.headers.get("content-length");
    if (clen != null) size = +clen;
    await response.body?.pipeTo(stdout_writer);
    return;
  }

  const { err, entry } = await dir.getEntry(
    filename,
    FileOrDir.File,
    LookupFlags.SymlinkFollow,
    OpenFlags.Create
  );
  if (err !== constants.WASI_ESUCCESS) {
    console.warn(`Unable to resolve path for ${dir.name} and ${filename}`);
    stderr?.write(new TextEncoder().encode("Error: Cannot resolve path.\n"));
    return;
  }

  // only fetch binary if not yet present
  if (refetch || (await entry.metadata()).size === 0n) {
    const response = await fetch(address);
    stdout?.write(new TextEncoder().encode("Downloading...\n"));
    if (response.status != 200) {
      stderr?.write(
        new TextEncoder().encode("Error: returned " + response.status + "\n")
      );
    } else {
      let clen = response.headers.get("content-length");
      if (clen != null) size = +clen;
      const op = await entry.open();
      const writable = await op.writableStream();
      stdout?.write(
        new TextEncoder().encode(`[${"-".repeat(50)}: ${position}]\r`)
      );
      await response.body?.pipeThrough(progress).pipeTo(writable);
      stdout?.write(new TextEncoder().encode("Download finished.\n"));
    }
  }
}

// setup filesystem
async function initFs(openedRootDir: OpenDirectory) {
  // top level directories creation
  await Promise.all([
    openedRootDir.getEntry(
      "/tmp",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
    // TODO: this will be an in-memory vfs in the future
    openedRootDir.getEntry(
      "/proc",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
    openedRootDir.getEntry(
      "/etc",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
    openedRootDir.getEntry(
      "/home",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
    openedRootDir.getEntry(
      "/usr",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
    openedRootDir.getEntry(
      "/lib",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
  ]);

  // 2nd level directories creation
  await Promise.all([
    openedRootDir.getEntry(
      DEFAULT_WORK_DIR,
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
    openedRootDir.getEntry(
      "/usr/bin",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
    openedRootDir.getEntry(
      "/usr/local",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
  ]);

  // 3rd level directories/files/symlinks creation
  await Promise.all([
    openedRootDir.getEntry(
      "/usr/local/bin",
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
    openedRootDir.getEntry(
      `${DEFAULT_WORK_DIR}/.config`,
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
  ]);

  // 4th level directories/files/symlinks creation
  await Promise.all([
    openedRootDir.getEntry(
      `${DEFAULT_WORK_DIR}/.config/ox`,
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create | OpenFlags.Directory
    ),
  ]);

  const washRcPromise = (async () => {
    // TODO: this should be moved to shell
    const washrc = (
      await openedRootDir.getEntry(
        `${DEFAULT_WORK_DIR}/.washrc`,
        FileOrDir.File,
        LookupFlags.SymlinkFollow,
        OpenFlags.Create
      )
    ).entry;
    if ((await washrc.metadata()).size === 0n) {
      let rc_open = await washrc.open();
      await rc_open.write(
        new TextEncoder().encode("export RUST_BACKTRACE=full\nexport DEBUG=1")
      );
      await rc_open.close();
    }
  })();

  const dummyBinariesPromise = Promise.all([
    openedRootDir.getEntry(
      "/usr/bin/mount",
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create
    ),
    openedRootDir.getEntry(
      "/usr/bin/umount",
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create
    ),
    openedRootDir.getEntry(
      "/usr/bin/wget",
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create
    ),
    openedRootDir.getEntry(
      "/usr/bin/download",
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create
    ),
    openedRootDir.getEntry(
      "/usr/bin/ps",
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create
    ),
    openedRootDir.getEntry(
      "/usr/bin/free",
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create
    ),
    openedRootDir.getEntry(
      "/usr/bin/reset",
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
      OpenFlags.Create
    ),
  ]);

  const symlinkCreationPromise = Promise.all([
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
    openedRootDir.addSymlink("/usr/bin/test", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/[", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/wc", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/true", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/false", "/usr/bin/coreutils"),
    openedRootDir.addSymlink("/usr/bin/sleep", "/usr/bin/coreutils"),

    openedRootDir.addSymlink("/usr/local/bin/unzip", "/usr/local/bin/wasibox"),
    openedRootDir.addSymlink(
      "/usr/local/bin/hexdump",
      "/usr/local/bin/wasibox"
    ),
    openedRootDir.addSymlink("/usr/local/bin/imgcat", "/usr/local/bin/wasibox"),
    openedRootDir.addSymlink("/usr/local/bin/purge", "/usr/local/bin/wasibox"),
    openedRootDir.addSymlink("/usr/local/bin/tree", "/usr/local/bin/wasibox"),
    openedRootDir.addSymlink("/usr/local/bin/tar", "/usr/local/bin/wasibox"),
  ]);

  await washRcPromise;
  await dummyBinariesPromise;
  await symlinkCreationPromise;

  const alwaysFetchPromises = Object.entries(ALWAYS_FETCH_BINARIES).map(
    ([filename, address]) => fetchFile(openedRootDir, filename, address, true)
  );

  await Promise.all(alwaysFetchPromises);
}

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
      ).entry as FsaDirectory;
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
  notifyDroppedFileSaved:
    | ((path: string, entryName: string) => void)
    | null = null
): Promise<void> {
  if (!navigator.storage.getDirectory) {
    anchor.innerHTML =
      "Your browser doesn't support File System Access API yet.<br/>We recommend using Chrome for the time being.";
    return;
  }

  const filesystem: Filesystem = await createFsaFilesystem();

  initServiceWorker();
  if (
    !(await filesystem.pathExists(
      filesystem.getMetaDir(),
      "/filesystem-initiated"
    ))
  ) {
    await initFs(filesystem.getRootDir().open());
    // create flag file to indicate that the filesystem was already initiated
    await filesystem
      .getMetaDir()
      .open()
      .getEntry(
        "/filesystem-initiated",
        FileOrDir.File,
        LookupFlags.NoFollow,
        OpenFlags.Create
      );
  }

  // verify if wash and init are up to date and refetch them if they are not
  const openedRootDir = filesystem.getRootDir().open();
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
  const checksumPromises = Object.entries(CHECKSUM_BINARIES).map(
    async ([filename, [address, checksum]]) => {
      const file = await filesystem
        .getRootDir()
        .open()
        .getEntry(filename, FileOrDir.File);
      if (file.err === constants.EXIT_SUCCESS) {
        const open_file = await file.entry.open();
        // 1 << 16 + 1 is a chunk size to read from file, the choice of this number is arbitrary
        let actual_sum = await md5sum(open_file, 1 << (16 + 1));
        let exp_sum = new TextDecoder().decode(
          (await (await fetch(checksum)).arrayBuffer()).slice(0, 32)
        );
        if (actual_sum === exp_sum) {
          return undefined;
        }
      }
      return fetchFile(openedRootDir, filename, address, true);
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

  // drag and drop support (save dragged files and folders to current directory)
  // hterm creates iframe child of provided anchor, we assume there's only one of those
  initFsaDropImport(
    anchor.getElementsByTagName("iframe")[0].contentWindow,
    notifyDroppedFileSaved,
    processManager
  );

  const pwdDir = (
    await filesystem
      .getRootDir()
      .open()
      .getEntry(DEFAULT_WORK_DIR, FileOrDir.Directory)
  ).entry.open();
  pwdDir.setAsCwd(); // doesn't make any difference
  await processManager.spawnProcess(
    null, // parent_id
    null, // parent_lock
    syscallCallback,
    "/usr/bin/wash",
    new FdTable({
      0: new Stdin(processManager),
      1: new Stdout(processManager),
      2: new Stderr(processManager),
      3: filesystem.getRootDir().open(),
      4: pwdDir,
      // TODO: why must fds[5] be present for ls to work, and what should it be
      5: filesystem.getRootDir().open(),
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
