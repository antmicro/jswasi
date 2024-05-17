import * as constants from "../../constants.js";
//@ts-ignore
import * as vfs from "../../../third_party/vfs.js";
import { Descriptor, Fdflags, Rights } from "../filesystem.js";
import { AbstractVirtualDeviceDescriptor, DeviceFilesystem } from "./device-filesystem.js";
import { DeviceDriver } from "./driver-manager.js";
import { VirtualFilesystemDescriptor } from "./virtual-filesystem.js";

export class WebsocketDeviceDriver implements DeviceDriver {
  private sockets: Record<number, WebSocket>
  private topSocketId: number;
  private devfs: DeviceFilesystem;

  initDriver(_args: Object): Promise<number> {
    this.topSocketId = 1;
    this.sockets = {};
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  teardownDriver(_args: Object): Promise<number> {
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  initDevice(min: number, args: {devfs: DeviceFilesystem}): Promise<number> {
    if (min === 0)
      this.devfs = args.devfs;

    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  teardownDevice(_min: number, _args: Object): Promise<number> {
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  async openSocket(url: string): Promise<{ err: number; minor: number}> {
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch (SyntaxError) {
      return {
        err: constants.WASI_EINVAL,
        minor: -1
      };
    }

    const errPromise = new Promise<number>(resolve => {
      sock.addEventListener("error", event => {
        resolve(constants.WASI_ECONNABORTED);
      });
    });

    const okPromise = new Promise<number>(resolve => {
      sock.addEventListener("open", event => {
        resolve(constants.WASI_ESUCCESS);
      });
    });

    const __stat = await Promise.race([errPromise, okPromise]);
    if (__stat !== constants.WASI_ESUCCESS)
      return { err: __stat, minor: -1 };

    const sockId = this.topSocketId++;
    this.sockets[sockId] = sock;

    return {
      err: constants.WASI_ESUCCESS,
      minor: sockId
    };
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
        desc: new WebsocketDevice(
          fs_flags,
          fs_rights_base,
          fs_rights_inheriting,
          ino,
          this
        ),
      };
    }

    if (this.sockets[min] === undefined)
      return { desc: undefined, err: constants.WASI_ENOENT };

    return {
      err: constants.WASI_ESUCCESS,
      desc: new WebsocketConnectionDevice (
        fs_flags,
        fs_rights_base,
        fs_rights_inheriting,
        ino,
        this.responses[min],
        () => this.invalidateSocket(min)
      ),
    }
  }

  async invalidateSocket(id: number): Promise<number> {
    delete this.sockets[id];
    return this.devfs.unlinkat(undefined, `ws0s${id}`, false);
  }
}

class WgetDevice
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor
{
  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev,
    private driver: WebsocketDeviceDriver
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
  }
  isatty(): boolean { return false; }

  override async write(buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    const __url = new TextDecoder().decode(buffer);
    const { err, minor } = await this.driver.openSocket(__url);

    return {
      err,
      written: BigInt(minor),
    };
  }
}

class WebsocketConnectionDevice
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor
{
  isatty(): boolean {
    return false;
  }
}
