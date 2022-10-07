import * as constants from "./constants.js";
import { In, Out } from "./devices.js";
import {
  Filesystem,
  OpenDirectory,
  OpenFile,
} from "./filesystem/interfaces.js";
import { FileOrDir } from "./filesystem/enums.js";

type FileDescriptor = In | Out | OpenFile | OpenDirectory;

type BufferRequest = {
  requestedLen: number;
  lck: Int32Array;
  readLen: Int32Array;
  sharedBuffer: Uint8Array;
};

export class FdTable {
  private fdt: Record<number, FileDescriptor> = {};
  private freeFds: number[] = [];
  private topFd: number;

  constructor(fds: Record<number, FileDescriptor>, preopen: boolean = true) {
    this.fdt = { ...fds };
    this.topFd = Object.keys(fds).length - 1;
    if (preopen) {
      Object.values(this.fdt).map((fd) => {
        fd.isPreopened = true;
      });
    }
  }

  public clone(): FdTable {
    var fdTable = new FdTable(this.fdt);
    fdTable.freeFds = this.freeFds.slice(0);
    fdTable.topFd = this.topFd;
    return fdTable;
  }

  public addFile(entry: FileDescriptor): number {
    if (entry === undefined) {
      throw "Entry is undefined";
    }
    const fd = this.freeFds.shift();
    if (fd !== undefined) {
      this.fdt[fd] = entry;
      return fd;
    } else {
      this.fdt[++this.topFd] = entry;
      return this.topFd;
    }
  }

  public freeFd(fd: number) {
    if (!(fd in this.fdt)) {
      throw "descriptor not present in descriptor table";
    }
    delete this.fdt[fd];
    this.freeFds.push(fd);
  }

  public replaceFd(fd: number, entry: FileDescriptor) {
    if (!(fd in this.fdt)) {
      throw "descriptor not present in descriptor table";
    }
    if (entry === undefined) {
      throw "Entry is undefined";
    }
    this.fdt[fd] = entry;
  }

  public getFd(fd: number): FileDescriptor {
    return this.fdt[fd];
  }
  public tearDown() {
    Promise.all(
      Object.values(this.fdt).map(async (fileDescriptor) => {
        await fileDescriptor?.close();
      })
    );
  }
}

class ProcessInfo {
  public bufferRequestQueue: BufferRequest[] = [];

  public shouldEcho = true;

  public timestamp: number;

  constructor(
    public id: number,
    public cmd: string,
    public worker: Worker,
    public fds: FdTable,
    public parentId: number | null,
    public parentLock: Int32Array | null,
    public callback: (
      event: MessageEvent,
      processManager: ProcessManager
    ) => Promise<void>,
    public env: Record<string, string>,
    public isJob: boolean
  ) {
    this.timestamp = Math.floor(new Date().getTime() / 1000);
  }
}

export default class ProcessManager {
  public buffer = "";

  public currentProcess: number = 0;

  public nextProcessId = 0;

  public processInfos: Record<number, ProcessInfo> = {};

  public compiledModules: Record<string, WebAssembly.Module> = {};

  constructor(
    private readonly scriptName: string,
    public readonly terminalOutputCallback: (output: string) => void,
    public readonly terminal: any, // TODO: extract Terminal interface and use it here
    public readonly filesystem: Filesystem
  ) {
    // it's a constructor with only parameter properties
  }

  async spawnProcess(
    parentId: number | null,
    parentLock: Int32Array | null,
    syscallCallback: (
      event: MessageEvent,
      processManager: ProcessManager
    ) => Promise<void>,
    command: string,
    fds: FdTable,
    args: string[],
    env: Record<string, string>,
    isJob: boolean,
    workingDir: string
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
      env,
      isJob
    );
    worker.onmessage = (event) => syscallCallback(event, this);

    // save compiled module to cache
    // TODO: this will run into trouble if file is replaced after first usage (cached version will be invalid)
    try {
      if (!this.compiledModules[command]) {
        const { err, entry } = await this.filesystem
          .getRootDir()
          .open()
          .getEntry(command, FileOrDir.File);
        if (err !== constants.WASI_ESUCCESS) {
          console.error(`No such binary: ${command}`);
          return err;
        }

        this.compiledModules[command] = await WebAssembly.compile(
          await (await entry.open()).arrayBuffer()
        );
      }
    } catch (e) {
      let errno;
      if (
        (e as Error).message ===
        "WebAssembly.compile(): BufferSource argument is empty"
      ) {
        errno = constants.WASI_ESUCCESS;
      } else {
        errno = constants.WASI_ENOEXEC;
      }
      this.terminateProcess(id, errno);
      throw Error("invalid binary");
    }

    // TODO: pass module through SharedArrayBuffer to save on copying time (it seems to be a big bottleneck)
    this.processInfos[id].worker.postMessage([
      "start",
      this.compiledModules[command],
      id,
      args,
      env,
      workingDir,
    ]);

    return id;
  }

  terminateProcess(id: number, exitNo: number = 0) {
    const process = this.processInfos[id];

    // close/flush all opened files to make sure written contents are saved to persistent storage
    process.fds.tearDown();

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
    if (
      this.currentProcess === 0 ||
      this.processInfos[this.currentProcess].cmd === "/usr/bin/wash"
    ) {
      console.log(`Ctrl-C sent to PROCESS ${this.currentProcess}`);
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
        const { requestedLen, lck, readLen, sharedBuffer } =
          this.processInfos[this.currentProcess].bufferRequestQueue.shift();
        this.sendBufferToProcess(
          this.currentProcess,
          requestedLen,
          lck,
          readLen,
          sharedBuffer
        );
      }
    }
  }

  sendBufferToProcess(
    workerId: number,
    requestedLen: number,
    lck: Int32Array,
    readLen: Int32Array,
    buf: Uint8Array
  ): void {
    // if the request can't be processed straight away or the process is not in foreground, push it to queue for later
    if (this.buffer.length === 0 || workerId !== this.currentProcess) {
      this.processInfos[workerId].bufferRequestQueue.push({
        requestedLen,
        lck,
        readLen,
        sharedBuffer: buf,
      });
    } else {
      readLen[0] =
        this.buffer.length > requestedLen ? requestedLen : this.buffer.length;
      for (let j = 0; j < readLen[0]; j += 1) {
        buf[j] = this.buffer.charCodeAt(j);
      }
      this.buffer = this.buffer.slice(readLen[0]);
      Atomics.store(lck, 0, constants.WASI_ESUCCESS);
      Atomics.notify(lck, 0);
    }
  }
}
