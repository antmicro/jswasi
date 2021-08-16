import { Worker } from 'worker_threads';

import * as constants from "./constants.js";
import {WorkerTable} from "./worker-table.mjs";
import {OpenFile, OpenDirectory} from "./filesystem.js";
import {on_worker_message} from "./worker-message.js";

// TODO: move *all* buffer stuff to worker-message, preferably to WorkerTable class
let buffer = "";

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
    process.stdout.write(output);
}

if (process.argv.length < 3) {
    console.log("Not enough arguments");
    process.exit(1);
}

let workerTable = new WorkerTable("./worker.mjs", send_buffer_to_worker, receive_callback, null, true);

workerTable.spawnWorker(
    null, // parent_id
    null, // parent_lock
    on_worker_message
);
workerTable.postMessage(0, ["start", process.argv[2], 0, process.argv.slice(2), {
            RUST_BACKTRACE: "full",
            PATH: "/usr/bin:/usr/local/bin",
            PWD: "/",
}]);

function uart_loop() {
    if (workerTable.currentWorker == null) return;
    while (1) {
        const data = process.stdin.read(1);
        if (data != null) {
                // regular characters
                buffer = buffer + data;
                // echo
                //t.io.print(code === 10 ? "\r\n" : data);
                // each worker has a buffer request queue to store fd_reads on stdin that couldn't be handled straight away
                // now that buffer was filled, look if there are pending buffer requests from current foreground worker
                if (workerTable.currentWorker != null) while (workerTable.workerInfos[workerTable.currentWorker].buffer_request_queue.length !== 0 && buffer.length !== 0) {
                    let { requested_len, lck, len, sbuf } = workerTable.workerInfos[workerTable.currentWorker].buffer_request_queue.shift();
                    workerTable.send_callback(requested_len, lck, len, sbuf);
                }
        }
        else {
            setTimeout(uart_loop, 100);
            return;
        }
    }
}

uart_loop();
