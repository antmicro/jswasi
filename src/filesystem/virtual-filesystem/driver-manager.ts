import * as constants from "../../constants.js";

import { MemoryDeviceDriver } from "./mem-devices.js";
import { HtermDeviceDriver } from "./terminals/hterm-terminal.js";
import { WgetDeviceDriver } from "./wget-device.js";
import { Descriptor, Fdflags, Rights } from "../filesystem.js";
import ProcessManager from "../../process-manager.js";

// @ts-ignore
import * as vfs from "../../third_party/vfs.js";

export const enum major {
  MAJ_MEMORY = 0,
  MAJ_HTERM = 1,
  MAJ_WGET = 2,
}

export class DriverManager {
  private drivers: { [key in major]?: DeviceDriver };

  constructor() {
    this.drivers = {};
  }

  async initialize(processManager: ProcessManager): Promise<number> {
    const __memDriver = new MemoryDeviceDriver();

    let err = await __memDriver.initDriver();
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    const __htermDriver = new HtermDeviceDriver();

    err = await __htermDriver.initDriver({ processManager });
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    const __wgetDriver = new WgetDeviceDriver();
    err = await __wgetDriver.initDriver({});
    if (err !== constants.WASI_ESUCCESS)
      return err;

    this.drivers[major.MAJ_MEMORY] = __memDriver;
    this.drivers[major.MAJ_HTERM] = __htermDriver;
    this.drivers[major.MAJ_WGET] = __wgetDriver;
    return constants.WASI_ESUCCESS;
  }

  public getDriver(maj: major): DeviceDriver {
    return this.drivers[maj];
  }
}

export interface DeviceDriver {
  initDriver(args: Object): Promise<number>;
  initDevice(min: number, args: Object): Promise<number>;
  teardownDevice(min: number, args: Object): Promise<number>;
  teardownDriver(args: Object): Promise<number>;

  getDesc(
    min: number,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev
  ): Promise<{ desc?: Descriptor; err: number }>;
}
