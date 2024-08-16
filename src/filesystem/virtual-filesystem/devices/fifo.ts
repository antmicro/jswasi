import * as constants from "../../../constants.js";

import { AbstractVirtualDeviceDescriptor } from "./abstract-device-descriptor.js";
import { VirtualFilesystemDescriptor } from "../virtual-filesystem.js";
import { UserData, EventType, PollEvent } from "../../../types.js";

import { Fdflags, Rights } from "../../filesystem.js";

// @ts-ignore
import * as vfs from "../../../third_party/vfs.js";

export const enum fifoMode {
  // only the kernelspace can open the fifo for writing
  KERN_W = 0,
  // only the kernelspace can open the fifo for reading
  KERN_R = 1,
  // the fifo will be removed once all readers and writers close their descriptors and there is no data left to read
  CLOSERM = 2,
};

export const enum fifoPeerState {
  NOT_OPENED = 0,
  OPENED = 1,
  CLOSED = 2,
};

// Open calls on the fifo descriptor are nonblocking, data can be written
// to a fifo descriptor even if there are no readable descriptors open at
// the time.
export class FifoDescriptor
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor {
  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.Fifo,
    protected remover: () => void
  ) {
    super(
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      ino,
    );
  }

  isatty(): boolean {
    return false;
  }

  override async read(len: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    let buf = await this.ino.read();
    if (buf.byteLength > len)
      buf.resize(len);

    return {
      err: constants.WASI_ESUCCESS,
      buffer: buf,
    };
  }

  override async write(buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    await this.ino.write(buffer);

    return {
      err: constants.WASI_ESUCCESS,
      written: BigInt(buffer.byteLength)
    };
  }

  override async addPollSub(
    userdata: UserData,
    eventType: EventType,
    _workerId: number
  ): Promise<PollEvent> {
    const nbytes = BigInt(await this.ino.addPollSub());

    return {
      userdata,
      error: constants.WASI_ESUCCESS,
      eventType,
      nbytes,
    };
  }

  override async ioctl(request: number, buf?: Uint8Array): Promise<number> {
    this.ino.setMode(request, buf[0] !== 0);
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  override close(): Promise<number> {
    if ((this.fdstat.fs_rights_base & constants.WASI_RIGHT_FD_WRITE) !== 0n)
      this.ino.writer = fifoPeerState.CLOSED;
    if ((this.fdstat.fs_rights_base & constants.WASI_RIGHT_FD_READ) !== 0n)
      this.ino.reader = fifoPeerState.CLOSED;

    if (this.ino.isCloserm()
      && this.ino.writer === fifoPeerState.CLOSED
      && this.ino.reader === fifoPeerState.CLOSED
    ) {
      this.remover();
    }

    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  override duplicateFd() {
    if ((this.fdstat.fs_rights_base & constants.WASI_RIGHT_FD_WRITE) !== 0n)
      this.ino.writer++;
    if ((this.fdstat.fs_rights_base & constants.WASI_RIGHT_FD_READ) !== 0n)
      this.ino.reader++;
  }
}
