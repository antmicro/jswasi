import {hterm, lib} from "./hterm-all.js";

let buffer = "";

async function init_all() {
    // If you are a cross-browser web app and want to use window.localStorage.
    hterm.defaultStorage = new lib.Storage.Local();

    // setup filesystem
    const root = await navigator.storage.getDirectory();
    // const home = await root.getDirectoryHandle("home", {create: true});
    // const ant = await home.getDirectoryHandle("ant", {create: true});
    // const history = await ant.getFileHandle(".shell_history", {create: true});

    let workers = [];
    workers[0] = {id: 0, worker: new Worker('worker.js', {type: "module"}), buffer_request_queue: []};
    let current_worker = 0;

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

    function handle_program_end(worker) {
        worker.worker.terminate();
        // notify parent that they can resume operation
        Atomics.store(worker.parent_lck, 0, 1);
        Atomics.notify(worker.parent_lck, 0);
        // remove worker from workers array
        workers.splice(worker.id, 1);
        current_worker -= 1; // TODO: workers stack/tree
        console.log(`Awaiting input from WORKER ${current_worker}`);
    }

    const setupHterm = () => {
        const t = new hterm.Terminal("profile-id");

        t.onTerminalReady = function () {
            const io = t.io.push();

            io.onVTKeystroke = io.sendString = (data) => {
                let code = data.charCodeAt(0);
                console.log(data, code);

                const worker = workers[current_worker];
                if (code !== 13 && code < 32) {
                    // control characters
                    if (code == 3) {
                        console.log(`got ^C control, killing current worker (${worker.id})`);
                        handle_program_end(worker);
                    } else if (code == 4) {
                        console.log(`got ^D, releasing buffer read lock (if present) with value -1`);
                        if (worker.buffer_request_queue.length !== 0) {
                            const lck = worker.buffer_request_queue[0].lck;
                            Atomics.store(lck, 0, -1);
                            Atomics.notify(lck, 0);
                        }
                    }
                } else {
                    // regular characters
                    buffer = buffer + data;
                    // echo
                    t.io.print(data);

                    // each worker has a buffer request queue to store fd_reads on stdin that couldn't be handled straight away
                    // now that buffer was filled, look if there are pending buffer requests from current foreground worker
                    while (workers[current_worker].buffer_request_queue.length !== 0 && buffer.length !== 0) {
                        let {lck, len, sbuf} = workers[current_worker].buffer_request_queue.shift();
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

    const worker_onmessage = async (event) => {
        const [worker_id, action, data] = event.data;
        if (action === "buffer") {
            const lck = new Int32Array(data, 0, 1);
            const len = new Int32Array(data, 4, 1);
            const sbuf = new Uint8Array(data, 8, len[0]);
            if (buffer.length !== 0) {
                // handle buffer request straight away
                send_buffer_to_worker(lck, len, sbuf);
            } else {
                // push handle buffer request to queue
                workers[worker_id].buffer_request_queue.push({lck: lck, len: len, sbuf: sbuf});
            }
        } else if (action === "stdout") {
            // let output = new TextDecoder().decode(data).replace("\n", "\n\r");
            let output = data.replaceAll("\n", "\n\r");
            terminal.io.print(output);
        } else if (action === "stderr") {
            console.log(`STDERR ${worker_id}: ${data}`);
        } else if (action === "console") {
            console.log("WORKER " + worker_id + ": " + data);
        } else if (action === "exit") {
            let worker = workers[worker_id];
            handle_program_end(worker);
            console.log(`WORKER ${worker_id} exited with result code: ${data}`);
        } else if (action === "spawn") {
            const [command, args, env, lck_sbuf] = data;
            const parent_lck = new Int32Array(lck_sbuf, 0, 1);
            const id = workers.length;
            if (command === "mount") {
                // special case for mount command
                const mount = await showDirectoryPicker();
                Atomics.store(parent_lck, 0, 1);
                Atomics.notify(parent_lck, 0)
            } else {
                workers.push({id: id, worker: new Worker("worker.js", {type: "module"}), buffer_request_queue: [], parent_lck});
                workers[id].worker.onmessage = worker_onmessage;
                workers[id].worker.postMessage(["start", `${command}.wasm`, id, args, env]);
                console.log("WORKER " + worker_id + " spawned: " + command);
                current_worker = id;
            }
        } else if (action === "file-access") {

        }
    }

    workers[0].worker.onmessage = worker_onmessage;
    workers[0].worker.postMessage(["start", "shell.wasm", 0, [], {
        RUST_BACKTRACE: "full",
        PATH: "/usr/bin:/usr/local/bin",
        X: "3"
    }], null);
}

window.onload = init_all;
