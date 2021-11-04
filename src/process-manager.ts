import * as constants from "./constants.js";
import { FileOrDir, Filesystem } from "./filesystem.js";

type BufferRequestQueue = {
  requestedLen: number;
  lck: Int32Array;
  readlen: Int32Array;
  sbuf: Uint8Array;
}[];

class ProcessInfo {
  public bufferRequestQueue: BufferRequestQueue = [];

  public shouldEcho = true;

  public timestamp: number;

  constructor(
    public id: number,
    public cmd: string,
    public worker: Worker,
    public fds: any[], // TODO: add FileDescriptor wrapper class
    public parentId: number,
    public parentLock: Int32Array,
    public callback: (
      event: MessageEvent,
      processManager: ProcessManager
    ) => Promise<void>,
    public env: Record<string, string>
  ) {
    this.timestamp = Math.floor(new Date().getTime() / 1000);
  }
}

export class ProcessManager {
  public buffer = "";

  public currentProcess: number = null;

  public nextProcessId = 0;

  public processInfos: Record<number, ProcessInfo> = {};

  public compiledModules: Record<string, WebAssembly.Module> = {};

  constructor(
    private readonly scriptName: string,
    public readonly terminalOutputCallback: (output: string) => void,
    public readonly terminal: any, // TODO: should we declare HTerminal stump or even import the real thing?
    public readonly filesystem: Filesystem
  ) {}

  async spawnProcess(
    parentId: number,
    parentLock: Int32Array,
    syscallCallback: (
      event: MessageEvent,
      processManager: ProcessManager
    ) => Promise<void>,
    command: string,
    fds: any[], // TODO
    args: string[],
    env: Record<string, string>,
    isJob: boolean
  ): Promise<number> {
    const id = this.nextProcessId;
    this.nextProcessId += 1;
    if (parentLock != null || parentId == null) {
      this.currentProcess = id;
    }
    const worker = new Worker(this.scriptName, { type: "module" });
    this.processInfos[id] = new ProcessInfo(
      id,
      command,
      worker,
      fds,
      parentId,
      parentLock,
      syscallCallback,
      env
    );
    worker.onmessage = (event) => syscallCallback(event, this);

    // save compiled module to cache
    // TODO: this will run into trouble if file is replaced after first usage (cached version will be invalid)
    if (!this.compiledModules[command]) {
      const binary = await this.filesystem.rootDir.getEntry(
        command,
        FileOrDir.File
      );
      if (binary.entry === null) {
        console.warn(`No such binary: ${command}`);
        return;
      }
      const file = await binary.entry._handle.getFile();
      const bufferSource = await file.arrayBuffer();
      this.compiledModules[command] = await WebAssembly.compile(bufferSource);
    }

    // TODO: pass module through SharedArrayBuffer to save on copying time (it seems to be a big bottleneck)
    this.processInfos[id].worker.postMessage([
      "start",
      this.compiledModules[command],
      id,
      args,
      env,
    ]);
    return id;
  }

  terminateProcess(id: number, exitNo: number = 0) {
    const process = this.processInfos[id];
    process.worker.terminate();
    // notify parent that they can resume operation
    if (id !== 0 && process.parentLock != null) {
      Atomics.store(process.parentLock, 0, exitNo);
      Atomics.notify(process.parentLock, 0);
      this.currentProcess = process.parentId;
    }
    // remove process from process array
    delete this.processInfos[id];
  }

  sendSigInt(id: number) {
    if (this.currentProcess === 0) {
      console.log("Ctrl-C sent to PROCESS 0");
    } else {
      this.terminateProcess(id);
    }
  }

  sendEndOfFile(id: number, lockValue: number) {
    const worker = this.processInfos[id];
    if (worker.bufferRequestQueue.length !== 0) {
      const { lck } = worker.bufferRequestQueue[0];
      Atomics.store(lck, 0, lockValue);
      Atomics.notify(lck, 0);
    }
  }

  pushToBuffer(data: string) {
    this.buffer += data;

    // each process has a buffer request queue to store fd_reads on stdin that couldn't be handled straight away
    // now that buffer was filled, look if there are pending buffer requests from current foreground worker
    if (this.currentProcess != null) {
      while (
        this.processInfos[this.currentProcess].bufferRequestQueue.length !==
          0 &&
        this.buffer.length !== 0
      ) {
        const { requestedLen, lck, readlen, sbuf } =
          this.processInfos[this.currentProcess].bufferRequestQueue.shift();
        this.sendBufferToProcess(
          this.currentProcess,
          requestedLen,
          lck,
          readlen,
          sbuf
        );
      }
    }
  }

  sendBufferToProcess(
    workerId: number,
    requestedLen: number,
    lck: Int32Array,
    readlen: Int32Array,
    buf: Uint8Array
  ): void {
    // if the request can't be processed straight away or the process is not in foreground, push it to queue for later
    if (this.buffer.length === 0 || workerId !== this.currentProcess) {
      this.processInfos[workerId].bufferRequestQueue.push({
        requestedLen,
        lck,
        readlen,
        sbuf: buf,
      });
    } else {
      readlen[0] =
        this.buffer.length > requestedLen ? requestedLen : this.buffer.length;
      for (let j = 0; j < readlen[0]; j += 1) {
        buf[j] = this.buffer.charCodeAt(j);
      }
      this.buffer = this.buffer.slice(readlen[0]);
      Atomics.store(lck, 0, constants.WASI_ESUCCESS);
      Atomics.notify(lck, 0);
    }
  }
}