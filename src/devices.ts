import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import { Stat } from "./filesystem/enums.js";

const DECODER = new TextDecoder();

const RED_ANSI = "\u001b[31m";
const RESET = "\u001b[0m";

export interface In {
  fileType: number;
  isatty(): boolean;
  stat(): Promise<Stat>;

  scheduleRead(
    workerId: number,
    requestedLen: number,
    sharedBuffer: SharedArrayBuffer
  ): Promise<void>;
}

export interface Out {
  fileType: number;
  isatty(): boolean;
  stat(): Promise<Stat>;

  write(content: Uint8Array): Promise<number>;
}

export class Stdin implements In {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;

  constructor(private workerTable: ProcessManager) {}

  // eslint-disable-next-line class-methods-use-this
  isatty() {
    return true;
  }

  async scheduleRead(
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
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<Stat> {
    return {
      dev: 0n,
      ino: 0n,
      fileType: this.fileType,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    };
  }
}

export class Stdout implements Out {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;

  constructor(private workerTable: ProcessManager) {}

  // eslint-disable-next-line class-methods-use-this
  isatty() {
    return true;
  }

  async write(content: Uint8Array): Promise<number> {
    this.workerTable.terminalOutputCallback(
      DECODER.decode(content.slice(0)).replaceAll("\n", "\r\n")
    );
    return constants.WASI_ESUCCESS;
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<Stat> {
    return {
      dev: 0n,
      ino: 0n,
      fileType: this.fileType,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    };
  }
}

export class Stderr implements Out {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;

  constructor(private workerTable: ProcessManager) {}

  // eslint-disable-next-line class-methods-use-this
  isatty() {
    return true;
  }

  async write(content: Uint8Array): Promise<number> {
    const output = DECODER.decode(content.slice(0)).replaceAll("\n", "\r\n");
    this.workerTable.terminalOutputCallback(`${RED_ANSI}${output}${RESET}`);
    return constants.WASI_ESUCCESS;
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<Stat> {
    return {
      dev: 0n,
      ino: 0n,
      fileType: this.fileType,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    };
  }

  async seek(offset: number, whence: number): Promise<number> {
    return 0; // do nothing
  }
}
