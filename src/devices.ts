import * as constants from "./constants.js";
import ProcessManager from "./process-manager.js";
import {
  UserData,
  PollEvent,
  Dirent,
  Fdflags,
  Fdstat,
  Filestat,
  Filetype,
  Rights,
  Timestamp,
  Whence,
} from "./filesystem/filesystem.js";
import { PollEntry, HtermEventSub } from "./types.js";
import { Descriptor } from "./filesystem/filesystem";

export interface In {
  fileType: Filetype;
  isPreopened: boolean;
  rightsBase: Rights;
  rightsInheriting: Rights;
  fdFlags: Fdflags;
}

export interface Out {
  fileType: Filetype;
  isPreopened: boolean;
  rightsBase: Rights;
  rightsInheriting: Rights;
  fdFlags: Fdflags;
}

// EventSource implements write end fifo features
export class EventSource implements Descriptor, In {
  // In unix, crossterm uses pipe as event source
  // Wasi doesn't define filetype pipe/fifo so it's defined as char device
  fileType = constants.WASI_FILETYPE_CHARACTER_DEVICE;
  isPreopened = true;
  rightsBase = constants.WASI_EXT_RIGHTS_STDIN;
  rightsInheriting = 0n;
  fdFlags = 0;

  occuredEvents = constants.WASI_EXT_NO_EVENT;
  eventSub: HtermEventSub;
  poolSub: PollEntry | null = null;

  constructor(
    private workerTable: ProcessManager,
    private processId: number,
    public readonly subscribedEvents: bigint
  ) {
    this.eventSub = { processId, eventSourceFd: this } as HtermEventSub;
    this.workerTable.events.subscribeEvent(this.eventSub, subscribedEvents);
  }

  getFdstat(): Promise<Fdstat> {
    return Promise.resolve({
      fs_filetype: this.fileType,
      fs_flags: this.fdFlags,
      fs_rights_base: this.rightsBase,
      fs_rights_inheriting: this.rightsInheriting,
    } as Fdstat);
  }

  getFilestat(): Promise<Filestat> {
    // TODO: Mostly dummy values
    return Promise.resolve({
      dev: 0n,
      ino: 0n,
      filetype: this.fileType,
      nlink: 0n,
      size: 0n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    } as Filestat);
  }

  initialize(_path: string): Promise<void> {
    // TODO: For now ignore it
    return Promise.resolve();
  }

  getPath(): string {
    // TODO: return /dev/{event-source-device} ?
    return undefined;
  }

  setFilestatTimes(_atim: Timestamp, _mtim: Timestamp): Promise<number> {
    // TODO: set atim and mtim
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  setFdstatFlags(flags: Fdflags): Promise<number> {
    this.fdFlags = flags;
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  setFdstatRights(
    rightsBase: Rights,
    rightsInheriting: Rights
  ): Promise<number> {
    this.rightsBase = rightsBase;
    this.rightsInheriting = rightsInheriting;
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  close(): Promise<number> {
    this.workerTable.events.unsubscribeEvent(
      this.eventSub,
      this.subscribedEvents
    );
    let termination =
      this.workerTable.processInfos[this.processId].terminationNotifier;
    if (termination !== null && termination == this) {
      this.workerTable.processInfos[this.processId].terminationNotifier = null;
    }
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  read(
    _len: number,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    // TODO: handle sharedBuff and processId can be undefined
    // TODO: adapt this to new read signature
    // const lck = new Int32Array(sharedBuff, 0, 1);
    // const readLen = new Int32Array(sharedBuff, 4, 1);
    // const readBuf = new Uint8Array(sharedBuff, 8, len);

    // this.readEvents(len, readLen, readBuf);

    // Atomics.store(lck, 0, constants.WASI_ESUCCESS);
    // Atomics.notify(lck, 0);

    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      buffer: undefined,
    });
  }

  read_str(): Promise<{ err: number; content: string }> {
    // TODO: For now ignore it
    return Promise.resolve({
      err: constants.WASI_ENOTSUP,
      content: undefined,
    });
  }

  pread(
    _len: number,
    _pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    // TODO: For now ignore it
    return Promise.resolve({
      err: constants.WASI_ENOTSUP,
      buffer: undefined,
    });
  }

  arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return Promise.resolve({
      err: constants.WASI_EBADF,
      buffer: undefined,
    });
  }

  write(_buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    return Promise.resolve({
      err: constants.WASI_EBADF,
      written: 0n,
    });
  }

  pwrite(
    _buffer: ArrayBuffer,
    _offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    return Promise.resolve({
      err: constants.WASI_EBADF,
      written: 0n,
    });
  }

  seek(
    _offset: bigint,
    _whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    return Promise.resolve({
      err: constants.WASI_EBADF,
      offset: 0n,
    });
  }

  readdir(_refresh: boolean): Promise<{ err: number; dirents: Dirent[] }> {
    return Promise.resolve({
      err: constants.WASI_ENOTDIR,
      dirents: undefined,
    });
  }

  writableStream(): Promise<{ err: number; stream: WritableStream }> {
    return Promise.resolve({
      err: constants.WASI_EBADF,
      stream: undefined,
    });
  }

  isatty(): boolean {
    return false;
  }

  truncate(_size: bigint): Promise<number> {
    // TODO: check error code is ok
    return Promise.resolve(constants.WASI_EBADF);
  }

  readEvents(requestedLen: number, readLen: Int32Array, buf: Uint8Array): void {
    readLen[0] =
      requestedLen < constants.WASI_EXT_EVENT_MASK_SIZE
        ? requestedLen
        : constants.WASI_EXT_EVENT_MASK_SIZE;

    let mask = 0xffn;
    for (let i = 0; i < readLen[0]; i++) {
      let val = this.occuredEvents & (mask << BigInt(i * 8));
      buf[i] = Number(val >> BigInt(i * 8));
      this.occuredEvents ^= val;
    }
  }

  sendEvents(events: bigint): void {
    this.occuredEvents |= events;

    if (this.poolSub !== null) {
      const entry = this.poolSub;
      this.poolSub = null;
      if (
        Atomics.load(entry.data, 0) == constants.WASI_EXT_POLL_BUF_STATUS_VALID
      ) {
        Atomics.store(entry.data, 1, constants.WASI_EXT_EVENT_MASK_SIZE);
        Atomics.store(entry.data, 0, constants.WASI_EXT_POLL_BUF_STATUS_READY);
        Atomics.store(entry.lck, 0, 0);
        Atomics.notify(entry.lck, 0);
      }
    }
  }

  availableBytes(_workerId: number): number {
    return this.occuredEvents != constants.WASI_EXT_NO_EVENT
      ? constants.WASI_EXT_EVENT_MASK_SIZE
      : 0;
  }

  setPollEntry(userLock: Int32Array, userBuffer: Int32Array): void {
    this.poolSub = { lck: userLock, data: userBuffer } as PollEntry;
  }

  obtainEvents(events: bigint): bigint {
    let result = this.occuredEvents & events;
    this.occuredEvents ^= result;
    return result;
  }

  async ioctl(
    _request: number,
    _buf: Uint8Array
  ): Promise<{ err: number; written: number }> {
    return {
      err: constants.WASI_ENOTTY,
      written: 0,
    };
  }

  async addPollSub(
    userdata: UserData,
    eventType: number,
    _workerId: number
  ): Promise<PollEvent> {
    return {
      userdata,
      error: constants.WASI_ESUCCESS,
      eventType,
      nbytes: 0,
    };
  }
}
