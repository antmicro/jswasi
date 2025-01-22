
import * as constants from "../../src/constants";
import { DeviceFilesystem } from "../../src/filesystem/virtual-filesystem/devices/device-filesystem";
import { WebSocketConnection, WebsocketConnectionDevice, WebsocketDevice, WebsocketDeviceDriver } from "../../src/filesystem/virtual-filesystem/devices/websocket-device.js";
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
  })

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks()
  });

  test("WebsocketDeviceDriver returns WebsocketDevice at minor 0 request", async () => {
    const minor = 0;

    const { desc, err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);
    expect(err).toBe(constants.WASI_ESUCCESS);
    expect(desc).toBeInstanceOf(WebsocketDevice);
  });

  test("WebsocketDeviceDriver doesn't return unexisting connection device", async () => {
    const minor = 1;

    const { err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);
    expect(err).toBe(constants.WASI_ENOENT);
  });

  test("WebsocketDeviceDriver properly manages conenction devices", async () => {
    const connectionObjects: Record<number, WebSocketConnection> = {};

    for (var idx = 1; idx <= 3; idx++) {
      const websocket = new WebSocket("ws://some.link");

      Object.defineProperty(websocket, "readyState", {
        get() {
          return WebSocket.OPEN;
        }
      });

      const connectionObject: WebSocketConnection = {
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
});

describe("Test WebsocketDevice", () => {
  let devfs: DeviceFilesystem;
  let websocketDeviceDriver: WebsocketDeviceDriver;
  // @ts-ignore
  let websocketDevice: WebsocketDevice;

  beforeAll(() => {
    devfs = new DeviceFilesystem();
    websocketDeviceDriver = new WebsocketDeviceDriver();
  });

  beforeEach(async () => {
    await websocketDeviceDriver.initDriver({ devfs });
    websocketDevice = new WebsocketDevice(0, 0n, 0n, vfs.CharacterDev, websocketDeviceDriver);
  })

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test("WebsocketDevice is not terminal device", () => {
    let istty = websocketDevice.isatty();
    expect(istty).toBe(false);
  })

  test("WebsocketDevice should not create invalid connection devices", async () => {
    jest.spyOn(WebSocket, "WebSocket").mockImplementationOnce(() => {
      throw new Error("WebSocket open connection error");
    });

    let writeResult = await websocketDevice.write(new TextEncoder().encode("ws://some.link"));
    expect(WebSocket).toBeCalledWith("ws://some.link");
    expect(writeResult.err).toBe(constants.WASI_EINVAL)

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

    await Promise.all([writePromise, errorCallbackTrigger()])
    expect(WebSocket).toBeCalledWith("ws://some.link");
    writeResult = await writePromise;
    expect(writeResult.err).toBe(constants.WASI_ECONNREFUSED);

    WebSocket.mockClear();

    // const creationMock =
    jest.spyOn(websocketDeviceDriver, "createConnectionDevice")
      .mockReturnValue(new Promise((resolve) => resolve({
        err: constants.WASI_EINVAL,
        minor: undefined,
      })))

    writePromise = websocketDevice.write(new TextEncoder().encode("ws://some.link"));
    const openCallbackTrigger = async () => {
      while (!websocketMock.onopen) {
        await new Promise((resolve) => { setTimeout(() => resolve(null), 1) });
      }
      websocketMock.onopen();
    };

    await Promise.all([writePromise, openCallbackTrigger()])
    expect(WebSocket).toBeCalledWith("ws://some.link");
    writeResult = await writePromise;
    expect(writeResult.err).toBe(constants.WASI_EINVAL);

    // creationMock.mockRestore();
  })

  test("WebsocketDevice opens websocket and returns correct minor device number", async () => {
    const minor = 666;
    const websocketMock = new WebSocket("ws://sus-websocket.link");
    WebSocket.mockClear();

    jest.spyOn(websocketDeviceDriver, "createConnectionDevice")
      .mockReturnValue(new Promise((resolve) => resolve({
        err: constants.WASI_ESUCCESS,
        minor,
      })))

    const writePromise = websocketDevice.write(new TextEncoder().encode("ws://good.link"));
    const openCallbackTrigger = async () => {
      while (!websocketMock.onopen) {
        await new Promise((resolve) => { setTimeout(() => resolve(null), 1) });
      }
      websocketMock.onopen();
    };

    await Promise.all([writePromise, openCallbackTrigger()])
    expect(WebSocket).toBeCalledWith("ws://good.link");
    expect(await writePromise).toStrictEqual({ err: constants.WASI_ESUCCESS, written: BigInt(minor) });
  })
})