import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import { Stat } from "./filesystem/enums.js";

const RED_ANSI = "\u001b[31m";
const RESET = "\u001b[0m";

export interface In {
  fileType: number;
  isPreopened: boolean;
  fdRights: bigint;
  isatty(): boolean;
  stat(): Promise<Stat>;

  scheduleRead(
    workerId: number,
    requestedLen: number,
    sharedBuffer: SharedArrayBuffer
  ): Promise<void>;

  close(): Promise<void>;
}

export interface Out {
  fileType: number;
  isPreopened: boolean;
  fdRights: bigint;
  isatty(): boolean;
  stat(): Promise<Stat>;

  write(content: Uint8Array): Promise<number>;

  close(): Promise<void>;
}

export class Stdin implements In {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;
  isPreopened = true;
  fdRights = constants.WASI_RIGHTS_STDIN;

  constructor(private workerTable: ProcessManager) {}

  // eslint-disable-next-line class-methods-use-this
  isatty() {
    return true;
  }

  scheduleRead(
    workerId: number,
    requestedLen: number,
    sbuf: SharedArrayBuffer
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
}

export class Stdout implements Out {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;
  isPreopened = true;
  fdRights = constants.WASI_RIGHTS_STDOUT;

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
    return Promise.resolve();
  }

  seek(): number {
    return 0;
  }
}

export class Stderr implements Out {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;
  isPreopened = true;
  fdRights = constants.WASI_RIGHTS_STDERR;

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
