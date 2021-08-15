//NODE// import { Worker } from 'worker_threads';

export let workerTable = null;

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
    public isNode: boolean;
    public send_callback;

    constructor(sname: string, send_callback, isNode = false) {
        this.script_name = sname;
        this.isNode = isNode;
        this.send_callback = send_callback;
    }

    _callback(event) {
        let id = event.data[0];
        this.parent.workerInfos[id].callback(event, this.parent);
    }

    spawnWorker(fds, parent_id: number, parent_lock: Int32Array, callback): number {
        const id = this._nextWorkerId;
        this.currentWorker = id;
        this._nextWorkerId += 1;
        let private_data = {};
        if (!this.isNode) private_data = {type: "module"};
        let worker = new Worker(this.script_name, private_data);
        worker.parent = this;
        this.workerInfos[id] = new WorkerInfo(id, worker, fds, parent_id, parent_lock, callback);
        if (!this.isNode) {
            worker.onmessage = this._callback;
        } else {
            worker.on('message', this._callback);
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
