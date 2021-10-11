// NODE// import { Worker } from 'worker_threads';
import * as constants from './constants.js';
import { FileOrDir } from './filesystem.js';

const IS_NODE = typeof self === 'undefined';

class WorkerInfo {
    public id: number;

    public cmd: string;

    public timestamp: number;

    public worker: Worker;

    public parent_id: number;

    public parent_lock: Int32Array;

    public buffer_request_queue: { requested_len: number, lck: Int32Array, len: Int32Array, sbuf: Uint8Array }[] = [];

    public fds;

    public callback;

    public env;

    constructor(id: number, cmd: string, worker: Worker, fds, parent_id: number, parent_lock: Int32Array, callback, env) {
	    this.id = id;
      this.cmd = cmd;
      this.worker = worker;
	    const now = new Date();
	    this.timestamp = Math.floor(now.getTime() / 1000);
      this.fds = fds;
      this.parent_id = parent_id;
      this.parent_lock = parent_lock;
      this.callback = callback;
      this.env = env;
    }
}

export class WorkerTable {
    public readonly terminal;

    public readonly filesystem;

    public readonly receive_callback;

    public readonly script_name: string;

    public buffer = '';

    public currentWorker = null;

    public nextWorkerId = 0;

    public alive: Array<boolean>;

    public workerInfos: Record<number, WorkerInfo> = {};

    public compiledModules: Record<string, WebAssembly.Module> = {};

    constructor(sname: string, receive_callback, terminal, filesystem) {
      this.script_name = sname;
      this.receive_callback = receive_callback;
      this.terminal = terminal;
      this.filesystem = filesystem;
	    this.alive = new Array<boolean>();
    }

    async spawnWorker(parent_id: number, parent_lock: Int32Array, callback, command, fds, args, env): Promise<number> {
      const id = this.nextWorkerId;
      this.currentWorker = id;
      this.nextWorkerId += 1;
      let private_data = {};
      if (!IS_NODE) private_data = { type: 'module' };
	    this.alive.push(true);
      const worker = new Worker(this.script_name, private_data);
      this.workerInfos[id] = new WorkerInfo(id, command, worker, fds, parent_id, parent_lock, callback, env);
      if (!IS_NODE) {
        worker.onmessage = (event) => callback(event, this);
      } else {
        // @ts-ignore
        worker.on('message', (event) => callback(event, this));
      }

      // save compiled module to cache
      // TODO: this will run into trouble if file is replaced after first usage (cached version will be invalid)
      if (!this.compiledModules[command]) {
        const rootDir = await this.filesystem.getRootDirectory();
        const binary = await rootDir.getEntry(command, FileOrDir.File);
        if (binary.entry === null) {
          console.warn(`No such binary: ${command}`);
          return;
        }
        const file = await binary.entry._handle.getFile();
        const buffer_source = await file.arrayBuffer();
        this.compiledModules[command] = await WebAssembly.compile(buffer_source);
      }

      // TODO: pass module through SharedArrayBuffer to save on copying time (it seems to be a big bottleneck)
	    this.workerInfos[id].worker.postMessage(['start', this.compiledModules[command], id, args, env]);
      return id;
    }

    postMessage(id: number, message) {
	    this.workerInfos[id].worker.postMessage(message);
    }

    terminateWorker(id: number, exit_no: number = 0) {
      const worker = this.workerInfos[id];
      worker.worker.terminate();
      // notify parent that they can resume operation
      if (id != 0) {
        Atomics.store(worker.parent_lock, 0, exit_no);
        Atomics.notify(worker.parent_lock, 0);
      }
	    this.alive[id] = false;
      this.currentWorker = worker.parent_id;
      // remove worker from workers array
      delete this.workerInfos[id];
    }

    sendSigInt(id: number) {
      if (this.currentWorker === 0) {
        console.log('Ctrl-C sent to WORKER 0');
      } else {
        this.terminateWorker(id);
      }
    }

    sendEndOfFile(id: number, lock_value) {
      const worker = this.workerInfos[id];
      if (worker.buffer_request_queue.length !== 0) {
        const { lck } = worker.buffer_request_queue[0];
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
          const {
            requested_len,
            lck,
            len,
            sbuf,
          } = this.workerInfos[this.currentWorker].buffer_request_queue.shift();
          this.send_buffer_to_worker(requested_len, lck, len, sbuf);
        }
      }
    }

    send_buffer_to_worker(requested_len: number, lck: Int32Array, readlen: Int32Array, buf: Uint8Array) {
      // if the request can't be processed straight away, push it to queue for later
      if (this.buffer.length == 0) {
        this.workerInfos[this.currentWorker].buffer_request_queue.push({
          requested_len, lck, len: readlen, sbuf: buf,
        });
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
