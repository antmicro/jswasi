import { VirtualFilesystemDescriptor } from "./virtual-filesystem.js";

import { Whence, AbstractDeviceDescriptor } from "./filesystem.js";

import * as constants from "../constants.js";

export class VirtualNull
  extends AbstractDeviceDescriptor
  implements VirtualFilesystemDescriptor
{
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

  async write(buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
  }

  async pwrite(
    buffer: ArrayBuffer,
    _offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
  }

  async seek(
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
