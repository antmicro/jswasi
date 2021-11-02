import * as constants from "./constants.js";
import { WorkerTable } from "./worker-table.js";
import { FileOrDir, OpenFlags, File, Directory, OpenFile, OpenDirectory } from "./browser-fs.js";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const RED_ANSI = "\u001b[31m";
const RESET = "\u001b[0m";

export interface IO {
  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer);
  write(content: Uint8Array): Promise<number>;
  stat(): Promise<{
    dev: bigint;
    ino: bigint;
    file_type: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }>;
}

export class Stdin implements IO {
  file_type: constants.WASI_FILETYPE_CHARACTER_DEVICE;
  constructor(private workerTable: WorkerTable) {}

  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    const lck = new Int32Array(sbuf, 0, 1);
    const readlen = new Int32Array(sbuf, 4, 1);
    const readbuf = new Uint8Array(sbuf, 8, requestedLen);
    this.workerTable.sendBufferToWorker(
      workerId,
      requestedLen,
      lck,
      readlen,
      readbuf
    );
  }

  async write(content: Uint8Array): Promise<number> {
    throw "can't write to stdin!";
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    file_type: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
    return {
      dev: 0n,
      ino: 0n,
      file_type: this.file_type,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    };
  }
}

export class Stdout implements IO {
  file_type: constants.WASI_FILETYPE_CHARACTER_DEVICE;

  constructor(private workerTable: WorkerTable) {}

  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    throw "can't read from stdout!";
  }

  async write(content: Uint8Array): Promise<number> {
    this.workerTable.receiveCallback(
      DECODER.decode(content.slice(0)).replaceAll("\n", "\r\n")
    );
    return constants.WASI_ESUCCESS;
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    file_type: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
    return {
      dev: 0n,
      ino: 0n,
      file_type: this.file_type,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    };
  }
}

export class Stderr implements IO {
  file_type: constants.WASI_FILETYPE_CHARACTER_DEVICE;

  constructor(private workerTable: WorkerTable) {}

  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    throw "can't read from stderr!";
  }

  async write(content: Uint8Array): Promise<number> {
    const output = DECODER.decode(content.slice(0)).replaceAll("\n", "\r\n");
    this.workerTable.receiveCallback(`${RED_ANSI}${output}${RESET}`);
    return constants.WASI_ESUCCESS;
  }

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    file_type: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
    return {
      dev: 0n,
      ino: 0n,
      file_type: this.file_type,
      nlink: 0n,
      size: 0n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    };
  }
}

export class OpenedFd implements IO {
  constructor(private openedFile: OpenFile) {}

  get path(): string {
    return this.openedFile.path;
  }

  async read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    const lck = new Int32Array(sbuf, 0, 1);
    const readlen = new Int32Array(sbuf, 4, 1);
    const readbuf = new Uint8Array(sbuf, 8, requestedLen);

    const [data, err] = await this.openedFile.read(requestedLen);
    if (err === 0) {
      readbuf.set(data);
      readlen[0] = data.byteLength;
    }
    Atomics.store(lck, 0, err);
    Atomics.notify(lck, 0);
  }

  async write(content: Uint8Array): Promise<number> {
    return await this.openedFile.write(content.slice(0));
  }

  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    file_type: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
    return await this.openedFile.stat();
  }

  async lastModified(): Promise<number> {
    return await this.openedFile.lastModified();
  }

  open(): OpenedFd {
    return this.openedFile.open();
  }

  async seek(offset: number, whence: number): Promise<number> {
    return await this.openedFile.seek(offset, whence);
  }

  async truncate(size: number = 0) {
    await this.openedFile.truncate(size);
  }
}
