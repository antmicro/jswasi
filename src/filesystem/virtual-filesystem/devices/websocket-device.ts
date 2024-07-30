import * as constants from "../../../constants.js";
//@ts-ignore
import * as vfs from "../../../third_party/vfs.js";
import { PollSub, Descriptor, Fdflags, Rights } from "../../filesystem.js";
import { DeviceFilesystem } from "./device-filesystem.js";
import { AbstractVirtualDeviceDescriptor } from "./abstract-device-descriptor.js";
import { DeviceDriver, major } from "./driver-manager.js";
import { VirtualFilesystemDescriptor } from "../virtual-filesystem.js";
import { UserData, EventType, PollEvent } from "../../../types.js";


type WebsocketMessage = {
  start: number;
  buf: ArrayBuffer;
};

type WebsocketRequest = {
  len: number;
  resolve: (ret: { err: number; buffer: ArrayBuffer }) => void;
};

type WebSocketConnection = {
  socket: WebSocket,
  msgBuffer: WebsocketMessage[],
  requestQueue: WebsocketRequest[],
  pollQueue: PollSub[],
  fdCount: number,
}

function onSocketMessage(connection: WebSocketConnection, event: MessageEvent): void {
  let eventData: ArrayBuffer, __evData = event.data;
  if (!(__evData instanceof ArrayBuffer))
    eventData = new TextEncoder().encode(__evData);
  else
    eventData = __evData;

  if (connection.requestQueue.length === 0) {
    connection.msgBuffer.push({
      start: 0,
      buf: eventData
    });
  } else {
    const req = connection.requestQueue.shift();

    if (req.len < eventData.byteLength) {
      const returnBuffer = eventData.slice(0, req.len);
      connection.msgBuffer.push({
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

  for (let req = connection.pollQueue.shift(); req !== undefined; req = connection.pollQueue.shift()) {
    req.resolve({
      userdata: req.userdata,
      error: constants.WASI_ESUCCESS,
      nbytes: BigInt(eventData.byteLength),
      eventType: constants.WASI_EVENTTYPE_FD_READ,
    });
  }
}

export class WebsocketDeviceDriver implements DeviceDriver {
  private websocketsDevices: Record<number, WebSocketConnection>;
  private topSocketId: number;
  private devfs: DeviceFilesystem;

  initDriver(args: { devfs: DeviceFilesystem }): Promise<number> {
    this.websocketsDevices = {};
    this.topSocketId = 1;
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

  async createConnectionDevice(connection: WebSocketConnection): Promise<{ err: number; minor: number }> {
    const sockId = this.topSocketId;
    let err = await this.devfs.mknodat(
      undefined,
      `ws0s${sockId}`,
      vfs.mkDev(major.MAJ_WEBSOCKET, sockId),
    );

    if (err !== constants.WASI_ESUCCESS) {
      return {
        err,
        minor: undefined,
      };
    }

    this.topSocketId++;
    this.websocketsDevices[sockId] = connection;

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

    if (this.websocketsDevices[min] === undefined)
      return { desc: undefined, err: constants.WASI_ENOENT };

    const conn = this.websocketsDevices[min];

    if (conn.socket.readyState !== WebSocket.OPEN) {
      return {
        err: constants.WASI_ENOTCONN,
        desc: undefined,
      }
    }

    const desc = new WebsocketConnectionDevice(
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      ino,
      conn,
      () => this.invalidateConnectionDevice(min)
    );

    conn.fdCount++;

    return {
      err: constants.WASI_ESUCCESS,
      desc,
    };
  }

  async invalidateConnectionDevice(id: number): Promise<number> {
    delete this.websocketsDevices[id];
    return this.devfs.unlinkat(undefined, `ws0s${id}`, false);
  }
}

class WebsocketDevice
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor {
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

    let socket: WebSocket;
    try {
      socket = new WebSocket(__url);
    } catch (SyntaxError) {
      return Promise.resolve({
        err: constants.WASI_EINVAL,
        written: undefined,
      });
    }

    let connection: WebSocketConnection = {
      socket,
      msgBuffer: [],
      requestQueue: [],
      pollQueue: [],
      fdCount: 0,
    };

    const errPromise = new Promise<number>(resolve => {
      socket.onerror = _ => {
        resolve(constants.WASI_ECONNABORTED);

        for (let req = connection.pollQueue.shift(); req !== undefined; req = connection.pollQueue.shift()) {
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
      socket.onopen = _ => {
        resolve(constants.WASI_ESUCCESS);
      };
    });

    socket.binaryType = "arraybuffer";
    socket.onmessage = ev => onSocketMessage(connection, ev);
    socket.onclose = _ => {
      for (let req = connection.requestQueue.shift(); req !== undefined; req = connection.requestQueue.shift()) {
        req.resolve({
          err: constants.WASI_ESUCCESS,
          buffer: new ArrayBuffer(0),
        })
      }

      for (let req = connection.pollQueue.shift(); req !== undefined; req = connection.pollQueue.shift()) {
        req.resolve({
          userdata: req.userdata,
          error: constants.WASI_ENOTCONN,
          nbytes: 0n,
          eventType: constants.WASI_EXT_NO_EVENT,
        });
      }
    }

    let err = await Promise.race([errPromise, okPromise]);
    if (err !== constants.WASI_ESUCCESS) {
      return {
        err,
        written: undefined,
      }
    }

    let res = await this.driver.createConnectionDevice(connection);
    if (res.err !== constants.WASI_ESUCCESS) {
      return {
        err: res.err,
        written: undefined,
      }
    }

    return {
      err: res.err,
      written: BigInt(res.minor),
    };
  }
}

class WebsocketConnectionDevice
  extends AbstractVirtualDeviceDescriptor
  implements VirtualFilesystemDescriptor {
  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev,
    private connection: WebSocketConnection,
    private invalidate: () => Promise<number>,
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
  }

  isatty(): boolean {
    return false;
  }

  override write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }> {
    if (this.connection.socket.readyState !== WebSocket.OPEN) {
      // The socket is not in the CONNECTED state
      return Promise.resolve({
        err: constants.WASI_ENOTCONN,
        written: 0n
      });
    }

    this.connection.socket.send(buffer);
    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      written: BigInt(buffer.byteLength),
    });
  }

  override read(len: number, _workerId?: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    let mesg = this.connection.msgBuffer[0];
    if (mesg !== undefined) {
      const mesgLen = mesg.buf.byteLength - mesg.start;

      let returnBuffer;
      if (mesgLen > len) {
        // The requested length is shorter than the last message in the
        // buffer, slice the buffered message and shift the start index
        returnBuffer = mesg.buf.slice(mesg.start, mesg.start + len);
        mesg.start += len;
      } else {
        // Otherwise message buffer can be dropped
        returnBuffer = mesg.buf.slice(mesg.start);
        this.connection.msgBuffer.shift();
      }

      return Promise.resolve({
        err: constants.WASI_ESUCCESS,
        buffer: returnBuffer
      });
    }

    if (this.connection.socket.readyState > WebSocket.OPEN) // The socket is either closed or closing
      return Promise.resolve({ err: constants.WASI_ESUCCESS, buffer: new ArrayBuffer(0) });

    return new Promise(resolve => {
      this.connection.requestQueue.push({
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
      // WebSocket.OPEN = 1,  WebSocket.CLOSING = 2, WebSocket.CLOSED = 3
      // so we can compare readyState, WebSocket.CONNECTING cannot be here
      case constants.WASI_EVENTTYPE_FD_WRITE: {
        if (this.connection.socket.readyState > WebSocket.OPEN) {
          // TODO: set POLLHUP
          return Promise.resolve({
            userdata,
            error: constants.WASI_ESUCCESS,
            eventType,
            nbytes: 0n,
          });
        }

        return Promise.resolve({
          userdata,
          error: constants.WASI_ESUCCESS,
          eventType,
          nbytes: BigInt(Number.MAX_SAFE_INTEGER),
        });
      }
      case constants.WASI_EVENTTYPE_FD_READ: {
        if (this.connection.msgBuffer.length === 0) {
          if (this.connection.socket.readyState > WebSocket.OPEN) {
            // TODO: set POLLHUP
            return Promise.resolve({
              userdata,
              error: constants.WASI_ESUCCESS,
              eventType,
              nbytes: 0n,
            });
          }

          return new Promise((resolve: (event: PollEvent) => void) => {
            this.connection.pollQueue.push({
              pid: workerId,
              userdata,
              tag: eventType,
              resolve,
            });
          });
        }
        let mesg = this.connection.msgBuffer[0];
        let toRead = mesg.buf.byteLength - mesg.start;
        return Promise.resolve({
          userdata,
          error: constants.WASI_ESUCCESS,
          eventType,
          nbytes: BigInt(toRead)
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
    this.connection.fdCount--;
    if (this.connection.fdCount > 0) {
      return Promise.resolve(constants.WASI_ESUCCESS);
    }

    if (this.connection.socket.readyState === WebSocket.OPEN) {
      this.connection.socket.close(1000);
    }

    return this.invalidate();
  }

  override duplicateFd(): void {
    this.connection.fdCount++;
  }
}
