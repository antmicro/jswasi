declare global {
    var stdout_attached: boolean;
    var buffer: string;
}

import * as constants from "./constants.js";
import {WorkerTable} from "./worker-table.js";
import {on_worker_message} from "./worker-message.js";

import {FileOrDir} from "./filesystem.js";
import {Filesystem} from "./browser-fs.js";

const NECESSARY_BINARIES = {
    "/etc/motd" : "resources/motd.txt",
    "/usr/bin/shell": "resources/shell.wasm",
    "/usr/bin/uutils": "resources/uutils.async.wasm",
    "/usr/bin/coreutils": "resources/coreutils.async.wasm",
    "/usr/bin/tree": "resources/tree.wasm",
    "/usr/bin/purge": "resources/purge.wasm",
};

const OPTIONAL_BINARIES = {
    "/usr/local/bin/duk": "https://registry-cdn.wapm.io/contents/_/duktape/0.0.3/build/duk.wasm",
    "/usr/local/bin/cowsay": "https://registry-cdn.wapm.io/contents/_/cowsay/0.2.0/target/wasm32-wasi/release/cowsay.wasm",
    "/usr/local/bin/qjs": "https://registry-cdn.wapm.io/contents/adamz/quickjs/0.20210327.0/build/qjs.wasm",
    "/usr/local/bin/viu": "https://registry-cdn.wapm.io/contents/_/viu/0.2.3/target/wasm32-wasi/release/viu.wasm",
    "/usr/local/bin/python": "https://registry-cdn.wapm.io/contents/_/rustpython/0.1.3/target/wasm32-wasi/release/rustpython.wasm",
};

async function fetch_file(dir_handle: FileSystemDirectoryHandle, filename: string, address: string, refetch: boolean = true) {
    let new_dir_handle = dir_handle;
    let new_filename = filename;
    if (filename[0] == '/') {
	    // got an absolute path
        const { err: err, name: nfilename, dir_handle: dir_handl } = await filesystem.resolveAbsolute(filename);
	    new_filename = nfilename;
	    new_dir_handle = dir_handl;
    } else if (filename.lastIndexOf("/") != -1) {
	    console.log("Error: unsupported path!");
	    // TODO: unsupported situation where its a relative path but not direct
    }
    const handle = await new_dir_handle.getFileHandle(new_filename, {create: true});
    const file = await handle.getFile();
    // only fetch binary if not yet present
    if (refetch || file.size === 0) {
        let response;
        if (!(address.startsWith("http://") || address.startsWith("https://")) || address.startsWith(location.origin)) {
            // files served from same origin
        } else {
            if (location.origin.startsWith("http://localhost")) {
                // files requested from cross-orign that require proxy server
                address = "proxy/" + btoa(unescape(encodeURIComponent(address)));
            } else {
                // hack for current beta server, where only static files are avaible
                address = "proxy/" + address.split("/").slice(-1)[0];
            }
        }
        
        response = await fetch(address);
        if (response.status === 200) {
            const writable = await handle.createWritable();
            await response.body.pipeTo(writable);
        } else {
            console.log(`Failed downloading ${filename} from ${address}`);
        }
    }
}

export async function init_fs(anchor: HTMLElement) {
    // setup filesystem
    const root = await navigator.storage.getDirectory();
    const tmp = await root.getDirectoryHandle("tmp", {create: true});
    const home = await root.getDirectoryHandle("home", {create: true});
    const ant = await home.getDirectoryHandle("ant", {create: true});
    const shell_history = await ant.getFileHandle(".shell_history", {create: true});
    const etc = await root.getDirectoryHandle("etc", {create: true});

    const usr = await root.getDirectoryHandle("usr", {create: true});
    const bin = await usr.getDirectoryHandle("bin", {create: true});

    // create dummy files for browser executed commands
    await bin.getFileHandle("mount", {create: true});
    await bin.getFileHandle("umount", {create: true});
    await bin.getFileHandle("wget", {create: true});
    await bin.getFileHandle("ps", {create: true});

    const local = await usr.getDirectoryHandle("local", {create: true});
    const local_bin = await local.getDirectoryHandle("bin", {create: true});

    const necessary_promises = Object.entries(NECESSARY_BINARIES).map(([filename, address]) => fetch_file(root, filename, address, false));
    const optional_promises = Object.entries(OPTIONAL_BINARIES).map(([filename, address]) => fetch_file(root, filename, address, false));
    
    anchor.innerHTML += "<br/>" + "Starting download of mandatory";
    await Promise.all(necessary_promises);
    anchor.innerHTML += "<br/>" + "Mandatory finished.";
    anchor.innerHTML += "<br/>" + "Starting download of optional";
    // don't await this on purpose
    // TODO: it means however that if you invoke optional binary right after shell first boot it will fail,
    //       it can say that command is not found or just fail at instantiation
    Promise.all(optional_promises);
}

// things that are global and should be shared between all tab instances
const filesystem = new Filesystem();

export async function init_all(anchor: HTMLElement) {
    anchor.innerHTML = 'Fetching binaries, this should only happen once.';
    await init_fs(anchor);
    anchor.innerHTML = '';

    // FIXME: for now we assume hterm is in scope
    // attempt to pass Terminal to init_all as a parameter would fail
    // @ts-ignore
    const terminal = new hterm.Terminal();

    const root_dir = await filesystem.getRootDirectory();
    const workerTable = new WorkerTable(
        "worker.js",
        // receive_callback
        // @ts-ignore
        (output) => {
            terminal.io.print(output);
            if (window.stdout_attached != undefined && window.stdout_attached) {
                window.buffer = window.buffer + output;
            }
        },
        [null, null, null, await root_dir.open(), await root_dir.open(), await root_dir.open()],
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
                window.buffer = window.buffer + data;
            }
        }

	    if ((code === 10) || code >= 32) {
            // echo
            terminal.io.print(code === 10 ? "\r\n" : data);
	    }
    };

    io.onTerminalResize = (columns, rows) => {
    };

    await workerTable.spawnWorker(
        null, // parent_id
        null, // parent_lock
        on_worker_message,
        "/usr/bin/shell",
        [],
        {
            RUST_BACKTRACE: "full",
            PATH: "/usr/bin:/usr/local/bin",
            PWD: "/",
	        TMPDIR: "/tmp",
	        TERM: "xterm-256color",
	        HOME: "/home/ant",
        }
    );
}

export async function mount(workerTable, worker_id, args, env) {
    console.log(`mount(${worker_id}, ${args})`);

    switch (args.length) {
        case 1: {
            workerTable.terminal.io.println("wasmfs on /");
            for (const mount of filesystem.mounts) {
                workerTable.terminal.io.println(`fsapi on /${mount.parts.join("/") + "/" + mount.name} (${mount.handle.name})`);
            }
            break;
        }
        case 2: {
            let path = args[1];
            // handle relative path
            if (!path.startsWith("/")) {
                path = `${env["PWD"] === "/" ? "" : env["PWD"]}/${path}`;
            }

            // check if path exits
            if (!await filesystem.path_exists(path, FileOrDir.Directory)) {
                workerTable.terminal.io.println(`mount: ${path}: no such directory`);
                return null;
            }
            
            let mount_point;
            try {
                mount_point = await showDirectoryPicker();
            } catch(e) {
                workerTable.terminal.io.println("mount: failed to open local directory");
                return null;
            }
            
            await filesystem.addMount(path, mount_point);
            return mount_point;
        }
        default: {
            workerTable.terminal.io.println("mount: help: mount [<mountpoint>]");
        }
    }
}

export function umount(workerTable, worker_id, args, env) {
    let path = args[1];
    // handle relative path
    if (!path.startsWith("/")) {
        path = `${env["PWD"] === "/" ? "" : env["PWD"]}/${path}`;
    }

    if (!filesystem.isMounted(path)) {
        workerTable.terminal.io.println(`umount: ${path}: not mounted`);
        return;
    }

    filesystem.removeMount(path);
}

export async function wget(workerTable, worker_id, args, env) {
    let filename: string;
    let address: string;
    if (args.length == 2) {
        address = args[1];
        filename = address.split("/").slice(-1)[0];
    } else if (args.length == 3) {
        address = args[1];
        filename = args[2];
    } else {
        workerTable.terminal.io.println("wget: help: wget <address> [<filename>]");
        return;
    }
    const { err, name, dir_handle } = await filesystem.resolveAbsolute(env['PWD'] + "/" + filename);
    await fetch_file(dir_handle, filename, address); 
}
