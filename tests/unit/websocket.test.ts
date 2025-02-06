
import * as constants from "../../src/constants";
import { DeviceFilesystem } from "../../src/filesystem/virtual-filesystem/devices/device-filesystem";
import { WebsocketConnection, WebsocketConnectionDevice, WebsocketDevice, WebsocketDeviceDriver } from "../../src/filesystem/virtual-filesystem/devices/websocket-device.js";
import { major } from "../../src/filesystem/virtual-filesystem/devices/driver-manager.js";

// @ts-ignore
import * as vfs from "../../third_party/vfs.js";

// This import fails if there is no jest cache available. It could be caused by
// some misconfiguration or a bug in jest. ts-ignore works as an ad-hoc solution
// @ts-ignore
import { jest, test, expect, describe, beforeAll, beforeEach, afterEach } from "@jest/globals";

// @ts-ignore
import { WebSocket } from "ws";

// @ts-ignore
Object.assign(global, { WebSocket: require('ws') });

jest.mock("../../src/filesystem/virtual-filesystem/devices/device-filesystem");
jest.mock("ws");

function setWebsocketState(ws: WebSocket, state: number) {
  Object.defineProperty(ws, "readyState", {
    configurable: true,
    get() {
      return state;
    }
  });
}

describe("Test WebsocketDeviceDriver", () => {
  let devfs: DeviceFilesystem;
  let websocketDeviceDriver: WebsocketDeviceDriver;

  beforeAll(() => {
    devfs = new DeviceFilesystem();
    websocketDeviceDriver = new WebsocketDeviceDriver();

    jest.spyOn(devfs, "mknodat").mockReturnValue(new Promise((resolve) => {
      resolve(constants.WASI_ESUCCESS);
    }));

    jest.spyOn(devfs, "unlinkat").mockReturnValue(new Promise((resolve) => {
      resolve(constants.WASI_ESUCCESS);
    }));

  });

  beforeEach(async () => {
    await websocketDeviceDriver.initDriver({ devfs });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test("WebsocketDeviceDriver returns WebsocketDevice at minor 0 request", async () => {
    const minor = 0;

    const { desc, err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);
    expect(err).toBe(constants.WASI_ESUCCESS);
    expect(desc).toBeInstanceOf(WebsocketDevice);
  });

  test("WebsocketDeviceDriver doesn't return nonexistent connection device", async () => {
    const minor = 1;

    const { err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);
    expect(err).toBe(constants.WASI_ENOENT);
  });

  test("WebsocketDeviceDriver properly manages connection devices", async () => {
    const connectionObjects: Record<number, WebsocketConnection> = {};

    for (var idx = 1; idx <= 3; idx++) {
      const websocket = new WebSocket("ws://some.link");
      setWebsocketState(websocket, WebSocket.OPEN);

      const connectionObject: WebsocketConnection = {
        socket: websocket,
        msgBuffer: [],
        requestQueue: [],
        pollQueue: [],
        fdCount: 0,
      }

      const { err, minor } = await websocketDeviceDriver.createConnectionDevice(connectionObject);

      expect(devfs.mknodat).toBeCalledWith(undefined, `ws0s${minor}`, vfs.mkDev(major.MAJ_WEBSOCKET, minor));

      expect(err).toBe(constants.WASI_ESUCCESS);
      expect(minor).toBe(idx);

      connectionObjects[minor] = connectionObject;
    }

    for (var minor = 1; minor <= 3; minor++) {
      const { desc, err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);

      expect(err).toBe(constants.WASI_ESUCCESS);
      expect(desc).toBeInstanceOf(WebsocketConnectionDevice);
      expect((<any>desc).connection).toBe(connectionObjects[minor]);
    }

    for (var minor = 1; minor <= 3; minor++) {
      const err = await websocketDeviceDriver.invalidateConnectionDevice(minor);

      expect(devfs.unlinkat).toBeCalledWith(undefined, `ws0s${minor}`, false);
      expect(err).toBe(constants.WASI_ESUCCESS);
    }

    for (var minor = 1; minor <= 3; minor++) {
      const { err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);

      expect(err).toBe(constants.WASI_ENOENT);
    }
  });

  test("WebsocketDeviceDriver increases fd counter of connection device", async () => {
    const websocket = new WebSocket("ws://some.link");
    setWebsocketState(websocket, WebSocket.OPEN);

    const connectionObject: WebsocketConnection = {
      socket: websocket,
      msgBuffer: [],
      requestQueue: [],
      pollQueue: [],
      fdCount: 0,
    }

    let oldFdCount = 0;
    const { err, minor } = await websocketDeviceDriver.createConnectionDevice(connectionObject);
    expect(err).toBe(constants.WASI_ESUCCESS);

    for (let i = 0; i < 10; i++) {
      const { err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);
      expect(err).toBe(constants.WASI_ESUCCESS);
      expect(connectionObject.fdCount).toBe(oldFdCount + 1);
      oldFdCount += 1;
    }
  });
});

describe("Test WebsocketDevice", () => {
  let devfs: DeviceFilesystem;
  let websocketDeviceDriver: WebsocketDeviceDriver;
  let websocketDevice: WebsocketDevice;

  beforeAll(() => {
    devfs = new DeviceFilesystem();
    websocketDeviceDriver = new WebsocketDeviceDriver();
  });

  beforeEach(async () => {
    await websocketDeviceDriver.initDriver({ devfs });
    websocketDevice = new WebsocketDevice(0, 0n, 0n, vfs.CharacterDev, websocketDeviceDriver);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test("WebsocketDevice is not terminal device", () => {
    let istty = websocketDevice.isatty();
    expect(istty).toBe(false);
  });

  test("WebsocketDevice should not create invalid connection devices", async () => {
    jest.spyOn(WebSocket, "WebSocket").mockImplementationOnce(() => {
      throw new Error("WebSocket open connection error");
    });

    let writeResult = await websocketDevice.write(new TextEncoder().encode("ws://some.link"));
    expect(WebSocket).toBeCalledWith("ws://some.link");
    expect(writeResult.err).toBe(constants.WASI_EINVAL);

    let websocketMock = new WebSocket("ws://sus-websocket.link");
    jest.spyOn(WebSocket, "WebSocket").mockImplementation(() => {
      return websocketMock;
    });

    WebSocket.mockClear();

    let writePromise = websocketDevice.write(new TextEncoder().encode("ws://some.link"));
    const errorCallbackTrigger = async () => {
      while (!websocketMock.onerror) {
        await new Promise((resolve) => { setTimeout(() => resolve(null), 1) });
      }
      websocketMock.onerror();
    };

    await Promise.all([writePromise, errorCallbackTrigger()]);
    expect(WebSocket).toBeCalledWith("ws://some.link");
    writeResult = await writePromise;
    expect(writeResult.err).toBe(constants.WASI_ECONNREFUSED);

    WebSocket.mockClear();

    jest.spyOn(websocketDeviceDriver, "createConnectionDevice")
      .mockReturnValue(new Promise((resolve) => resolve({
        err: constants.WASI_EINVAL,
        minor: undefined,
      })));

    writePromise = websocketDevice.write(new TextEncoder().encode("ws://some.link"));
    const openCallbackTrigger = async () => {
      while (!websocketMock.onopen) {
        await new Promise((resolve) => { setTimeout(() => resolve(null), 1) });
      }
      websocketMock.onopen();
    };

    await Promise.all([writePromise, openCallbackTrigger()]);
    expect(WebSocket).toBeCalledWith("ws://some.link");
    writeResult = await writePromise;
    expect(writeResult.err).toBe(constants.WASI_EINVAL);
  });

  test("WebsocketDevice opens websocket and returns correct minor device number", async () => {
    const minor = 666;
    const websocketMock = new WebSocket("ws://sus-websocket.link");
    WebSocket.mockClear();

    jest.spyOn(websocketDeviceDriver, "createConnectionDevice")
      .mockReturnValue(new Promise((resolve) => resolve({
        err: constants.WASI_ESUCCESS,
        minor,
      })));

    const writePromise = websocketDevice.write(new TextEncoder().encode("ws://good.link"));
    const openCallbackTrigger = async () => {
      while (!websocketMock.onopen) {
        await new Promise((resolve) => { setTimeout(() => resolve(null), 1) });
      }
      websocketMock.onopen();
    };

    await Promise.all([writePromise, openCallbackTrigger()]);
    expect(WebSocket).toBeCalledWith("ws://good.link");
    expect(await writePromise).toStrictEqual({ err: constants.WASI_ESUCCESS, written: BigInt(minor) });
  });
});

describe("Test WebsocketConnectionDevice", () => {
  let devfs: DeviceFilesystem;
  let websocketDeviceDriver: WebsocketDeviceDriver;
  let connectionObject: WebsocketConnection;
  let websocketDevice: WebsocketDevice;
  let websocketConnectionDevice: WebsocketConnectionDevice;
  let websocketMock: WebSocket;
  // let mockFnInvalidate;
  let minor: number;

  beforeAll(() => {
    devfs = new DeviceFilesystem();
    websocketDeviceDriver = new WebsocketDeviceDriver();

    jest.spyOn(devfs, "mknodat").mockReturnValue(new Promise((resolve) => {
      resolve(constants.WASI_ESUCCESS);
    }));

    jest.spyOn(devfs, "unlinkat").mockReturnValue(new Promise((resolve) => {
      resolve(constants.WASI_ESUCCESS);
    }));
  });

  beforeEach(async () => {
    await websocketDeviceDriver.initDriver({ devfs });
    websocketDevice = new WebsocketDevice(0, 0n, 0n, vfs.CharacterDev, websocketDeviceDriver);

    websocketMock = new WebSocket("ws://some.link");
    setWebsocketState(websocketMock, WebSocket.OPEN);
    jest.spyOn(WebSocket, "WebSocket").mockImplementationOnce(() => {
      return websocketMock;
    });

    let writePromise = websocketDevice.write(new TextEncoder().encode("ws://some.link"));
    const openCallbackTrigger = async () => {
      while (!websocketMock.onopen) {
        await new Promise((resolve) => { setTimeout(() => resolve(null), 1) });
      }
      websocketMock.onopen();
    };

    await Promise.all([writePromise, openCallbackTrigger()]);
    let writeResult = await writePromise;
    expect(writeResult.err).toBe(constants.WASI_ESUCCESS);

    minor = Number(writeResult.written);

    let { desc, err } = await websocketDeviceDriver.getDesc(
      minor,
      0,
      0n,
      0n,
      vfs.CharacterDev
    );

    expect(err).toBe(constants.WASI_ESUCCESS);
    expect(desc).toBeInstanceOf(WebsocketConnectionDevice);

    websocketConnectionDevice = desc as WebsocketConnectionDevice;
    connectionObject = (<any>websocketConnectionDevice).connection;

    WebSocket.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test("WebsocketConnectionDevice fd count is grater than zero", () => {
    expect((<any>websocketConnectionDevice).connection.fdCount).toBeGreaterThan(0);
  });

  test("WebsocketConnectionDevice is not terminal device", () => {
    let istty = websocketConnectionDevice.isatty();
    expect(istty).toBe(false);
  });

  test("WebsocketConnectionDevice writes only to open websockets", async () => {
    setWebsocketState(websocketMock, WebSocket.OPEN);

    let writeResult = await websocketConnectionDevice.write(new ArrayBuffer(42));
    expect(writeResult).toStrictEqual({ err: constants.WASI_ESUCCESS, written: 42n });

    for (var state of [WebSocket.CLOSING, WebSocket.CLOSED]) {
      setWebsocketState(websocketMock, state);
      writeResult = await websocketConnectionDevice.write(new ArrayBuffer(42 + state));
      expect(writeResult.err).toBe(constants.WASI_ENOTCONN);
    }
  });

  test("WebsocketConnectionDevice reads data from message buffer in first place", async () => {
    let decoder = new TextDecoder();

    let msgs = [
      "message 0",
      "message 1",
      "message 2",
      "message 3",
    ];

    msgs.forEach(msg => { websocketMock.onmessage({ data: msg }) });

    let size0 = msgs[0].length / 2;
    let size1 = msgs[0].length - size0;

    let read0 = await websocketConnectionDevice.read(size0);
    let data0 = decoder.decode(read0.buffer);
    expect(read0.err).toBe(constants.WASI_ESUCCESS);
    expect(data0).toBe(msgs[0].slice(0, size0));
    expect(connectionObject.msgBuffer.length).toBe(msgs.length);
    expect(connectionObject.requestQueue.length).toBe(0);

    let read1 = await websocketConnectionDevice.read(size1);
    let data1 = decoder.decode(read1.buffer);
    expect(read1.err).toBe(constants.WASI_ESUCCESS);
    expect(data1).toBe(msgs[0].slice(size0, size0 + size1));
    expect(connectionObject.msgBuffer.length).toBe(msgs.length - 1);
    expect(connectionObject.requestQueue.length).toBe(0);

    let read2 = await websocketConnectionDevice.read(msgs[1].length + 666);
    let data2 = decoder.decode(read2.buffer);
    expect(read2.err).toBe(constants.WASI_ESUCCESS);
    expect(data2).toBe(msgs[1]);
    expect(connectionObject.msgBuffer.length).toBe(msgs.length - 2);
    expect(connectionObject.requestQueue.length).toBe(0);

    while (connectionObject.msgBuffer.length > 0) {
      await websocketConnectionDevice.read(666);
    }

    expect(connectionObject.msgBuffer.length).toBe(0);
    expect(connectionObject.requestQueue.length).toBe(0);

    websocketConnectionDevice.read(42);
    expect(connectionObject.requestQueue.length).toBe(1);
  });

  test("WebsocketConnectionDevice receiving messages satisfies request queue", async () => {
    let decoder = new TextDecoder();

    let requests = [10, 20, 30, 100];

    let readPromises = requests.map((value, index) => {
      let promise = websocketConnectionDevice.read(value);
      expect(connectionObject.requestQueue.length).toBe(index + 1);
      return promise;
    });

    websocketMock.onmessage({ data: '#'.repeat(requests[0]) });

    expect(connectionObject.requestQueue.length).toBe(requests.length - 1);
    let read0 = await readPromises[0];
    expect(read0.err).toBe(constants.WASI_ESUCCESS);
    expect(decoder.decode(read0.buffer).length).toBe(requests[0]);

    websocketMock.onmessage({ data: '#'.repeat(requests[1] / 2) });

    expect(connectionObject.requestQueue.length).toBe(requests.length - 2);
    let read1 = await readPromises[1];
    expect(read1.err).toBe(constants.WASI_ESUCCESS);
    expect(decoder.decode(read1.buffer).length).toBe(requests[1] / 2);

    websocketMock.onmessage({ data: '#'.repeat(requests[2] * 3) });

    expect(connectionObject.requestQueue.length).toBe(requests.length - 4);
    let read2 = await readPromises[2];
    let read3 = await readPromises[3];

    expect(read2.err).toBe(constants.WASI_ESUCCESS);
    expect(read3.err).toBe(constants.WASI_ESUCCESS);

    expect(decoder.decode(read2.buffer).length).toBe(requests[2]);
    expect(decoder.decode(read3.buffer).length).toBeLessThan(requests[3]);
  });

  test("WebsocketConnectionDevice allows to read received messages when websocket is not open", async () => {

    let msgs = [
      "message 0",
      "message 1",
      "message 2",
      "message 3",
    ];

    msgs.forEach(msg => { websocketMock.onmessage({ data: msg }) });
    expect(connectionObject.msgBuffer.length).toBe(msgs.length);

    setWebsocketState(websocketMock, WebSocket.CLOSING);

    let read0 = await websocketConnectionDevice.read(msgs[0].length);
    expect(read0.err).toBe(constants.WASI_ESUCCESS);
    expect(read0.buffer.byteLength).toBe(msgs[0].length);
    expect(connectionObject.msgBuffer.length).toBe(msgs.length - 1);

    let read1 = await websocketConnectionDevice.read(msgs[1].length);
    expect(read1.err).toBe(constants.WASI_ESUCCESS);
    expect(read1.buffer.byteLength).toBe(msgs[1].length);
    expect(connectionObject.msgBuffer.length).toBe(msgs.length - 2);

    setWebsocketState(websocketMock, WebSocket.CLOSED);

    let read2 = await websocketConnectionDevice.read(msgs[2].length);
    expect(read2.err).toBe(constants.WASI_ESUCCESS);
    expect(read2.buffer.byteLength).toBe(msgs[2].length);
    expect(connectionObject.msgBuffer.length).toBe(msgs.length - 3);

    let read3 = await websocketConnectionDevice.read(msgs[3].length);
    expect(read3.err).toBe(constants.WASI_ESUCCESS);
    expect(read3.buffer.byteLength).toBe(msgs[3].length);
    expect(connectionObject.msgBuffer.length).toBe(msgs.length - 4);

    expect(connectionObject.msgBuffer).toStrictEqual([]);

    let noRead = await websocketConnectionDevice.read(42);
    expect(noRead.err).toBe(constants.WASI_ESUCCESS);
    expect(noRead.buffer.byteLength).toBe(0);
  });

  test("WebsocketConnectionDevice stores read poll subscribtions when there is no message to read and on message resolves them", async () => {

    let pollReads = [
      { userdata: 1n, eventType: constants.WASI_EVENTTYPE_FD_READ, workerId: 1 },
      { userdata: 2n, eventType: constants.WASI_EVENTTYPE_FD_READ, workerId: 2 },
      { userdata: 3n, eventType: constants.WASI_EVENTTYPE_FD_READ, workerId: 3 },
    ];

    let pollPromises = pollReads.map(({ userdata, eventType, workerId }) => {
      return websocketConnectionDevice.addPollSub(userdata, eventType, workerId);
    });

    expect(connectionObject.pollQueue.length).toBe(pollReads.length);

    let msg = "some data";
    websocketMock.onmessage({ data: msg });

    expect(connectionObject.pollQueue.length).toBe(0);
    expect(connectionObject.msgBuffer.length).toBe(1);

    for (let i = 0; i < pollReads.length; i++) {
      let result = await pollPromises[i];
      expect(result).toStrictEqual({
        userdata: pollReads[i].userdata,
        error: constants.WASI_ESUCCESS,
        eventType: constants.WASI_EVENTTYPE_FD_READ,
        nbytes: BigInt(msg.length)
      });
      expect(Number(result.nbytes)).toBe(connectionObject.msgBuffer[0].buf.byteLength);
    }
  });

  test("WebsocketConnectionDevice imediatly resolves read poll promises when there is a message to read", async () => {

    let msg = "some data to read";
    websocketMock.onmessage({ data: msg });

    let pollReads = [
      { userdata: 1n, eventType: constants.WASI_EVENTTYPE_FD_READ, workerId: 1 },
      { userdata: 2n, eventType: constants.WASI_EVENTTYPE_FD_READ, workerId: 2 },
      { userdata: 3n, eventType: constants.WASI_EVENTTYPE_FD_READ, workerId: 3 },
    ];

    for (let i = 0; i < pollReads.length; i++) {
      let { userdata, eventType, workerId } = pollReads[i];

      let result = await websocketConnectionDevice.addPollSub(userdata, eventType, workerId);
      expect(connectionObject.pollQueue.length).toBe(0);
      expect(connectionObject.msgBuffer.length).toBe(1);
      expect(result).toStrictEqual({
        userdata: pollReads[i].userdata,
        error: constants.WASI_ESUCCESS,
        eventType: constants.WASI_EVENTTYPE_FD_READ,
        nbytes: BigInt(msg.length)
      });
      expect(Number(result.nbytes)).toBe(connectionObject.msgBuffer[0].buf.byteLength);
    }
  });

  test("WebsocketConnectionDevice resolves read poll when websocket is not open but there are data to read", async () => {

    let msg = "some data to read";
    websocketMock.onmessage({ data: msg });

    [WebSocket.CLOSING, WebSocket.CLOSED].forEach(async (state) => {
      setWebsocketState(websocketMock, state);
      expect(connectionObject.msgBuffer.length).toBe(1);

      let { userdata, eventType, workerId } = {
        userdata: 1n,
        eventType: constants.WASI_EVENTTYPE_FD_READ,
        workerId: 1,
      };
      let result = await websocketConnectionDevice.addPollSub(userdata, eventType, workerId);
      expect(connectionObject.pollQueue.length).toBe(0);
      expect(connectionObject.msgBuffer.length).toBe(1);
      expect(result).toStrictEqual({
        userdata,
        error: constants.WASI_ESUCCESS,
        eventType: constants.WASI_EVENTTYPE_FD_READ,
        nbytes: BigInt(msg.length)
      });
    });
  });

  test("WebsocketConnectionDevice imediatly resolves read poll when websocket is not open and there are no data to read", async () => {

    [WebSocket.CLOSING, WebSocket.CLOSED].forEach(async (state) => {
      setWebsocketState(websocketMock, state);
      expect(connectionObject.msgBuffer.length).toBe(0);

      let { userdata, eventType, workerId } = {
        userdata: 1n,
        eventType: constants.WASI_EVENTTYPE_FD_READ,
        workerId: 1,
      };
      let result = await websocketConnectionDevice.addPollSub(userdata, eventType, workerId);
      expect(connectionObject.pollQueue.length).toBe(0);
      expect(result).toStrictEqual({
        userdata,
        error: constants.WASI_ESUCCESS,
        eventType: constants.WASI_EXT_NO_EVENT,
        nbytes: 0n
      });
    });
  });

  test("WebsocketConnectionDevice imediatly resolves write polls", async () => {

    let { userdata, eventType, workerId } = {
      userdata: 1n,
      eventType: constants.WASI_EVENTTYPE_FD_WRITE,
      workerId: -1,
    }
    let result = await websocketConnectionDevice.addPollSub(userdata, eventType, workerId);
    expect(connectionObject.pollQueue.length).toBe(0);
    expect(result).toStrictEqual({
      userdata,
      error: constants.WASI_ESUCCESS,
      eventType: constants.WASI_EVENTTYPE_FD_WRITE,
      nbytes: BigInt(Number.MAX_SAFE_INTEGER),
    });

    [WebSocket.CLOSING, WebSocket.CLOSED].forEach(async (state) => {
      setWebsocketState(websocketMock, state);

      let { userdata, eventType, workerId } = {
        userdata: 1n,
        eventType: constants.WASI_EVENTTYPE_FD_WRITE,
        workerId: 1,
      };
      let result = await websocketConnectionDevice.addPollSub(userdata, eventType, workerId);
      expect(connectionObject.pollQueue.length).toBe(0);
      expect(result).toStrictEqual({
        userdata,
        error: constants.WASI_ESUCCESS,
        eventType: constants.WASI_EXT_NO_EVENT,
        nbytes: 0n
      });
    });
  });

  test("WebsocketConnectionDevice handles polls with other event flags than read and write", async () => {
    expect(connectionObject.pollQueue.length).toBe(0);

    [
      constants.WASI_EVENTTYPE_CLOCK,
      (1 << 3),
      (1 << 4),
    ].forEach(async (event) => {
      let { userdata, eventType, workerId } = {
        userdata: 1n,
        eventType: event,
        workerId: 1,
      };
      let result = await websocketConnectionDevice.addPollSub(userdata, eventType, workerId);
      expect(connectionObject.pollQueue.length).toBe(0);
      expect(result).toStrictEqual({
        userdata,
        error: constants.WASI_EINVAL,
        eventType: constants.WASI_EXT_NO_EVENT,
        nbytes: 0n
      });
    });
  });

  test("WebsocketConnectionDevice increases fdCount on duplicateFd call", async () => {
    expect(connectionObject.fdCount).toBeGreaterThan(0);
    let oldFdCount = connectionObject.fdCount;

    for (let i = 0; i < 3; i++) {
      websocketConnectionDevice.duplicateFd();
      expect(connectionObject.fdCount).toBe(oldFdCount + 1);

      oldFdCount += 1;
    }
  });

  test("WebsocketConnectionDevice decreases fdCount after close", async () => {
    expect(connectionObject.fdCount).toBeGreaterThan(0);
    const oldFdCount = connectionObject.fdCount;

    let closeResult = await websocketConnectionDevice.close();
    expect(closeResult).toBe(constants.WASI_ESUCCESS);
    expect(connectionObject.fdCount).toBe(oldFdCount - 1);
  });

  test("WebsocketConnectionDevice closes websocket and invalidates connection device when fdCount reaches 0", async () => {
    let closeResult;

    connectionObject.fdCount += 10;

    let invaldiateMock = jest.spyOn(websocketDeviceDriver, "invalidateConnectionDevice");
    invaldiateMock.mockReturnValue(new Promise(resolve => resolve(constants.WASI_ESUCCESS)));

    while (connectionObject.fdCount > 1) {
      closeResult = await websocketConnectionDevice.close();

      expect(closeResult).toBe(constants.WASI_ESUCCESS);
      expect(websocketMock.close).not.toBeCalled();
      expect(invaldiateMock).not.toBeCalled();
    }

    expect(connectionObject.fdCount).toBe(1);

    closeResult = await websocketConnectionDevice.close();

    expect(closeResult).toBe(constants.WASI_ESUCCESS);
    expect(websocketMock.close).toBeCalledWith(1000);
    expect(invaldiateMock).toBeCalledWith(minor);
    expect(connectionObject.fdCount).toBe(0);
  });

  test("WebsocketConnectionDevice closes websocket only when it is open", async () => {
    let invaldiateMock = jest.spyOn(websocketDeviceDriver, "invalidateConnectionDevice");
    invaldiateMock.mockReturnValue(new Promise(resolve => resolve(constants.WASI_ESUCCESS)));

    setWebsocketState(websocketMock, WebSocket.OPEN);
    expect(connectionObject.fdCount).toBe(1);

    let closeResult = await websocketConnectionDevice.close();
    expect(closeResult).toBe(constants.WASI_ESUCCESS);
    expect(websocketMock.close).toBeCalledWith(1000);
    expect(invaldiateMock).toBeCalledWith(minor);

    [WebSocket.CLOSING, WebSocket.CLOSED].forEach(async (state) => {
      connectionObject.fdCount = 1;
      websocketMock.close.mockClear();

      setWebsocketState(websocketMock, state);
      expect(connectionObject.fdCount).toBe(1);

      let closeResult = await websocketConnectionDevice.close();
      expect(closeResult).toBe(constants.WASI_ESUCCESS);
      expect(websocketMock.close).not.toBeCalled();
      expect(invaldiateMock).toBeCalledWith(minor);
    });
  });

  test("WebsocketConnectionDevice invalidator propagates errno", async () => {
    let invaldiateMock = jest.spyOn(websocketDeviceDriver, "invalidateConnectionDevice");
    invaldiateMock.mockReturnValue(new Promise(resolve => resolve(constants.WASI_EINVAL)));

    expect(connectionObject.fdCount).toBe(1);

    let closeResult = await websocketConnectionDevice.close();
    expect(invaldiateMock).toBeCalled();
    expect(closeResult).toBe(constants.WASI_EINVAL);
  });

  test("WebsocketConnectionDevice resolves read and poll queues on websocket close", async () => {
    let readPromises = [10, 20, 30].map((readSize) => {
      return websocketConnectionDevice.read(readSize);
    });

    expect(connectionObject.msgBuffer.length).toBe(0);
    expect(connectionObject.requestQueue.length).toBe(readPromises.length);

    let pollIds = [1, 2, 3];
    let readPollPromises = pollIds.map((id) => {
      return websocketConnectionDevice.addPollSub(
        BigInt(id),
        constants.WASI_EVENTTYPE_FD_READ,
        id
      );
    });

    expect(connectionObject.pollQueue.length).toBe(readPollPromises.length);

    websocketMock.onclose();

    readPromises.forEach(async (promise) => {
      let readResult = await promise;
      expect(readResult.err).toBe(constants.WASI_ESUCCESS);
      expect(readResult.buffer.byteLength).toBe(0);
    });

    for (let i = 0; i < pollIds.length; i++) {
      let pollResult = await readPollPromises[i];

      expect(pollResult).toStrictEqual({
        userdata: BigInt(pollIds[i]),
        error: constants.WASI_ESUCCESS,
        nbytes: 0n,
        eventType: constants.WASI_EXT_NO_EVENT,
      });
    }
  });

  test("WebsocketConnectionDevice resolves read and poll queues on websocket error", async () => {
    let readPromises = [10, 20, 30].map((readSize) => {
      return websocketConnectionDevice.read(readSize);
    });

    expect(connectionObject.msgBuffer.length).toBe(0);
    expect(connectionObject.requestQueue.length).toBe(readPromises.length);

    let pollIds = [1, 2, 3];
    let readPollPromises = pollIds.map((id) => {
      return websocketConnectionDevice.addPollSub(
        BigInt(id),
        constants.WASI_EVENTTYPE_FD_READ,
        id
      );
    });

    expect(connectionObject.pollQueue.length).toBe(readPollPromises.length);

    websocketMock.onerror();

    readPromises.forEach(async (promise) => {
      let readResult = await promise;
      expect(readResult.err).toBe(constants.WASI_ECONNABORTED);
      expect(readResult.buffer.byteLength).toBe(0);
    });

    for (let i = 0; i < pollIds.length; i++) {
      let pollResult = await readPollPromises[i];

      expect(pollResult).toStrictEqual({
        userdata: BigInt(pollIds[i]),
        error: constants.WASI_ECONNABORTED,
        nbytes: 0n,
        eventType: constants.WASI_EXT_NO_EVENT,
      });
    }
  });

});
