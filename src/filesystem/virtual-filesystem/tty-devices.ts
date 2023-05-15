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
  Descriptor,
  AbstractDeviceDescriptor,
} from "../filesystem.js";

import { DeviceDriver } from "./driver-manager.js";

import * as constants from "../../constants.js";

const DEFAULT_BUF_SIZE = 1024;

type Hterm = any;

export class HtermDeviceDriver implements DeviceDriver {
  private maxTty: number;
  private terminals: Record<number, Hterm>;
  private freedTerminals: number[];

  async initDriver(): Promise<number> {
    this.terminals = [];
    this.freedTerminals = [];
    this.maxTty = 0;
    return constants.WASI_ESUCCESS;
  }

  async initDevice(_min: number): Promise<number> {
    let __ttyMin = this.freedTerminals.pop();
    if (!__ttyMin) {
      __ttyMin = this.maxTty++;
    }
    // @ts-ignore
    this.terminals[__ttyMin] = new hterm.Terminal() as Hterm;
    return constants.WASI_ESUCCESS;
  }

  async teardownDevice(min: number): Promise<number> {
    if (this.terminals[min]) {
      delete this.terminals[min];
      this.freedTerminals.push(min);
      return constants.WASI_ESUCCESS;
    } else {
      return constants.WASI_ENOENT;
    }
  }

  async teardownDriver(): Promise<number> {
    return constants.WASI_ESUCCESS;
  }
}

export const enum ttyMode {
  IN,
  OUT,
  ERR,
}

class VirtualHtermDescriptor extends AbstractDeviceDescriptor {
  private mode: ttyMode;
  // TODO: implement buffered mode for stdout

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    protected ino: vfs.CharacterDev,
    private terminal: Hterm
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting);
    this.mode = ttyMode.IN;
    // this.buffer = new ArrayBuffer(DEFAULT_BUF_SIZE);
  }

  isatty(): boolean {
    return true;
  }

  override async write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }> {
    if (this.mode === ttyMode.IN) {
      return { err: constants.WASI_EBADF, written: -1n };
    }

    this.terminal.write(new TextDecoder().decode(buffer));
    return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
  }

  override async read(
    len: number,
    _sharedBuff?: ArrayBuffer,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    if (this.mode === ttyMode.IN) {
    }
  }
}
