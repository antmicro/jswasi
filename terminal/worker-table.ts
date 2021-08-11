import {WASI_ESUCCESS, WASI_FILETYPE_DIRECTORY, WASI_FILETYPE_REGULAR_FILE} from "./constants.js";

class File {
    file_type = WASI_FILETYPE_REGULAR_FILE;
    data;

    constructor(data) {
        this.data = new Uint8Array(data);
    }

    get size() {
        return this.data.byteLength;
    }

    open() {
        return new OpenFile(this);
    }

    stat() {
        return {
             dev: 0n,
             ino: 0n,
             file_type: this.file_type,
             nlink: 0n,
             size: BigInt(this.size),
             atim: 0n,
             mtim: 0n,
             ctim: 0n,
         };
     }
 
     truncate() {
         this.data = new Uint8Array([]);
     }
}

class OpenFile {
    file_type = WASI_FILETYPE_REGULAR_FILE;
    file;
    file_pos = 0;

    constructor(file) {
        this.file = file;
    }

    get size() {
        return this.file.size;
    }

    read(len) {
        worker_console_log(`${typeof this.file_pos}, ${typeof len}`)
        if (this.file_pos < this.file.data.byteLength) {
            let slice = this.file.data.slice(this.file_pos, this.file_pos + len);
            this.file_pos += slice.length;
            return [slice, 0];
        } else {
            return [[], 0];
        }
    }

    write(buffer) {
        // File.data is and Uint8Array, we need to resize it if necessary
        if (this.file_pos + buffer.length > this.size) {
            let old = this.file.data;
            this.file.data = new Uint8Array(this.file_pos + buffer.length);
            this.file.data.set(old);
        }
        this.file.data.set(
            new TextEncoder().encode(buffer), this.file_pos
        );
        this.file_pos += buffer.length;
        return 0;
    }

    stat() {
        return this.file.stat();
    }
}

class Directory {
    file_type = WASI_FILETYPE_DIRECTORY;
    directory;

    constructor(contents) {
        this.directory = contents;
    }

    open(name) {
        return new PreopenDirectory(name, this.directory);
    }

    get_entry_for_path(path) {
        let entry = this;
        for (let component of path.split("/")) {
            if (component == "") break;
            if (entry.directory[component] != undefined) {
                entry = entry.directory[component];
            } else {
                return null;
            }
        }
        return entry;
    }

    create_entry_for_path(path) {
        let entry = this;
        let components = path.split("/").filter((component) => component != "/");
        for (let i = 0; i < components.length; i++) {
            let component = components[i];
            if (entry.directory[component] != undefined) {
                entry = entry.directory[component];
            } else {
                if (i == components.length - 1) {
                    entry.directory[component] = new File(new ArrayBuffer(0));
                } else {
                    entry.directory[component] = new Directory({});
                }
                entry = entry.directory[component];
            }
        }
        return entry;
    }
}

class PreopenDirectory extends Directory {
    prestat_name;

    constructor(name, contents) {
        super(contents);
        this.prestat_name = new TextEncoder().encode(name);
    }
}

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
        new PreopenDirectory(".", {
             "hello.rs": new File(new TextEncoder().encode(`fn main() { println!("Hello World!"); }`)),
        }), // 3
        new PreopenDirectory("/tmp", {"test.txt": new File(new TextEncoder().encode("test string content"))}), // 4
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
    public workerInfos: Record<number, WorkerInfo> = {};

    spawnWorker(parent_id: number, parent_lock: Int32Array): number {
        const id = this._nextWorkerId;
        this.currentWorker = id;
        this._nextWorkerId += 1;
        let worker = new Worker("worker.js", {type: "module"});
        this.workerInfos[id] = new WorkerInfo(id, worker, parent_id, parent_lock);
        return id;
    }

    setOnMessage(id: number, onmessage) {
        this.workerInfos[id].worker.onmessage = onmessage;
    }

    postMessage(id: number, message) {
        this.workerInfos[id].worker.postMessage(message);
        console.log(`message posted to worker ${id}`)
    }

    terminateWorker(id: number) {
        const worker = this.workerInfos[id];
        worker.worker.terminate();
        // notify parent that they can resume operation
	if (worker.parent_lock !== null) {
            Atomics.store(worker.parent_lock, 0, 1);
            Atomics.notify(worker.parent_lock, 0);
            this.currentWorker -= worker.parent_id;
	}
        // remove worker from workers array
        delete this.workerInfos[id];
        console.log(`Awaiting input from WORKER ${this.currentWorker}`)
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
