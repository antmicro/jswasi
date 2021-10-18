// NODE// import { Worker } from 'worker_threads';
import * as constants from './constants.js';
import { FileOrDir } from './filesystem.js';

const IS_NODE = typeof self === 'undefined';

class WorkerInfo {
    public bufferRequestQueue: { requestedLen: number, lck: Int32Array, len: Int32Array, sbuf: Uint8Array }[] = [];
    public shouldEcho = true;
    public timestamp: number;

    // TODO: add types for fds and env
    constructor(public id: number, public cmd: string, public worker: Worker, public fds: [], public parentId: number, public parentLock: Int32Array, public callback: (output) => void, public env) {
	  const now = new Date();
	  this.timestamp = Math.floor(now.getTime() / 1000);
    }
}

export class WorkerTable {
    public buffer = '';
    public currentWorker = null;
    public nextWorkerId = 0;
    public workerInfos: Record<number, WorkerInfo> = {};
    public compiledModules: Record<string, WebAssembly.Module> = {};

    constructor(private readonly scriptName: string, private readonly receiveCallback, public readonly terminal, public readonly filesystem) {}

    async spawnWorker(parentId: number, parentLock: Int32Array, kernelCallback, command, fds, args, env, isJob: boolean): Promise<number> {
      const id = this.nextWorkerId;
      if (parentLock != null || parentId == null) {
          this.currentWorker = id;
      }
      this.nextWorkerId += 1;
      let privateData = {};
      if (!IS_NODE) privateData = { type: 'module' };
      const worker = new Worker(this.scriptName, privateData);
      this.workerInfos[id] = new WorkerInfo(id, command, worker, fds, parentId, parentLock, kernelCallback, env);
      if (!IS_NODE) {
        worker.onmessage = (event) => kernelCallback(event, this);
      } else {
        // @ts-ignore
        worker.on('message', (event) => kernelCallback(event, this));
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
        const bufferSource = await file.arrayBuffer();
        this.compiledModules[command] = await WebAssembly.compile(bufferSource);
      }

      // TODO: pass module through SharedArrayBuffer to save on copying time (it seems to be a big bottleneck)
	  this.workerInfos[id].worker.postMessage(['start', this.compiledModules[command], id, args, env]);
      return id;
    }

    terminateWorker(id: number, exitNo: number = 0) {
      const worker = this.workerInfos[id];
      worker.worker.terminate();
      // notify parent that they can resume operation
      if (id != 0 && worker.parentLock != null) {
        Atomics.store(worker.parentLock, 0, exitNo);
        Atomics.notify(worker.parentLock, 0);
        this.currentWorker = worker.parentId;
      }
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

    sendEndOfFile(id: number, lockValue: number) {
      const worker = this.workerInfos[id];
      if (worker.bufferRequestQueue.length !== 0) {
        const { lck } = worker.bufferRequestQueue[0];
        Atomics.store(lck, 0, lockValue);
        Atomics.notify(lck, 0);
      }
    }

    pushToBuffer(data: string) {
      this.buffer += data;

      // each worker has a buffer request queue to store fd_reads on stdin that couldn't be handled straight away
      // now that buffer was filled, look if there are pending buffer requests from current foreground worker
      if (this.currentWorker != null) {
        while (this.workerInfos[this.currentWorker].bufferRequestQueue.length !== 0 && this.buffer.length !== 0) {
          const {
            requestedLen,
            lck,
            len,
            sbuf,
          } = this.workerInfos[this.currentWorker].bufferRequestQueue.shift();
          this.sendBufferToWorker(this.currentWorker, requestedLen, lck, len, sbuf);
        }
      }
    }

    sendBufferToWorker(workerId: number, requestedLen: number, lck: Int32Array, readlen: Int32Array, buf: Uint8Array) {
      // if the request can't be processed straight away or the process is not in foreground, push it to queue for later
      if (this.buffer.length == 0 || workerId != this.currentWorker) {
        this.workerInfos[workerId].bufferRequestQueue.push({
          requestedLen, lck, len: readlen, sbuf: buf,
        });
        return;
      }

      readlen[0] = (this.buffer.length > requestedLen) ? requestedLen : this.buffer.length;
      for (let j = 0; j < readlen[0]; j++) {
        buf[j] = this.buffer.charCodeAt(j);
      }
      this.buffer = this.buffer.slice(readlen[0]);
      Atomics.store(lck, 0, constants.WASI_ESUCCESS);
      Atomics.notify(lck, 0);
      return 1;
    }
}
