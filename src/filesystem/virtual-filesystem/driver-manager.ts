import * as constants from "../../constants.js";

import { MemoryDeviceDriver } from "./mem-devices.js";
import { Descriptor, Fdflags, Rights } from "../filesystem.js";

// @ts-ignore
import * as vfs from "../../vendor/vfs.js";

export const enum major {
  MAJ_MEMORY = 0,
}

export class DriverManager {
  private drivers: { [key in major]?: DeviceDriver };

  constructor() {
    this.drivers = {};
  }

  async initialize(_opts: Object): Promise<number> {
    const __memDriver = new MemoryDeviceDriver();

    let err = await __memDriver.initDriver();
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    this.drivers[major.MAJ_MEMORY] = __memDriver;
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
