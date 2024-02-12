import * as constants from "./constants.js";
import { AbstractDeviceDescriptor, } from "./filesystem/filesystem.js";
// EventSource implements write end fifo features
export class EventSource
// In unix, crossterm uses pipe as event source
// Wasi doesn't define filetype pipe/fifo so it's defined as char device
 extends AbstractDeviceDescriptor {
    eventMask;
    signalSub;
    events;
    stopResolver;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, eventMask) {
        super(fs_flags, fs_rights_base, fs_rights_inheriting);
        this.eventMask = eventMask;
        this.events = constants.WASI_EXT_NO_EVENT;
        this.stopResolver = undefined;
        this.signalSub = undefined;
    }
    getFilestat() {
        // TODO: Mostly dummy values
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            filestat: {
                dev: 0n,
                ino: 0n,
                filetype: this.fdstat.fs_filetype,
                nlink: 0n,
                size: 0n,
                mtim: 0n,
                atim: 0n,
                ctim: 0n,
            },
        });
    }
    async setFilestatTimes(_atim, _mtim) {
        // TODO: set atim and mtim
        return constants.WASI_ESUCCESS;
    }
    // TODO: implement close
    async close() {
        if (this.stopResolver)
            this.stopResolver.resolve(this);
        return constants.WASI_ESUCCESS;
    }
    async read(len, _workerId) {
        if (len < 4)
            return { err: constants.WASI_ENOBUFS, buffer: undefined };
        const buffer = new ArrayBuffer(4);
        const arr32 = new Uint32Array(buffer);
        arr32[0] = this.events;
        this.events = constants.WASI_EXT_NO_EVENT;
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            buffer,
        });
    }
    isatty() {
        return false;
    }
    addPollSub(userdata, eventType, workerId) {
        return new Promise((resolve) => {
            if (this.events !== constants.WASI_EXT_NO_EVENT) {
                resolve({
                    userdata,
                    eventType: this.events,
                    nbytes: 4n,
                    error: constants.WASI_ESUCCESS,
                });
            }
            else {
                this.signalSub = {
                    pid: workerId,
                    userdata,
                    tag: eventType,
                    resolve,
                };
            }
        });
    }
    sendEvents(events) {
        this.events |= events & this.eventMask;
        if (this.events !== constants.WASI_EXT_NO_EVENT &&
            this.signalSub !== undefined) {
            this.signalSub.resolve({
                userdata: this.signalSub.userdata,
                error: constants.WASI_ESUCCESS,
                eventType: constants.WASI_EVENTTYPE_FD_READ,
                nbytes: 4n,
            });
            this.signalSub = undefined;
        }
    }
    obtainEvents(events) {
        const __events = this.events & events;
        this.events ^= __events;
        return __events;
    }
    makeNotifier(stopResolver) {
        if (this.eventMask & constants.WASI_EXT_EVENT_SIGINT) {
            if (this.stopResolver !== undefined)
                this.stopResolver.resolve(this);
            this.stopResolver = stopResolver;
            return constants.WASI_ESUCCESS;
        }
        stopResolver.reject();
        return constants.WASI_EINVAL;
    }
}
