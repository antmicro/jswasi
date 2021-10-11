import * as constants from './constants.js';
import { WorkerTable } from './worker-table.js';
import { on_worker_message } from './worker-message.js';

import { FileOrDir, OpenFlags } from './filesystem.js';
import { Filesystem, Directory } from './browser-fs.js';

declare global {
    var stdout_attached: boolean;
    var buffer: string;
}

const ALWAYS_FETCH_BINARIES = {
  '/etc/motd': 'resources/motd.txt',
  '/usr/bin/shell': 'resources/shell.wasm',
};

const NECESSARY_BINARIES = {
  '/usr/bin/uutils': 'resources/uutils.async.wasm',
  '/usr/bin/coreutils': 'resources/coreutils.async.wasm',
  '/usr/bin/tree': 'resources/tree.wasm',
  '/usr/bin/purge': 'resources/purge.wasm',
};

const OPTIONAL_BINARIES = {
  '/lib/python36.zip': 'https://github.com/pgielda/wasmpython-bin/raw/main/python36.zip',
  '/usr/local/bin/duk': 'https://registry-cdn.wapm.io/contents/_/duktape/0.0.3/build/duk.wasm',
  '/usr/local/bin/cowsay': 'https://registry-cdn.wapm.io/contents/_/cowsay/0.2.0/target/wasm32-wasi/release/cowsay.wasm',
  '/usr/local/bin/qjs': 'https://registry-cdn.wapm.io/contents/adamz/quickjs/0.20210327.0/build/qjs.wasm',
  '/usr/local/bin/viu': 'https://registry-cdn.wapm.io/contents/_/viu/0.2.3/target/wasm32-wasi/release/viu.wasm',
  '/usr/local/bin/python': 'https://registry-cdn.wapm.io/contents/_/rustpython/0.1.3/target/wasm32-wasi/release/rustpython.wasm',
  '/usr/local/bin/rg': 'https://registry-cdn.wapm.io/contents/liftm/rg/12.1.1-1/rg.wasm',
  '/usr/local/bin/realpython': 'https://registry-cdn.wapm.io/contents/_/python/0.1.0/bin/python.wasm',
};

async function fetchFile(dir: Directory, filename: string, address: string, refetch: boolean = true) {
  const { err, entry } = await dir.getEntry(filename, FileOrDir.File, OpenFlags.Create);
  if (err !== constants.WASI_ESUCCESS) {
    console.warn(`Unable to resolve path for ${dir.path} and ${filename}`);
    return;
  }
  // @ts-ignore TODO: add API for file manipulation to File class
  const file = await entry._handle.getFile();
  // only fetch binary if not yet present
  if (refetch || file.size === 0) {
    let response;
    if (!(address.startsWith('http://') || address.startsWith('https://')) || address.startsWith(location.origin)) {
      // files served from same origin
    } else if (location.origin.startsWith('http://localhost')) {
      // files requested from cross-orign that require proxy server
      address = `proxy/${btoa(unescape(encodeURIComponent(address)))}`;
    } else {
      // hack for current beta server, where only static files are avaible
      address = `proxy/${address.split('/').slice(-1)[0]}`;
    }

    response = await fetch(address);
    if (response.status === 200) {
      // @ts-ignore TODO: add API for file manipulation to File class
      const writable = await entry._handle.createWritable();
      await response.body.pipeTo(writable);
    } else {
      console.log(`Failed downloading ${filename} from ${address}`);
    }
  }
}

export async function initFs(anchor: HTMLElement) {
  // setup filesystem
  const root = await navigator.storage.getDirectory();
  const tmp = await root.getDirectoryHandle('tmp', { create: true });
  const home = await root.getDirectoryHandle('home', { create: true });
  const ant = await home.getDirectoryHandle('ant', { create: true });
  const shell_history = await ant.getFileHandle('.shell_history', { create: true });
  const etc = await root.getDirectoryHandle('etc', { create: true });

  const usr = await root.getDirectoryHandle('usr', { create: true });
  const bin = await usr.getDirectoryHandle('bin', { create: true });

  const lib = await root.getDirectoryHandle('lib', { create: true });

  // create dummy files for browser executed commands
  await bin.getFileHandle('mount', { create: true });
  await bin.getFileHandle('umount', { create: true });
  await bin.getFileHandle('wget', { create: true });
  await bin.getFileHandle('ps', { create: true });
  await bin.getFileHandle('free', { create: true });

  const local = await usr.getDirectoryHandle('local', { create: true });
  const local_bin = await local.getDirectoryHandle('bin', { create: true });

  const rootDir = await filesystem.getRootDirectory();
  const always_fetch_promises = Object.entries(ALWAYS_FETCH_BINARIES).map(([filename, address]) => fetchFile(rootDir, filename, address, true));
  const necessary_promises = Object.entries(NECESSARY_BINARIES).map(([filename, address]) => fetchFile(rootDir, filename, address, false));
  const optional_promises = Object.entries(OPTIONAL_BINARIES).map(([filename, address]) => fetchFile(rootDir, filename, address, false));

  anchor.innerHTML += '<br/>' + 'Starting download of mandatory';
  await Promise.all(always_fetch_promises);
  await Promise.all(necessary_promises);
  anchor.innerHTML += '<br/>' + 'Mandatory finished.';
  anchor.innerHTML += '<br/>' + 'Starting download of optional';
  // don't await this on purpose
  // TODO: it means however that if you invoke optional binary right after shell first boot it will fail,
  //       it can say that command is not found or just fail at instantiation
  Promise.all(optional_promises);
}

// things that are global and should be shared between all tab instances
const filesystem = new Filesystem();

export async function init(anchor: HTMLElement) {
  anchor.innerHTML = 'Fetching binaries, this should only happen once.';
  await initFs(anchor);
  anchor.innerHTML = '';

  // FIXME: for now we assume hterm is in scope
  // attempt to pass Terminal to initAll as a parameter would fail
  // @ts-ignore
  const terminal = new hterm.Terminal();

  const root_dir = await filesystem.getRootDirectory();
  const workerTable = new WorkerTable(
    'worker.js',
    // receive_callback
    // @ts-ignore
    (output) => {
      terminal.io.print(output);
      if (window.stdout_attached != undefined && window.stdout_attached) {
        window.buffer += output;
      }
    },
    terminal,
    filesystem,
  );

  terminal.decorate(anchor);
  terminal.installKeyboard();

  const io = terminal.io.push();

  io.onVTKeystroke = io.sendString = (data) => {
    let code = data.charCodeAt(0);

    if (code === 13) {
      code = 10;
      data = String.fromCharCode(10);
    }

	    if (code == 3 || code == 4) {
      // control characters
      if (code == 3) {
        workerTable.sendSigInt(workerTable.currentWorker);
      } else if (code == 4) {
        workerTable.sendEndOfFile(workerTable.currentWorker, -1);
      }
    } else {
      // regular characters
      workerTable.push_to_buffer(data);
	        if (window.stdout_attached != undefined && window.stdout_attached) {
        window.buffer += data;
      }
    }

	    if ((code === 10) || code >= 32) {
      // echo
      terminal.io.print(code === 10 ? '\r\n' : data);
	    }
  };

  io.onTerminalResize = (columns, rows) => {
  };

  const pwd_dir = (await root_dir.getEntry('/home/ant', FileOrDir.Directory)).entry;
  pwd_dir.path = '.';
  await workerTable.spawnWorker(
    null, // parent_id
    null, // parent_lock
    on_worker_message,
    '/usr/bin/shell',
    // stdin, stderr, stdout, root, pwd, TODO: why must fds[5] be present for ls to work, and what should it be
    [null, null, null, await root_dir.open(), await pwd_dir.open(), await root_dir.open()],
    ['shell'],
    {
      RUST_BACKTRACE: 'full',
      PATH: '/usr/bin:/usr/local/bin',
      PWD: '/home/ant',
      OLDPWD: '/home/ant',
      TMPDIR: '/tmp',
      TERM: 'xterm-256color',
      HOME: '/home/ant',
      SHELL: '/usr/bin/shell',
      LANG: 'en_US.UTF-8',
      USER: 'ant',
    },
  );
}

export async function mount(workerTable, worker_id, args, env): Promise<number> {
  console.log(`mount(${worker_id}, ${args})`);

  switch (args.length) {
    case 1: {
      workerTable.terminal.io.println('wasmfs on /');
      for (const mount of filesystem.mounts) {
        workerTable.terminal.io.println(`fsapi on /${`${mount.parts.join('/')}/${mount.name}`}`);
      }
      return constants.WASI_ESUCCESS;
    }
    case 2: {
      let path = args[1];
      // handle relative path
      if (!path.startsWith('/')) {
        path = `${env.PWD === '/' ? '' : env.PWD}/${path}`;
      }

      // check if path exits
      if (!await filesystem.pathExists(path, FileOrDir.Directory)) {
        workerTable.terminal.io.println(`mount: ${path}: no such directory`);
        return 1;
      }

      let mount_point;
      try {
        mount_point = await showDirectoryPicker();
      } catch (e) {
        workerTable.terminal.io.println('mount: failed to open local directory');
        return 1; // TODO: what would be a proper error here?
      }

      await filesystem.addMount(path, mount_point);
      return 0;
    }
    default: {
      workerTable.terminal.io.println('mount: help: mount [<mountpoint>]');
      return 1;
    }
  }
}

export function umount(workerTable, worker_id, args, env): number {
  let path = args[1];
  // handle relative path
  if (!path.startsWith('/')) {
    path = `${env.PWD === '/' ? '' : env.PWD}/${path}`;
  }

  if (!filesystem.isMounted(path)) {
    workerTable.terminal.io.println(`umount: ${path}: not mounted`);
    return 1;
  }

  filesystem.removeMount(path);
  return 0;
}

export async function wget(workerTable, worker_id, args, env): Promise<number> {
  let filename: string;
  let address: string;
  if (args.length == 2) {
    address = args[1];
    filename = address.split('/').slice(-1)[0];
  } else if (args.length == 3) {
    address = args[1];
    filename = args[2];
  } else {
    workerTable.terminal.io.println('wget: help: wget <address> [<filename>]');
    return 1;
  }
  const { err, name, dir } = await filesystem.resolveAbsolute(`${env.PWD}/${filename}`);
  await fetchFile(dir, filename, address);
  return 0;
}
