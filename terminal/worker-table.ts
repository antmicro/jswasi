//NODE// import { Worker } from 'worker_threads';

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
    public currentWorker = null;
    private _nextWorkerId = 0;
    public workerInfos: Record<number, WorkerInfo> = {};
    public script_name: string;
    public send_callback;
    public receive_callback;
    public root;

    constructor(sname: string, send_callback, receive_callback, root) {
        this.script_name = sname;
        this.send_callback = send_callback;
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
	    if (worker.parent_lock !== null) {
            Atomics.store(worker.parent_lock, 0, 0);
            Atomics.notify(worker.parent_lock, 0);
            this.currentWorker = worker.parent_id;
	    } else {
            this.currentWorker = null;
        }
        // remove worker from workers array
        delete this.workerInfos[id];
    }

    releaseWorker(id: number, lock_value) {
        const worker = this.workerInfos[id];
        if (worker.buffer_request_queue.length !== 0) {
            const lck = worker.buffer_request_queue[0].lck;
            Atomics.store(lck, 0, lock_value);
            Atomics.notify(lck, 0);
        }
    }
}
