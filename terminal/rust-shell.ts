import {hterm, lib} from "./hterm-all.js";
import * as constants from "./constants.js";
import {WorkerTable} from "./worker-table.js";
import {OpenFile, OpenDirectory} from "./filesystem.js";
import {on_worker_message} from "./worker-message.js";

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

function receive_callback(id, output) {
    if (terminal != null) {
        terminal.io.print(output);
    }
}

export async function init_all(terminal_query_selector: string) {
    // If you are a cross-browser web app and want to use window.localStorage.
    hterm.defaultStorage = new lib.Storage.Local();

    // setup filesystem
    const root = await navigator.storage.getDirectory();
    const home = await root.getDirectoryHandle("home", {create: true});
    const ant = await home.getDirectoryHandle("ant", {create: true});
    const shell_history = await root.getFileHandle(".shell_history", {create: true});

    let workerTable = new WorkerTable("worker.js", send_buffer_to_worker, receive_callback, root);

    const setupHterm = () => {
        const t = new hterm.Terminal("profile-id");

        t.onTerminalReady = function () {
            const io = t.io.push();

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
                    t.io.print(code === 10 ? "\r\n" : data);

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

        };

        t.decorate(document.querySelector(terminal_query_selector));
        t.installKeyboard();

        return t;
    }

    // This will be whatever normal entry/initialization point your project uses.
    await lib.init();
    terminal = setupHterm();

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

