import {hterm, lib} from "./hterm-all.js";
import {WASI_ESUCCESS, WASI_EBADF} from "./constants.js";
import {WorkerTable} from "./worker-table.js";

let buffer = "";

function send_buffer_to_worker(lck: Int32Array, len: Int32Array, sbuf: Uint8Array) {
    console.log("got buffer request of len " + len[0] + ", notifying");
    len[0] = (buffer.length > len[0]) ? len[0] : buffer.length;
    console.log("current buffer is '" + buffer + "', copying len " + len[0]);
    for (let j = 0; j < len[0]; j++) {
        sbuf[j] = buffer.charCodeAt(j);
    }
    buffer = buffer.slice(len[0]);
    Atomics.store(lck, 0, 1);
    Atomics.notify(lck, 0);
}

async function init_all() {
    // If you are a cross-browser web app and want to use window.localStorage.
    hterm.defaultStorage = new lib.Storage.Local();

    // setup filesystem
    const root = await navigator.storage.getDirectory();
    // const home = await root.getDirectoryHandle("home", {create: true});
    // const ant = await home.getDirectoryHandle("ant", {create: true});
    // const history = await ant.getFileHandle(".shell_history", {create: true});

    let workerTable = new WorkerTable;
    workerTable.spawnWorker(null, null);

    const setupHterm = () => {
        const t = new hterm.Terminal("profile-id");

        t.onTerminalReady = function () {
            const io = t.io.push();

            io.onVTKeystroke = io.sendString = (data) => {
                let code = data.charCodeAt(0);
                console.log(data, code);

                if (code !== 13 && code < 32) {
                    // control characters
                    if (code == 3) {
                        console.log(`got ^C control, killing current worker (${id})`);
                        workerTable.terminateWorker(workerTable.currentWorker);
                    } else if (code == 4) {
                        console.log(`got ^D, releasing buffer read lock (if present) with value -1`);
                        workerTable.releaseWorker(workerTable.currentWorker, -1);
                    }
                } else {
                    // regular characters
                    buffer = buffer + data;

                    // echo
                    t.io.print(data);

                    // each worker has a buffer request queue to store fd_reads on stdin that couldn't be handled straight away
                    // now that buffer was filled, look if there are pending buffer requests from current foreground worker
                    while (workerTable.workerInfos[workerTable.currentWorker].buffer_request_queue.length !== 0 && buffer.length !== 0) {
                        let {
                            lck,
                            len,
                            sbuf
                        } = workerTable.workerInfos[workerTable.currentWorker].buffer_request_queue.shift();
                        send_buffer_to_worker(lck, len, sbuf);
                    }
                }
            };

            io.onTerminalResize = (columns, rows) => {
            };

        };

        t.decorate(document.querySelector('#terminal'));
        t.installKeyboard();

        return t;
    }

    // This will be whatever normal entry/initialization point your project uses.
    await lib.init();
    const terminal = setupHterm();

    const on_worker_message = async (event) => {
        const [worker_id, action, data] = event.data;
        switch (action) {
            case "buffer": {
                const lck = new Int32Array(data, 0, 1);
                const len = new Int32Array(data, 4, 1);
                const sbuf = new Uint8Array(data, 8, len[0]);
                if (buffer.length !== 0) {
                    // handle buffer request straight away
                    send_buffer_to_worker(lck, len, sbuf);
                } else {
                    // push handle buffer request to queue
                    workerTable.workerInfos[worker_id].buffer_request_queue.push({lck: lck, len: len, sbuf: sbuf});
                }
                break;
            }

            case "stderr": {
                console.log(`STDERR ${worker_id}: ${data}`);
                break;
            }
            case "console": {
                console.log("WORKER " + worker_id + ": " + data);
                break;
            }
            case "exit": {
                workerTable.terminateWorker(worker_id);
                console.log(`WORKER ${worker_id} exited with result code: ${data}`);
                break;
            }
            case "spawn": {
                const [command, args, env, lck_sbuf] = data;
                const parent_lck = new Int32Array(lck_sbuf, 0, 1);
                if (command === "mount") {
                    // special case for mount command
                    const mount = await showDirectoryPicker();
                    workerTable.releaseWorker(worker_id, 1);
                } else {
                    const id = workerTable.spawnWorker(worker_id, parent_lck);
                    workerTable.setOnMessage(id, on_worker_message);
                    workerTable.postMessage(id, ["start", `${command}.wasm`, id, args, env]);
                    console.log("WORKER " + worker_id + " spawned: " + command);
                }
                break;
            }
            case "fd_prestat_get": {
                const [sbuf, fd] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const name_len = new Int32Array(sbuf, 4, 1);
                const preopen_type = new Uint8Array(sbuf, 8, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined && fds[fd].prestat_name != undefined) {
                    const PREOPEN_TYPE_DIR = 0;
                    preopen_type[0] = PREOPEN_TYPE_DIR;
                    name_len[0] = fds[fd].prestat_name.length;
                    err = WASI_ESUCCESS;
                } else {
                    // FIXME: this fails for created files (when fds[fd] is undefined)
                    //  what should happen when requesting with not used fd?
                    //  for now we get error: 'data provided contains a nul byte' on File::create
                    console.log("fd_prestat_get returning EBADF");
                    err = WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);

                break;
            }
            case "fd_prestat_dir_name": {
                const [sbuf, fd, path_len] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const path = new Uint8Array(sbuf, 4, path_len);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined && fds[fd].prestat_name != undefined) {
                    path.set(fds[fd].prestat_name, 0);
                    err = WASI_ESUCCESS;
                } else {
                    console.log("fd_prestat_dir_name returning EBADF");
                    err = WASI_EBADF; // TODO: what return code?
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);

                break;
            }
            case "fd_write": {
        		const [sbuf, content] = data;
                let output = content.replaceAll("\n", "\n\r");
                terminal.io.print(output);

                const lck = new Int32Array(sbuf, 0, 1);
                Atomics.store(lck, 0, 1);
                Atomics.notify(lck, 0);
                break;
            }
        }
    }

    workerTable.setOnMessage(0, on_worker_message);
    workerTable.postMessage(0, ["start", "shell.wasm", 0, [], {
        RUST_BACKTRACE: "full",
        PATH: "/usr/bin:/usr/local/bin",
        X: "3"
    }]);

    console.log("init_all done")
}

window.onload = init_all;
