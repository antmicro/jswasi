import * as constants from "./constants.js";
import {WorkerTable} from "./worker-table.js";
import {OpenFile, OpenDirectory} from "./browser-fs.js";
import {on_worker_message} from "./worker-message.js";

const PROXY_SERVER = "http://localhost:8001";

// TODO: move *all* buffer stuff to worker-message, preferably to WorkerTable class
let buffer = "";
let terminal = null;

function send_buffer_to_worker(requested_len: number, lck: Int32Array, readlen: Int32Array, buf: Uint8Array) {
    // console.log("got buffer request of len " + requested_len + ", notifying");
    if (buffer.length == 0) return 0;
    readlen[0] = (buffer.length > requested_len) ? requested_len : buffer.length;
    // console.log("current buffer is '" + buffer + "', copying len " + readlen[0]);
    for (let j = 0; j < readlen[0]; j++) {
        buf[j] = buffer.charCodeAt(j);
    }
    buffer = buffer.slice(readlen[0]);
    Atomics.store(lck, 0, constants.WASI_ESUCCESS);
    Atomics.notify(lck, 0);
    return 1;
}

const NECESSARY_BINARIES = {
    "shell.wasm": "http://localhost:8000/shell.wasm",
    "uutils.wasm": "https://github.com/GoogleChromeLabs/wasi-fs-access/raw/main/uutils.async.wasm",
};

const OPTIONAL_BINARIES = {
    "tree.wasm": "http://localhost:8000/tree.wasm",
    "duk.wasm": "https://registry-cdn.wapm.io/contents/_/duktape/0.0.3/build/duk.wasm",
    "cowsay.wasm": "https://registry-cdn.wapm.io/contents/_/cowsay/0.2.0/target/wasm32-wasi/release/cowsay.wasm",
    "qjs.wasm": "https://registry-cdn.wapm.io/contents/adamz/quickjs/0.20210327.0/build/qjs.wasm",
    "viu.wasm": "https://registry-cdn.wapm.io/contents/_/viu/0.2.3/target/wasm32-wasi/release/viu.wasm",
};

async function fetch_file(dir_handle: FileSystemDirectoryHandle, filename: string, address: string) {
    const handle = await dir_handle.getFileHandle(filename, {create: true});
    const file = await handle.getFile();
    // only fetch binary if not yet present
    if (file.size === 0) {
        let response;
        if (address.startsWith("http://localhost")) {
            // files served from same origin
            response = await fetch(address);
        } else {
            // files requested from cross-orign that require proxy server
            response = await fetch(`${PROXY_SERVER}/${address}`);
        }
        if (response.status === 200) {
            const writable = await handle.createWritable();
            await response.body.pipeTo(writable);
        } else {
            console.log(`Failed downloading ${filename} from ${address}`);
        }
    }
}


export async function init_fs(): Promise<OpenDirectory> {
    // setup filesystem
    const root = await navigator.storage.getDirectory();
    const home = await root.getDirectoryHandle("home", {create: true});
    const ant = await home.getDirectoryHandle("ant", {create: true});
    const shell_history = await ant.getFileHandle(".shell_history", {create: true});

    const usr = await root.getDirectoryHandle("usr", {create: true});
    const bin = await usr.getDirectoryHandle("bin", {create: true});

    // create dummy files for browser executed commands
    await bin.getFileHandle("mount.wasm", {create: true});
    await bin.getFileHandle("wget.wasm", {create: true});

    const necessary_promises = Object.entries(NECESSARY_BINARIES).map(([filename, address]) => fetch_file(bin, filename, address));
    const optional_promises = Object.entries(OPTIONAL_BINARIES).map(([filename, address]) => fetch_file(bin, filename, address));
    
    // don't await this on purpose
    // TODO: it means however that if you invoke optional binary right after shell first boot it will fail,
    //       it can say that command is not found or just fail at instantiation
    Promise.all(optional_promises);
    await Promise.all(necessary_promises);

    return new OpenDirectory("/", root);
}

export async function init_all(anchor: HTMLElement) {
    const openRoot = await init_fs();

    // FIXME: for now we assume hterm is in scope
    // attempt to pass Terminal to init_all as a parameter would fail
    // @ts-ignore
    terminal = new hterm.Terminal();

    const workerTable = new WorkerTable(
        "worker.js",
        send_buffer_to_worker,
        // receive_callback
        (id, output) => terminal.io.print(output),
        openRoot
    );

    terminal.decorate(anchor);
    terminal.installKeyboard();

    const io = terminal.io.push();

    io.onVTKeystroke = io.sendString = (data) => {
        let code = data.charCodeAt(0);
        console.log(data, code);

        if (code === 13) {
            code = 10;
            data = String.fromCharCode(10);
        }

        if (code !== 10 && code < 32) {
            // control characters
            if (code == 3) {
                console.log(`got ^C control, killing current worker (${workerTable.currentWorker})`);
                workerTable.terminateWorker(workerTable.currentWorker);
            } else if (code == 4) {
                console.log(`got ^D, releasing buffer read lock (if present) with value -1`);
                workerTable.releaseWorker(workerTable.currentWorker, -1);
            }
        } else {
            // regular characters
            buffer = buffer + data;

            // echo
            terminal.io.print(code === 10 ? "\r\n" : data);

            // each worker has a buffer request queue to store fd_reads on stdin that couldn't be handled straight away
            // now that buffer was filled, look if there are pending buffer requests from current foreground worker
            if (workerTable.currentWorker != null) {
                while (workerTable.workerInfos[workerTable.currentWorker].buffer_request_queue.length !== 0 && buffer.length !== 0) {
                    let {
                        requested_len,
                        lck,
                        len,
                        sbuf
                    } = workerTable.workerInfos[workerTable.currentWorker].buffer_request_queue.shift();
                    workerTable.send_callback(requested_len, lck, len, sbuf);
                }
            }
        }
    };

    io.onTerminalResize = (columns, rows) => {
    };

    workerTable.spawnWorker(
        null, // parent_id
        null, // parent_lock
        on_worker_message
    );


    workerTable.postMessage(0, ["start", "shell.wasm", 0, [], {
        RUST_BACKTRACE: "full",
        PATH: "/usr/bin:/usr/local/bin",
        PWD: "/",
    }]);
}

export async function mount(worker_id, args, env) {
    const mount = await showDirectoryPicker();
    // TODO: implement
    // workerTable.workerInfos[worker_id].fds.push(new OpenDirectory(args[1], mount));
}

export async function wget(worker_id, args, env) {
    let filename: string;
    let address: string;
    if (args.length == 2) {
        address = args[1];
        filename = address.split("/").slice(-1)[0];
    } else if (args.length == 3) {
        address = args[1];
        filename = args[2];
    } else {
        terminal.io.println("write: help: write <address> <filename>");
        return;
    }
    // TODO: fetch to CWD
    const root = await navigator.storage.getDirectory();
    fetch_file(root, filename, address); 
}

