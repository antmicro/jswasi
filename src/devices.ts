import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import { OpenFile, Stat } from "./filesystem.js";

const DECODER = new TextDecoder();

const RED_ANSI = "\u001b[31m";
const RESET = "\u001b[0m";

export interface IO {
  fileType: number;
  isatty: boolean;
  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer): void;
  write(content: Uint8Array): Promise<number>;
  stat(): Promise<{
    dev: bigint;
    ino: bigint;
    fileType: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }>;
}

export class Stdin implements IO {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;

  isatty = true;

  constructor(private workerTable: ProcessManager) {}

  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    const lck = new Int32Array(sbuf, 0, 1);
    const readlen = new Int32Array(sbuf, 4, 1);
    const readbuf = new Uint8Array(sbuf, 8, requestedLen);
    this.workerTable.sendBufferToProcess(
      workerId,
      requestedLen,
      lck,
      readlen,
      readbuf
    );
  }

  async write(content: Uint8Array): Promise<number> {
    throw Error("can't write to stdin!");
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    fileType: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
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

export class Stdout implements IO {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;

  isatty = true;

  constructor(private workerTable: ProcessManager) {}

  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    throw Error("can't read from stdout!");
  }

  async write(content: Uint8Array): Promise<number> {
    this.workerTable.terminalOutputCallback(
      DECODER.decode(content.slice(0)).replaceAll("\n", "\r\n")
    );
    return constants.WASI_ESUCCESS;
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    fileType: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
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

export class Stderr implements IO {
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;

  isatty = true;

  constructor(private workerTable: ProcessManager) {}

  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    throw Error("can't read from stderr!");
  }

  async write(content: Uint8Array): Promise<number> {
    const output = DECODER.decode(content.slice(0)).replaceAll("\n", "\r\n");
    this.workerTable.terminalOutputCallback(`${RED_ANSI}${output}${RESET}`);
    return constants.WASI_ESUCCESS;
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    fileType: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
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

export class OpenedFd implements IO {
  isatty = false;

  constructor(private openedFile: OpenFile) {
    // empty constructor
  }

  get fileType(): number {
    return this.openedFile.metadata.fileType;
  }

  get name(): string {
    return this.openedFile.name;
  }

  get path(): string {
    return this.openedFile.path;
  }

  get size(): bigint {
    return this.openedFile.metadata.size;
  }

  async read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    const lck = new Int32Array(sbuf, 0, 1);
    const readLen = new Int32Array(sbuf, 4, 1);
    const readBuf = new Uint8Array(sbuf, 8, requestedLen);

    const [data, err] = await this.openedFile.read(requestedLen);
    if (err === 0) {
      readLen[0] = data.byteLength;
      readBuf.set(data);
    }
    Atomics.store(lck, 0, err);
    Atomics.notify(lck, 0);
  }

  async write(content: Uint8Array): Promise<number> {
    return this.openedFile.write(content.slice(0));
  }

  async stat(): Promise<Stat> {
    return this.openedFile.stat();
  }

  open(): OpenedFd {
    return this.openedFile.open();
  }

  async close() {
    await this.openedFile.close();
  }

  async seek(offset: number, whence: number): Promise<number> {
    return this.openedFile.seek(offset, whence);
  }

  async truncate(size: number = 0) {
    await this.openedFile.truncate(size);
  }
}
