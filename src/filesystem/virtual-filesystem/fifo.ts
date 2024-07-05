import * as constants from "../../constants.js";

import { AbstractVirtualDeviceDescriptor } from "./device-filesystem.js";
import { VirtualFilesystemDescriptor } from "./virtual-filesystem.js";
import { UserData, EventType, PollEvent } from "../../types.js";

// @ts-ignore
import * as vfs from "../../third_party/vfs.js";

export class FifoDescriptor 
  extends AbstractVirtualDeviceDescriptor 
  implements VirtualFilesystemDescriptor
{
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
    const nbytes = await this.ino.addPollSub();

    return {
      userdata,
      error: constants.WASI_ESUCCESS,
      eventType,
      nbytes,
    };
  }
}
