import * as constants from './constants.js';
import { WorkerTable } from './worker-table.js';
import { OpenFile } from './browser-fs.js';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const RED_ANSI = '\u001b[31m';
const RESET = '\u001b[0m';

export interface IO {
  read(workerId: number, requestedLen: number, lck: Int32Array, readlen: Int32Array, readbuf: Uint8Array): void;
  write(content: Uint8Array): number;
}

export class Stdin implements IO {
  constructor(private workerTable: WorkerTable) {}
  
  read(workerId: number, requestedLen: number, lck: Int32Array, readlen: Int32Array, readbuf: Uint8Array) {
    this.workerTable.sendBufferToWorker(workerId, requestedLen, lck, readlen, readbuf);
  }

  write(content: Uint8Array): number {
    throw "can't write to stdin!";
  }
}

export class Stdout implements IO {
  constructor(private workerTable: WorkerTable) {}

  read(workerId: number, requestedLen: number, lck: Int32Array, readlen: Int32Array, readbuf: Uint8Array) {
    throw "can't read from stdout!";
  }
  
  write(content: Uint8Array): number {
    this.workerTable.receiveCallback(DECODER.decode(content).replaceAll('\n', '\r\n'));
    return constants.WASI_ESUCCESS;
  }

}

export class Stderr implements IO {
  constructor(private workerTable: WorkerTable) {}

  read(workerId: number, requestedLen: number, lck: Int32Array, readlen: Int32Array, readbuf: Uint8Array) {
    throw "can't read from stderr!";
  }
  
  write(content: Uint8Array): number {
	const output = DECODER.decode(content).replaceAll('\n', '\r\n');
    this.workerTable.receiveCallback(`${RED_ANSI}${output}${RESET}`);
    return constants.WASI_ESUCCESS;
  }

}

export class OpenedFd {
  constructor(private openedFile: OpenFile) {}

  async read(workerId: number, requestedLen: number, lck: Int32Array, readlen: Int32Array, readbuf: Uint8Array) {
    const [data, err] = await this.openedFile.read(requestedLen);
    if (err === 0) {
      readbuf.set(data);
      readlen[0] = data.byteLength;
    }
    Atomics.store(lck, 0, err);
    Atomics.notify(lck, 0);
  }

  async write(content: Uint8Array): Promise<number> {
    // for some reason writable cannot use shared arrays?
    return await this.openedFile.write(content);
  }
}
