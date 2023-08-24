import * as constants from "./constants.js";
import {
  PollSub,
  Fdflags,
  Filestat,
  Rights,
  Timestamp,
  AbstractDeviceDescriptor,
} from "./filesystem/filesystem.js";
import { UserData, PollEvent, EventType } from "./types.js";
import { Descriptor } from "./filesystem/filesystem.js";

export type StopResolver = {
  resolve: (desc: EventSourceDescriptor) => void;
  reject: () => void;
};

export interface EventSourceDescriptor extends Descriptor {
  sendEvents(events: EventType): void;
  obtainEvents(events: EventType): EventType;
  makeNotifier(resolve: StopResolver): number;
}

// EventSource implements write end fifo features
export class EventSource
  // In unix, crossterm uses pipe as event source
  // Wasi doesn't define filetype pipe/fifo so it's defined as char device
  extends AbstractDeviceDescriptor
  implements EventSourceDescriptor
{
  private signalSub?: PollSub;
  private events: EventType;
  private stopResolver: StopResolver;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    private readonly eventMask: EventType
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting);
    this.events = constants.WASI_EXT_NO_EVENT;

    this.stopResolver = undefined;
    this.signalSub = undefined;
  }

  override getFilestat(): Promise<{ err: number; filestat: Filestat }> {
    // TODO: Mostly dummy values
    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      filestat: {
        dev: 0n,
        ino: 0n,
        filetype: this.fdstat.fs_filetype,
        nlink: 0n,
        size: 0n,
        mtim: 0n,
        atim: 0n,
        ctim: 0n,
      } as Filestat,
    });
  }

  override async setFilestatTimes(
    _atim: Timestamp,
    _mtim: Timestamp
  ): Promise<number> {
    // TODO: set atim and mtim
    return constants.WASI_ESUCCESS;
  }

  // TODO: implement close
  override async close(): Promise<number> {
    if (this.stopResolver) this.stopResolver.resolve(this);

    return constants.WASI_ESUCCESS;
  }

  override async read(
    len: number,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    if (len < 4) return { err: constants.WASI_ENOBUFS, buffer: undefined };

    const buffer = new ArrayBuffer(4);
    const arr32 = new Uint32Array(buffer);
    arr32[0] = this.events;
    this.events = constants.WASI_EXT_NO_EVENT;

    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      buffer,
    });
  }

  isatty() {
    return false;
  }

  override addPollSub(
    userdata: UserData,
    eventType: EventType,
    workerId: number
  ): Promise<PollEvent> {
    return new Promise((resolve: (event: PollEvent) => void) => {
      if (this.events !== constants.WASI_EXT_NO_EVENT) {
        resolve({
          userdata,
          eventType: this.events,
          nbytes: 4n,
          error: constants.WASI_ESUCCESS,
        });
      } else {
        this.signalSub = {
          pid: workerId,
          userdata,
          tag: eventType,
          resolve,
        };
      }
    });
  }

  sendEvents(events: EventType): void {
    this.events |= events & this.eventMask;

    if (
      this.events !== constants.WASI_EXT_NO_EVENT &&
      this.signalSub !== undefined
    ) {
      this.signalSub.resolve({
        userdata: this.signalSub.userdata,
        error: constants.WASI_ESUCCESS,
        eventType: constants.WASI_EVENTTYPE_FD_READ,
        nbytes: 4n,
      });

      this.signalSub = undefined;
    }
  }

  obtainEvents(events: EventType): EventType {
    const __events = this.events & events;
    this.events ^= __events;
    return __events;
  }

  makeNotifier(stopResolver: StopResolver): number {
    if (this.eventMask & constants.WASI_EXT_EVENT_SIGINT) {
      if (this.stopResolver !== undefined) this.stopResolver.resolve(this);

      this.stopResolver = stopResolver;
      return constants.WASI_ESUCCESS;
    }

    stopResolver.reject();
    return constants.WASI_EINVAL;
  }
}
