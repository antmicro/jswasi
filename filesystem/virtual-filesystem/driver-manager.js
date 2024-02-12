import * as constants from "../../constants.js";
import { MemoryDeviceDriver } from "./mem-devices.js";
import { HtermDeviceDriver } from "./terminals/hterm-terminal.js";
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
        this.drivers[0 /* major.MAJ_MEMORY */] = __memDriver;
        this.drivers[1 /* major.MAJ_HTERM */] = __htermDriver;
        return constants.WASI_ESUCCESS;
    }
    getDriver(maj) {
        return this.drivers[maj];
    }
}
