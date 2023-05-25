import { VirtualFilesystemDescriptor } from "./virtual-filesystem.js";
// @ts-ignore
import * as vfs from "../../vendor/vfs.js";
import { Whence, Fdflags, Rights, Descriptor } from "../filesystem.js";
import { DeviceDriver } from "./driver-manager.js";
import * as constants from "../../constants.js";
import { AbstractVirtualDeviceDescriptor } from "./device-filesystem.js";

export const enum minor {
  DEV_NULL = 0,
  DEV_ZERO = 1,
  DEV_RANDOM = 2,
}

export class MemoryDeviceDriver implements DeviceDriver {
  private devices: {
    [key in minor]: new (
      fs_flags: Fdflags,
      fs_rights_base: Rights,
      fs_rights_inheriting: Rights,
      ino: vfs.CharacterDev
    ) => Descriptor;
  };

  async initDriver(): Promise<number> {
    this.devices = {
      [minor.DEV_NULL]: VirtualNullDescriptor,
      [minor.DEV_ZERO]: VirtualZeroDescriptor,
      [minor.DEV_RANDOM]: VirtualRandomDescriptor,
    };
    return constants.WASI_ESUCCESS;
  }

  async initDevice(_min: number): Promise<number> {
    return constants.WASI_ESUCCESS;
  }
  async teardownDevice(_min: number): Promise<number> {
    return constants.WASI_ESUCCESS;
  }
  async teardownDriver(): Promise<number> {
    return constants.WASI_ESUCCESS;
  }

  async getDesc(
    min: minor,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev
  ): Promise<{ desc: Descriptor; err: number }> {
    return {
      desc: new this.devices[min](
        fs_flags,
        fs_rights_base,
        fs_rights_inheriting,
        ino
      ),
      err: constants.WASI_ESUCCESS,
    };
  }
}

class VirtualNullDescriptor
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor
{
  isatty(): boolean {
    return false;
  }

  override async read(
    _len: number,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return {
      err: constants.WASI_ESUCCESS,
      buffer: new ArrayBuffer(0),
    };
  }

  override async pread(
    _len: number,
    _pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return {
      err: constants.WASI_ESUCCESS,
      buffer: new ArrayBuffer(0),
    };
  }

  override async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return {
      err: constants.WASI_ESUCCESS,
      buffer: new ArrayBuffer(0),
    };
  }

  override async read_str(): Promise<{ err: number; content: string }> {
    return { err: constants.WASI_ESUCCESS, content: "" };
  }

  override async write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
  }

  override async pwrite(
    buffer: ArrayBuffer,
    _offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
  }

  override async seek(
    _offset: bigint,
    _whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    return { err: constants.WASI_ESUCCESS, offset: 0n };
  }

  // TODO: add dummy writableStream

  override async truncate(_size: bigint): Promise<number> {
    return constants.WASI_ESUCCESS;
  }
}

class VirtualZeroDescriptor extends VirtualNullDescriptor {
  override async read(
    len: number,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    let __buf = new ArrayBuffer(len);
    let __view8 = new Uint8Array(__buf);
    __view8.fill(0, 0, len);

    return {
      err: constants.WASI_ESUCCESS,
      buffer: __buf,
    };
  }

  override async pread(
    len: number,
    _pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return this.read(len);
  }
}

class VirtualRandomDescriptor extends VirtualNullDescriptor {
  override async read(
    len: number,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    let __buf = new ArrayBuffer(len);
    let __view8 = new Uint8Array(__buf);
    for (var i = 0; i < len; i++) {
      __view8.set([Math.floor(Math.random() * 256)], i);
    }

    return {
      err: constants.WASI_ESUCCESS,
      buffer: __buf,
    };
  }

  override async pread(
    len: number,
    _pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return this.read(len);
  }
}
