import * as constants from "../../../constants.js";
//@ts-ignore
import * as vfs from "../../../third_party/vfs.js";
import { Descriptor, Fdflags, Rights } from "../../filesystem.js";
import { DeviceFilesystem } from "./device-filesystem.js";
import { AbstractVirtualDeviceDescriptor } from "./abstract-device-descriptor.js";
import { DeviceDriver, major } from "./driver-manager.js";
import { VirtualFilesystemDescriptor } from "../virtual-filesystem.js";


export class WebsocketDeviceDriver implements DeviceDriver {
  private sockets: Record<number, WebSocket>
  private topSocketId: number;
  private devfs: DeviceFilesystem;

  initDriver(args: {devfs: DeviceFilesystem}): Promise<number> {
    this.topSocketId = 1;
    this.sockets = {};
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
      sock.addEventListener("error", _ => {
        resolve(constants.WASI_ECONNABORTED);
      });
    });

    const okPromise = new Promise<number>(resolve => {
      sock.addEventListener("open", _ => {
        resolve(constants.WASI_ESUCCESS);
      });
    });

    const __stat = await Promise.race([errPromise, okPromise]);
    if (__stat !== constants.WASI_ESUCCESS)
      return { err: __stat, minor: -1 };

    const sockId = this.topSocketId++;
    this.sockets[sockId] = sock;
    this.devfs.mknodat(
      undefined,
      `ws0s${this.topSocketId}`,
      vfs.mkDev(major.MAJ_WEBSOCKET, this.topSocketId),
    );

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
        this.sockets[min],
        () => this.invalidateSocket(min)
      ),
    }
  }

  async invalidateSocket(id: number): Promise<number> {
    delete this.sockets[id];
    return this.devfs.unlinkat(undefined, `ws0s${id}`, false);
  }
}

class WebsocketDevice
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

type WebsocketMessage = {
  start: number;
  buf: ArrayBuffer;
};

type WebsocketRequest = {
  len: number;
  resolve: (ret: { err: number; buffer: ArrayBuffer }) => void;
};

class WebsocketConnectionDevice
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor
{
  private msgBuffer: WebsocketMessage[];
  private requestQueue: WebsocketRequest[];

  isatty(): boolean {
    return false;
  }

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev,
    private socket: WebSocket,
    private invalidate: () => Promise<number>
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
    this.msgBuffer = [];
    this.requestQueue = [];

    this.socket.binaryType = "arraybuffer";
    this.socket.onmessage = ev => this.onSocketMessage(ev);
  }

  private onSocketMessage(event: MessageEvent): void {
    let eventData: ArrayBuffer, __evData = event.data;
    if (!(__evData instanceof ArrayBuffer))
      eventData = new TextEncoder().encode(__evData);
    else
      eventData = __evData;

    if (this.requestQueue.length === 0) {
      this.msgBuffer.push({
        start: 0,
        buf: eventData
      });

      return;
    }

    const req = this.requestQueue.shift();

    if (req.len < eventData.byteLength) {
      const returnBuffer = eventData.slice(0, req.len);
      this.msgBuffer.push({
        start: req.len,
        buf: eventData,
      });

      req.resolve({
        err: constants.WASI_ESUCCESS,
        buffer: returnBuffer,
      });

      return;
    }

    req.resolve({
      err: constants.WASI_ESUCCESS,
      buffer: eventData,
    });
  }

  override read(len: number, _workerId?: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    let mesg = this.msgBuffer[0];

    if (mesg !== undefined) {
      const mesgLen = mesg.buf.byteLength - mesg.start;

      let returnBuffer = mesg.buf;
      if (mesgLen > len) {
        // The requested length is shorter than the last message in the
        // buffer, slice the buffered message and shift the start index
        returnBuffer = mesg.buf.slice(mesg.start, mesg.start + len);
        mesg.start += len;
      }

      return Promise.resolve({
        err: constants.WASI_ESUCCESS,
        buffer: returnBuffer
      });
    }

    return new Promise(resolve => {
      this.requestQueue.push({
        len,
        resolve,
      });
    });
  }

  override close(): Promise<number> {
    return this.invalidate();
  }
}
