import * as constants from './constants.js';
import { WorkerTable } from './worker-table.js';
import { FileOrDir, OpenFlags } from './filesystem.js';
import { File, Directory, OpenFile, OpenDirectory } from './browser-fs.js';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const RED_ANSI = '\u001b[31m';
const RESET = '\u001b[0m';

export interface IO {
  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer);
  write(content: Uint8Array): Promise<number>;
}

export class Stdin implements IO {
  constructor(private workerTable: WorkerTable) {}
  
  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    const lck = new Int32Array(sbuf, 0, 1);
    const readlen = new Int32Array(sbuf, 4, 1);
    const readbuf = new Uint8Array(sbuf, 8, requestedLen);
    this.workerTable.sendBufferToWorker(workerId, requestedLen, lck, readlen, readbuf);
  }

  async write(content: Uint8Array): Promise<number> {
    throw "can't write to stdin!";
  }
}

export class Stdout implements IO {
  constructor(private workerTable: WorkerTable) {}

  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    throw "can't read from stdout!";
  }
  
  async write(content: Uint8Array): Promise<number> {
    this.workerTable.receiveCallback(DECODER.decode(content.slice(0)).replaceAll('\n', '\r\n'));
    return constants.WASI_ESUCCESS;
  }

}

export class Stderr implements IO {
  constructor(private workerTable: WorkerTable) {}

  read(workerId: number, requestedLen: number, sbuf: SharedArrayBuffer) {
    throw "can't read from stderr!";
  }
  
  async write(content: Uint8Array): Promise<number> {
	const output = DECODER.decode(content.slice(0)).replaceAll('\n', '\r\n');
    this.workerTable.receiveCallback(`${RED_ANSI}${output}${RESET}`);
    return constants.WASI_ESUCCESS;
  }

}

export class OpenedFd implements IO {
  constructor(private openedFile: OpenFile) {}

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
  
  async stat(): Promise<{dev: bigint, ino: bigint, file_type: number, nlink: bigint, size: bigint, atim: bigint, mtim: bigint, ctim: bigint}> {
    return await this.openedFile.stat();
  }
  async lastModified(): Promise<number> {
    return await this.openedFile.lastModified();
  }

  async open() {
    return await this.openedFile.open();
  }
}
