//NODE// import { Worker } from 'worker_threads';
import * as constants from "./constants.js";

const IS_NODE = typeof self === 'undefined';

class WorkerInfo {
    public id: number;
    public worker: Worker;
    public parent_id: number;
    public parent_lock: Int32Array;
    public buffer_request_queue: { requested_len: number, lck: Int32Array, len: Int32Array, sbuf: Uint8Array }[] = [];
    public fds;
    public callback;

    constructor(id: number, worker: Worker, fds, parent_id: number, parent_lock: Int32Array, callback) {
        this.id = id;
        this.worker = worker;
        this.fds = fds;
        this.parent_id = parent_id;
        this.parent_lock = parent_lock;
        this.callback = callback;
    }
}


export class WorkerTable {
    public buffer = "";
    public currentWorker = null;
    private _nextWorkerId = 0;
    public workerInfos: Record<number, WorkerInfo> = {};
    public script_name: string;
    public receive_callback;
    public root;

    constructor(sname: string, receive_callback, root) {
        this.script_name = sname;
        this.receive_callback = receive_callback;
        this.root = root;
    }

    spawnWorker(parent_id: number, parent_lock: Int32Array, callback): number {
        const id = this._nextWorkerId;
        this.currentWorker = id;
        this._nextWorkerId += 1;
        let private_data = {};
        if (!IS_NODE) private_data = {type: "module"};
        let worker = new Worker(this.script_name, private_data);
        this.workerInfos[id] = new WorkerInfo(id, worker, [null, null, null, this.root], parent_id, parent_lock, callback);
        if (!IS_NODE) {
            worker.onmessage = (event) => callback(event, this);
        } else {
            // @ts-ignore
            worker.on('message', (event) => callback(event, this));
        }
        return id;
    }

    postMessage(id: number, message) {
        this.workerInfos[id].worker.postMessage(message);
    }

    terminateWorker(id: number) {
        const worker = this.workerInfos[id];
        worker.worker.terminate();
        // notify parent that they can resume operation
        if (id != 0) {
            Atomics.store(worker.parent_lock, 0, 0);
            Atomics.notify(worker.parent_lock, 0);
        }
        this.currentWorker = worker.parent_id;
        // remove worker from workers array
        delete this.workerInfos[id];
    }

    sendSigInt(id: number) {
        if (this.currentWorker === 0) {
            console.log(`Ctrl-C sent to WORKER 0`);
        } else {
            this.terminateWorker(id);
        }
    }

    sendEndOfFile(id: number, lock_value) {
        const worker = this.workerInfos[id];
        if (worker.buffer_request_queue.length !== 0) {
            const lck = worker.buffer_request_queue[0].lck;
            Atomics.store(lck, 0, lock_value);
            Atomics.notify(lck, 0);
        }
    }

    push_to_buffer(data: string) {
        this.buffer += data;

        // each worker has a buffer request queue to store fd_reads on stdin that couldn't be handled straight away
        // now that buffer was filled, look if there are pending buffer requests from current foreground worker
        if (this.currentWorker != null) {
            while (this.workerInfos[this.currentWorker].buffer_request_queue.length !== 0 && this.buffer.length !== 0) {
                let {
                    requested_len,
                    lck,
                    len,
                    sbuf
                } = this.workerInfos[this.currentWorker].buffer_request_queue.shift();
                this.send_buffer_to_worker(requested_len, lck, len, sbuf);
            }
        }
    }

    send_buffer_to_worker(requested_len: number, lck: Int32Array, readlen: Int32Array, buf: Uint8Array) {
        // if the request can't be processed straight away, push it to queue for later
        if (this.buffer.length == 0) {
            this.workerInfos[this.currentWorker].buffer_request_queue.push({requested_len, lck, len: readlen, sbuf: buf});
            return;
        }

        readlen[0] = (this.buffer.length > requested_len) ? requested_len : this.buffer.length;
        for (let j = 0; j < readlen[0]; j++) {
            buf[j] = this.buffer.charCodeAt(j);
        }
        this.buffer = this.buffer.slice(readlen[0]);
        Atomics.store(lck, 0, constants.WASI_ESUCCESS);
        Atomics.notify(lck, 0);
        return 1;
    }
}
