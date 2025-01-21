
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

describe("Test Websocket Device Driver", () => {
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
    jest.restoreAllMocks()
  });

  test("Websocket device driver returns WebsocketDevice at minor 0 request", async () => {
    const minor = 0;

    const { desc, err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);
    expect(err).toBe(constants.WASI_ESUCCESS);
    expect(desc).toBeInstanceOf(WebsocketDevice);
  });

  test("Websocket device driver doesn't return unexisting connection device", async () => {
    const minor = 1;

    const { err } = await websocketDeviceDriver.getDesc(minor, 0, 0n, 0n, vfs.CharacterDev);
    expect(err).toBe(constants.WASI_ENOENT);
  });

  test("Websocket device driver properly manages conenction devices", async () => {
    const connectionObjects: Record<number, WebSocketConnection> = {};

    for (var idx = 1; idx <= 3; idx++) {
      const websocket = new WebSocket("ws://some.link");

      Object.defineProperty(websocket, "readyState", {
        get() {
          return websocket.OPEN;
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
