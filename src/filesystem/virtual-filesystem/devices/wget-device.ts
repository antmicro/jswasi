import * as constants from "../../../constants.js";
// @ts-ignore
import * as vfs from "../../../third_party/vfs.js";

import { Descriptor, Fdflags, Rights } from "../../filesystem.js";

import { DeviceFilesystem } from "./device-filesystem.js";
import { AbstractVirtualDeviceDescriptor } from "./abstract-device-descriptor.js";
import { DeviceDriver, major } from "./driver-manager.js";
import { VirtualFilesystemDescriptor } from "../virtual-filesystem.js";

export const enum ioctlRequests {
  WGETGS = 0,  // Get status
  WGETRH = 1,  // Read headers
  WGETRB = 2,  // Read body
}

export class WgetDeviceDriver implements DeviceDriver {
  private responses: Record<number, Response>;
  private topResponseId: number;
  private devfs: DeviceFilesystem;

  initDriver(args: { devfs: DeviceFilesystem }): Promise<number> {
    this.topResponseId = 1;
    this.responses = {};
    this.devfs = args.devfs;
    return Promise.resolve(constants.WASI_ESUCCESS);
  }
  teardownDriver(_args: Object): Promise<number> {
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  initDevice(_args: Object): Promise<number> {
    return Promise.resolve(constants.WASI_ESUCCESS);
  }
  teardownDevice(_min: number, _args: Object): Promise<number> {
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  async makeRequest(url: string): Promise<{ err: number; minor: number }> {
    try {
      this.responses[this.topResponseId] = await fetch(url);
      this.devfs.mknodat(
        undefined,
        `wget0r${this.topResponseId}`,
        vfs.mkDev(major.MAJ_WGET, this.topResponseId),
      );
      return {
        err: constants.WASI_ESUCCESS,
        minor: this.topResponseId++
      };
    } catch (e) {
      console.log(e);
      // TODO: Add proper return codes
      return {
        err: constants.WASI_EINVAL,
        minor: -1
      };
    }
  }

  async getDesc(
    min: number,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev
  ): Promise<{ desc?: Descriptor; err: number }> {
    if (min === 0) {
      return {
        err: constants.WASI_ESUCCESS,
        desc: new WgetDevice(
          fs_flags,
          fs_rights_base,
          fs_rights_inheriting,
          ino,
          this
        ),
      }
    } else {
      if (this.responses[min] === undefined)
        return { desc: undefined, err: constants.WASI_ENOENT };

      return {
        err: constants.WASI_ESUCCESS,
        desc: new WgetDataDevice(
          fs_flags,
          fs_rights_base,
          fs_rights_inheriting,
          ino,
          this.responses[min],
          () => this.invalidateResponse(min)
        )
      };
    }
  }

  async invalidateResponse(id: number): Promise<number> {
    delete this.responses[id];
    return this.devfs.unlinkat(undefined, `wget0r${id}`, false);
  }
}

class WgetDevice
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor {
  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev,
    private driver: WgetDeviceDriver
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
  }
  isatty(): boolean { return false; }

  override async write(buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    const __url = new TextDecoder().decode(buffer);
    const { err, minor } = await this.driver.makeRequest(__url);

    return {
      err,
      written: BigInt(minor),
    };
  }
}

const enum bufferType {
  HEADERS,
  BODY
}

class WgetDataDevice
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor {
  private currentBuffer: bufferType;
  private body: ArrayBuffer;
  private headers: ArrayBuffer;
  private hCursor: number;
  private bCursor: number;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev,
    private response: Response,
    private invalidate: () => Promise<number>
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
    this.currentBuffer = bufferType.BODY;
    this.hCursor = 0;
    this.bCursor = 0;
    let __headers = []
    for (const [key, val] of this.response.headers.entries()) {
      __headers.push(`${key}: ${val}`);
    }
    const arr = new TextEncoder().encode(__headers.join('\n'));
    this.headers = arr.buffer as ArrayBuffer;
  }
  isatty(): boolean { return false; }

  override async read(len: number, _workerId?: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    let buffer;
    if (this.currentBuffer === bufferType.BODY) {
      // TODO: This should use readable stream so that the entire body does
      // not have to be saved in memory before it can be read
      if (this.body === undefined)
        this.body = await this.response.arrayBuffer();

      buffer = this.body.slice(this.bCursor, this.bCursor + len);
      this.bCursor += buffer.byteLength;
    } else {
      buffer = this.headers.slice(this.hCursor, this.hCursor + len);
      this.hCursor += buffer.byteLength;
    }

    return {
      err: constants.WASI_ESUCCESS,
      buffer
    };
  }

  override close(): Promise<number> {
    return this.invalidate();
  }

  override async ioctl(request: number, buf?: Uint8Array): Promise<number> {
    switch (request) {
      case ioctlRequests.WGETGS: {
        if (buf === undefined || buf.byteLength < 4)
          return constants.WASI_ENOBUFS;

        const __buf = new Int32Array(buf.buffer, buf.byteOffset);

        __buf[0] = this.response.status;
        return constants.WASI_ESUCCESS;
      }
      case ioctlRequests.WGETRB:
        this.currentBuffer = bufferType.BODY;
        return constants.WASI_ESUCCESS;
      case ioctlRequests.WGETRH:
        this.currentBuffer = bufferType.HEADERS;
        return constants.WASI_ESUCCESS;
      default:
        return constants.WASI_EINVAL;
    }
  }
}
