import {
  wasiFilestat,
  VirtualFilesystemDescriptor,
} from "./virtual-filesystem.js";

// @ts-ignore
import * as vfs from "../../vendor/vfs.js";

import {
  Whence,
  Filestat,
  Fdflags,
  Rights,
  AbstractDeviceDescriptor,
} from "../filesystem.js";

import * as constants from "../../constants.js";

export class VirtualNull
  extends AbstractDeviceDescriptor
  implements VirtualFilesystemDescriptor
{
  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    protected ino: vfs.CharacterDev
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting);
  }

  isatty(): boolean {
    return false;
  }

  override async read(
    _len: number,
    _sharedBuff?: ArrayBuffer,
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

  override async getFilestat(): Promise<Filestat> {
    return wasiFilestat(this.ino._metadata);
  }
}
