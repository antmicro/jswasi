import * as constants from "../../../constants.js";
//@ts-ignore
import * as vfs from "../../../third_party/vfs.js";
import { PollSub, Descriptor, Fdflags, Rights } from "../../filesystem.js";
import { DeviceFilesystem } from "./device-filesystem.js";
import { AbstractVirtualDeviceDescriptor } from "./abstract-device-descriptor.js";
import { DeviceDriver, major } from "./driver-manager.js";
import { VirtualFilesystemDescriptor } from "../virtual-filesystem.js";
import { UserData, EventType, PollEvent } from "../../../types.js";


export class WebsocketDeviceDriver implements DeviceDriver {
  private socketUrls: Record<number, string>
  private topSocketId: number;
  private devfs: DeviceFilesystem;

  initDriver(args: {devfs: DeviceFilesystem}): Promise<number> {
    this.topSocketId = 1;
    this.socketUrls = {};
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

  async createSocket(url: string): Promise<{ err: number; minor: number}> {
    const sockId = this.topSocketId++;
    this.socketUrls[sockId] = url;
    await this.devfs.mknodat(
      undefined,
      `ws0s${sockId}`,
      vfs.mkDev(major.MAJ_WEBSOCKET, sockId),
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

    if (this.socketUrls[min] === undefined)
      return { desc: undefined, err: constants.WASI_ENOENT };

    const desc = new WebsocketConnectionDevice (
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      ino,
      () => this.invalidateSocket(min)
    );

    const err = await desc.connect(this.socketUrls[min]);
    return {
      err: err,
      desc: err === constants.WASI_ESUCCESS ? desc : undefined,
    };
  }

  async invalidateSocket(id: number): Promise<number> {
    delete this.socketUrls[id];
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
    const { err, minor } = await this.driver.createSocket(__url);

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
  private socket: WebSocket;
  private pollQueue: PollSub[];

  isatty(): boolean {
    return false;
  }

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev,
    private invalidate: () => Promise<number>
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
    this.msgBuffer = [];
    this.requestQueue = [];
    this.pollQueue = [];
  }

  public connect(url: string): Promise<number> {
    try {
      this.socket = new WebSocket(url);
    } catch (SyntaxError) {
      return Promise.resolve(constants.WASI_EINVAL);
    }


    const errPromise = new Promise<number>(resolve => {
      this.socket.onerror = _ => {
        resolve(constants.WASI_ECONNABORTED);

        for (let req = this.pollQueue.shift(); req !== undefined; req = this.pollQueue.shift()) {
          req.resolve({
            userdata: req.userdata,
            error: constants.WASI_ENOTCONN,
            nbytes: 0n,
            eventType: constants.WASI_EXT_NO_EVENT,
          });
        }
      };
    });

    const okPromise = new Promise<number>(resolve => {
      this.socket.addEventListener("open", _ => {
        resolve(constants.WASI_ESUCCESS);
      });
    });
    this.socket.binaryType = "arraybuffer";
    this.socket.onmessage = ev => this.onSocketMessage(ev);
    this.socket.onclose = _ => {
      for (let req = this.pollQueue.shift(); req !== undefined; req = this.pollQueue.shift()) {
        req.resolve({
          userdata: req.userdata,
          error: constants.WASI_ENOTCONN,
          nbytes: 0n,
          eventType: constants.WASI_EXT_NO_EVENT,
        });
      }
    };

    return Promise.race([errPromise, okPromise]);
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
    } else {
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
      } else {
        req.resolve({
          err: constants.WASI_ESUCCESS,
          buffer: eventData,
        });
      }
    }

    for (let req = this.pollQueue.shift(); req !== undefined; req = this.pollQueue.shift()) {
      req.resolve({
        userdata: req.userdata,
        error: constants.WASI_ESUCCESS,
        nbytes: BigInt(eventData.byteLength),
        eventType: constants.WASI_EVENTTYPE_FD_READ,
      });
    }
  }

  override write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }> {
    if (this.socket.readyState !== 1) {
      // The socket is not in the CONNECTED state
      return Promise.resolve({
        err: constants.WASI_ENOTCONN,
        written: 0n
      });
    }

    this.socket.send(buffer);
    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      written: BigInt(buffer.byteLength),
    });
  }

  override read(len: number, _workerId?: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    let mesg = this.msgBuffer.shift();
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

    if (this.socket.readyState > 1) // The socket is either closed or closing
      return Promise.resolve({ err: constants.WASI_ESUCCESS, buffer: new ArrayBuffer(0) });

    return new Promise(resolve => {
      this.requestQueue.push({
        len,
        resolve,
      });
    });
  }

  override addPollSub(
    userdata: UserData,
    eventType: EventType,
    workerId: number
  ): Promise<PollEvent> {
    switch (eventType) {
      case constants.WASI_EVENTTYPE_FD_WRITE: {
        return Promise.resolve({
          userdata,
          error: constants.WASI_ESUCCESS,
          eventType,
          nbytes: 0n,
        });
      }
      case constants.WASI_EVENTTYPE_FD_READ: {
        if (this.msgBuffer.length === 0) {
          return new Promise((resolve: (event: PollEvent) => void) => {
            this.pollQueue.push({
              pid: workerId,
              userdata,
              tag: eventType,
              resolve,
            });
          });
        }
        return Promise.resolve({
          userdata,
          error: constants.WASI_ESUCCESS,
          eventType,
          nbytes: BigInt(this.msgBuffer[0].buf.byteLength)
        });
      }
      default: {
        return Promise.resolve({
          userdata,
          error: constants.WASI_EINVAL,
          eventType: constants.WASI_EXT_NO_EVENT,
          nbytes: 0n
        });
      }
    }
  }

  override close(): Promise<number> {
    this.socket.close();
    return this.invalidate();
  }
}
