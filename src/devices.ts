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

export interface EventSourceDescriptor extends Descriptor {
  sendEvents(events: EventType): void;
  obtainEvents(events: EventType): EventType;
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

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    public readonly eventMask: EventType
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting);
    this.signalSub = undefined;
    this.events = constants.WASI_EXT_NO_EVENT;
  }

  override getFilestat(): Promise<Filestat> {
    // TODO: Mostly dummy values
    return Promise.resolve({
      dev: 0n,
      ino: 0n,
      filetype: this.fdstat.fs_filetype,
      nlink: 0n,
      size: 0n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    } as Filestat);
  }

  override async setFilestatTimes(
    _atim: Timestamp,
    _mtim: Timestamp
  ): Promise<number> {
    // TODO: set atim and mtim
    return constants.WASI_ESUCCESS;
  }

  // TODO: implement close
  // close(): Promise<number> {
  //   this.workerTable.events.unsubscribeEvent(
  //     this.eventSub,
  //     this.subscribedEvents
  //   );
  //   let termination =
  //     this.workerTable.processInfos[this.processId].terminationNotifier;
  //   if (termination !== null && termination == this) {
  //     this.workerTable.processInfos[this.processId].terminationNotifier = null;
  //   }
  //   return Promise.resolve(constants.WASI_ESUCCESS);
  // }

  override async read(
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

  isatty() {
    return false;
  }

  override async addPollSub(
    userdata: UserData,
    eventType: EventType,
    workerId: number
  ): Promise<PollEvent> {
    return new Promise((resolve: (event: PollEvent) => void) => {
      if (this.events !== constants.WASI_NO_EVENT) {
        resolve({
          userdata,
          eventType: this.events,
          nbytes: 8n,
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
      this.events !== constants.WASI_NO_EVENT &&
      this.signalSub !== undefined
    ) {
      this.signalSub.resolve({
        userdata: this.signalSub.userdata,
        error: constants.WASI_ESUCCESS,
        eventType: this.events,
        nbytes: 4n,
      });

      this.signalSub = undefined;
      this.events = constants.WASI_EXT_NO_EVENT;
    }
  }

  obtainEvents(events: EventType): EventType {
    const __events = this.events & events;
    this.events ^= __events;
    return __events;
  }
}
