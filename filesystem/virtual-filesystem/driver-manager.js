import * as constants from "../../constants.js";
import { MemoryDeviceDriver } from "./mem-devices.js";
import { HtermDeviceDriver } from "./terminals/hterm-terminal.js";
import { WgetDeviceDriver } from "./wget-device.js";
export class DriverManager {
    drivers;
    constructor() {
        this.drivers = {};
    }
    async initialize(processManager) {
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
        this.drivers[0 /* major.MAJ_MEMORY */] = __memDriver;
        this.drivers[1 /* major.MAJ_HTERM */] = __htermDriver;
        this.drivers[2 /* major.MAJ_WGET */] = __wgetDriver;
        return constants.WASI_ESUCCESS;
    }
    getDriver(maj) {
        return this.drivers[maj];
    }
}
