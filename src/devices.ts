import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import { Stat } from "./filesystem/enums.js";

const RED_ANSI = "\u001b[31m";
const RESET = "\u001b[0m";

export interface In {
  fileType: number;
  isPreopened: boolean;
  isatty(): boolean;
  stat(): Promise<Stat>;
  rightsBase: bigint;
  rightsInheriting: bigint;
  fdFlags: number;

  scheduleRead(
    workerId: number,
    requestedLen: number,
    sharedBuffer: SharedArrayBuffer,
    pread?: bigint
  ): Promise<void>;

  close(): Promise<void>;
}

export interface Out {
  fileType: number;
  isPreopened: boolean;
  isatty(): boolean;
  stat(): Promise<Stat>;
  rightsBase: bigint;
  rightsInheriting: bigint;
  fdFlags: number;

  write(content: Uint8Array): Promise<number>;

  close(): Promise<void>;
}

export class Stdin implements In {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;
  isPreopened = true;
  rightsBase = constants.WASI_RIGHTS_STDIN;
  rightsInheriting = 0n;
  fdFlags = 0;

  constructor(private workerTable: ProcessManager) {}

  // eslint-disable-next-line class-methods-use-this
  isatty() {
    return true;
  }

  scheduleRead(
    workerId: number,
    requestedLen: number,
    sbuf: SharedArrayBuffer,
    pread?: bigint
  ): Promise<void> {
    const lck = new Int32Array(sbuf, 0, 1);
    const readLen = new Int32Array(sbuf, 4, 1);
    const readBuf = new Uint8Array(sbuf, 8, requestedLen);
    this.workerTable.sendBufferToProcess(
      workerId,
      requestedLen,
      lck,
      readLen,
      readBuf
    );

    return Promise.resolve();
  }

  // TODO: fill dummy values with something meaningful
  stat(): Promise<Stat> {
    return Promise.resolve({
      dev: 0n,
      ino: 0n,
      fileType: this.fileType,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  seek(): number {
    return 0;
  }

  availableBytes(workerId: number): Promise<number> {
    if (this.workerTable.currentProcess !== workerId) {
      return Promise.resolve(0);
    }

    let availableBytes = this.workerTable.buffer.length;
    let pendingBytes = 0;

    if (availableBytes > 0) {
      // check wheter left some bytes
      const queue = this.workerTable.processInfos[workerId].bufferRequestQueue;
      for (let request of queue) {
        availableBytes -= request.requestedLen;
        if (availableBytes <= 0) {
          break;
        }
      }
      pendingBytes = availableBytes > 0 ? availableBytes : 0;
    }

    return Promise.resolve(pendingBytes);
  }

  setPollEntry(
    workerId: number,
    userLock: Int32Array,
    userBuffer: Int32Array
  ): Promise<void> {
    this.workerTable.processInfos[workerId].stdinPollSub = {
      lck: userLock,
      data: userBuffer,
    };
    return Promise.resolve();
  }
}

export class Stdout implements Out {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;
  isPreopened = true;
  rightsBase = constants.WASI_RIGHTS_STDOUT;
  rightsInheriting = 0n;
  fdFlags = constants.WASI_FDFLAG_APPEND;

  constructor(private workerTable: ProcessManager) {}

  // eslint-disable-next-line class-methods-use-this
  isatty() {
    return true;
  }

  write(content: Uint8Array): Promise<number> {
    // TODO: maybe blocking on this would fix wrong output order in CI (fast paced command bashing)
    this.workerTable.terminalOutputCallback(new TextDecoder().decode(content));
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  // TODO: fill dummy values with something meaningful
  stat(): Promise<Stat> {
    return Promise.resolve({
      dev: 0n,
      ino: 0n,
      fileType: this.fileType,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    });
  }

  close(): Promise<void> {
    // TODO: handle pollQueue
    return Promise.resolve();
  }

  seek(): number {
    return 0;
  }
}

export class Stderr implements Out {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;
  isPreopened = true;
  rightsBase = constants.WASI_RIGHTS_STDERR;
  rightsInheriting = 0n;
  fdFlags = constants.WASI_FDFLAG_APPEND;

  constructor(private workerTable: ProcessManager) {}

  // eslint-disable-next-line class-methods-use-this
  isatty() {
    return true;
  }

  write(content: Uint8Array): Promise<number> {
    this.workerTable.terminalOutputCallback(
      `${RED_ANSI}${new TextDecoder().decode(content)}${RESET}`
    );
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  // TODO: fill dummy values with something meaningful
  stat(): Promise<Stat> {
    return Promise.resolve({
      dev: 0n,
      ino: 0n,
      fileType: this.fileType,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  seek(): number {
    return 0;
  }
}
