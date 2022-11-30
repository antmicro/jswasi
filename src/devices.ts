import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import { Stat } from "./filesystem/enums.js";
import { BufferRequest, PollEntry, HtermEventSub } from "./types.js";

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

  availableBytes(workerId: number): number {
    if (this.workerTable.currentProcess !== workerId) {
      return 0;
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

    return pendingBytes;
  }

  setPollEntry(workerId: number, userLock: Int32Array, userBuffer: Int32Array) {
    this.workerTable.processInfos[workerId].stdinPollSub = {
      lck: userLock,
      data: userBuffer,
    };
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

// EventSource implements write end fifo features
export class EventSource implements In {
  // In unix, crossterm uses pipe as event source
  // Wasi doesn't define filetype pipe/fifo so it's defined as char device
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;
  isPreopened = true;
  rightsBase = constants.WASI_RIGHTS_STDIN;
  rightsInheriting = 0n;
  fdFlags = 0;

  occuredEvents = constants.WASI_NO_EVENT;
  bufferRequestQueue: BufferRequest[] = [];
  eventSub: HtermEventSub;
  poolSub: PollEntry | null = null;

  constructor(
    private workerTable: ProcessManager,
    processId: number,
    private subscribedEvents: bigint
  ) {
    this.eventSub = { processId, eventSourceFd: this } as HtermEventSub;
    this.workerTable.events.subscribeEvent(this.eventSub, subscribedEvents);
  }

  isatty() {
    return false;
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

    this.sendBufferToProcess(requestedLen, lck, readLen, readBuf);

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
    this.workerTable.events.unsubscribeEvent(
      this.eventSub,
      this.subscribedEvents
    );
    return Promise.resolve();
  }

  seek(): number {
    return 0;
  }

  sendBufferToProcess(
    requestedLen: number,
    lck: Int32Array,
    readLen: Int32Array,
    buf: Uint8Array
  ): void {
    if (this.occuredEvents === constants.WASI_NO_EVENT) {
      this.bufferRequestQueue.push({
        requestedLen,
        lck,
        readLen,
        sharedBuffer: buf,
      });
    } else {
      readLen[0] =
        requestedLen < constants.WASI_EVENT_MASK_SIZE
          ? requestedLen
          : constants.WASI_EVENT_MASK_SIZE;

      let mask = 0xffn;
      for (let i = 0; i < readLen[0]; i++) {
        let val = this.occuredEvents & (mask << BigInt(i * 8));
        buf[i] = Number(val >> BigInt(i * 8));
        this.occuredEvents ^= val;
      }

      Atomics.store(lck, 0, constants.WASI_ESUCCESS);
      Atomics.notify(lck, 0);
    }
  }

  sendEvents(events: bigint): void {
    this.occuredEvents |= events;

    while (
      this.occuredEvents !== constants.WASI_NO_EVENT &&
      this.bufferRequestQueue.length !== 0
    ) {
      const { requestedLen, lck, readLen, sharedBuffer } =
        this.bufferRequestQueue.shift();
      this.sendBufferToProcess(requestedLen, lck, readLen, sharedBuffer);
    }

    if (
      this.occuredEvents !== constants.WASI_NO_EVENT &&
      this.poolSub !== null
    ) {
      const entry = this.poolSub;
      this.poolSub = null;
      if (Atomics.load(entry.data, 0) == constants.WASI_POLL_BUF_STATUS_VALID) {
        Atomics.store(entry.data, 1, constants.WASI_EVENT_MASK_SIZE);
        Atomics.store(entry.data, 0, constants.WASI_POLL_BUF_STATUS_READY);
        Atomics.store(entry.lck, 0, 0);
        Atomics.notify(entry.lck, 0);
      }
    }
  }

  availableBytes(workerId: number): number {
    return this.occuredEvents != constants.WASI_NO_EVENT
      ? constants.WASI_EVENT_MASK_SIZE
      : 0;
  }

  setPollEntry(userLock: Int32Array, userBuffer: Int32Array): void {
    this.poolSub = { lck: userLock, data: userBuffer } as PollEntry;
  }
}
