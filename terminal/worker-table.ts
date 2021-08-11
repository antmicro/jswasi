import {WASI_ESUCCESS} from "./constants.js";

class Stdin {
    read(len) {
        if (len === 0) return [new Uint8Array([]), 0];
        const buf = new SharedArrayBuffer((len * 2) + 8); // lock, len, data
        const lck = new Int32Array(buf, 0, 1);
        const request_len = new Int32Array(buf, 4, 1);
        request_len[0] = len;
        // send buffer read request to main thread
        // it can either be handled straight away or queued for later
        // either way we block with Atomics.wait until buffer is filled
        worker_send(["buffer", buf]);
        Atomics.wait(lck, 0, 0);
        if (Atomics.load(lck, 0) === -1) {
            return [new Uint8Array, -1];
        }
        const sbuf = new Uint8Array(buf, 8, request_len[0]);
        BUFFER = BUFFER + String.fromCharCode.apply(null, new Uint8Array(sbuf));
        let data = BUFFER.slice(0, len).replace("\r", "\n");
        BUFFER = BUFFER.slice(len, BUFFER.length);
        return [new TextEncoder().encode(data), 0];
    }
}

class Stdout {
    write(content) {
        worker_send(["stdout", content]);
        return WASI_ESUCCESS;
    }
}

class Stderr {
    write(content) {
        worker_send(["stderr", content]);
        return WASI_ESUCCESS;
    }
}

let fds = [
    new Stdin(), // 0
    new Stdout(), // 1
    new Stderr(), // 2
    // new OpenDirectory("/", await navigator.storage.getDirectory()),
    // new PreopenDirectory(".", {
    //     "hello.rs": new File(new TextEncoder().encode(`fn main() { println!("Hello World!"); }`)),
    // }), // 3
    // new PreopenDirectory("/tmp", {"test.txt": new File(new TextEncoder().encode("test string content"))}), // 4
];

class WorkerInfo {
    public id: number;
    public worker: Worker;
    public parent_id: number;
    public parent_lock: Int32Array;
    public buffer_request_queue: { lck: Int32Array, len: Int32Array, sbuf: Uint8Array }[] = [];
    public fds = [
        new Stdin(), // 0
        new Stdout(), // 1
        new Stderr(), //
    ];

    constructor(id: number, worker: Worker, parent_id: number, parent_lock: Int32Array) {
        this.id = id;
        this.worker = worker;
        this.parent_id = parent_id;
        this.parent_lock = parent_lock;
    }
}

export class WorkerTable {
    public currentWorker = null;
    private _nextWorkerId = 0;
    private _workerInfos: Record<number, WorkerInfo> = {};

    spawnWorker(parent_id: number, parent_lock: Int32Array): number {
        const id = this._nextWorkerId;
        this.currentWorker = id;
        this._nextWorkerId += 1;
        let worker = new Worker("worker.js", {type: "module"});
        this._workerInfos[id] = new WorkerInfo(id, worker, parent_id, parent_lock);
        return id;
    }

    setOnMessage(id: number, onmessage) {
        this._workerInfos[id].worker.onmessage = onmessage;
    }

    postMessage(id: number, message) {
        this._workerInfos[id].worker.postMessage(message);
        console.log(`message posted to worker ${id}`)
    }

    terminateWorker(id: number) {
        console.log(`got ^C control, killing current worker (${id})`);
        const worker = this._workerInfos[id];
        worker.worker.terminate();
        // notify parent that they can resume operation
        Atomics.store(worker.parent_lock, 0, 1);
        Atomics.notify(worker.parent_lock, 0);
        this.currentWorker -= worker.parent_id;
        // remove worker from workers array
        delete this._workerInfos[id];
        console.log(`Awaiting input from WORKER ${this.currentWorker}`)
    }

    releaseWorker(id: number, lock_value) {
        console.log(`got ^D, releasing buffer read lock (if present) with value -1`);
        const worker = this._workerInfos[id];
        if (worker.buffer_request_queue.length !== 0) {
            const lck = worker.buffer_request_queue[0].lck;
            Atomics.store(lck, 0, lock_value);
            Atomics.notify(lck, 0);
        }
    }
}