import * as constants from "../../constants.js";
// @ts-ignore
import * as vfs from "../../third_party/vfs.js";
import { AbstractVirtualDeviceDescriptor } from "./device-filesystem.js";
export class WgetDeviceDriver {
    responses;
    topResponseId;
    devfs;
    initDriver(_args) {
        this.topResponseId = 1;
        this.responses = {};
        return Promise.resolve(constants.WASI_ESUCCESS);
    }
    teardownDriver(_args) {
        return Promise.resolve(constants.WASI_ESUCCESS);
    }
    initDevice(min, args) {
        if (min === 0) {
            this.devfs = args.devfs;
        }
        return Promise.resolve(constants.WASI_ESUCCESS);
    }
    teardownDevice(_min, _args) {
        return Promise.resolve(constants.WASI_ESUCCESS);
    }
    async makeRequest(url) {
        try {
            this.responses[this.topResponseId] = await fetch(url);
            this.devfs.mknodat(undefined, `wget0r${this.topResponseId}`, vfs.mkDev(2 /* major.MAJ_WGET */, this.topResponseId), {});
            return {
                err: constants.WASI_ESUCCESS,
                minor: this.topResponseId++
            };
        }
        catch (e) {
            console.log(e);
            // TODO: Add proper return codes
            return {
                err: constants.WASI_EINVAL,
                minor: -1
            };
        }
    }
    async getDesc(min, fs_flags, fs_rights_base, fs_rights_inheriting, ino) {
        if (min === 0) {
            return {
                err: constants.WASI_ESUCCESS,
                desc: new WgetDevice(fs_flags, fs_rights_base, fs_rights_inheriting, ino, this),
            };
        }
        else {
            if (this.responses[min] === undefined)
                return { desc: undefined, err: constants.WASI_ENOENT };
            return {
                err: constants.WASI_ESUCCESS,
                desc: new WgetDataDevice(fs_flags, fs_rights_base, fs_rights_inheriting, ino, this.responses[min], () => this.invalidateResponse(min))
            };
        }
    }
    async invalidateResponse(id) {
        delete this.responses[id];
        return this.devfs.unlinkat(undefined, `wget0r${id}`, false);
    }
}
class WgetDevice extends AbstractVirtualDeviceDescriptor {
    driver;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, ino, driver) {
        super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
        this.driver = driver;
    }
    isatty() { return false; }
    async write(buffer) {
        const __url = new TextDecoder().decode(buffer);
        const { err, minor } = await this.driver.makeRequest(__url);
        return {
            err,
            written: BigInt(minor),
        };
    }
}
class WgetDataDevice extends AbstractVirtualDeviceDescriptor {
    response;
    invalidate;
    currentBuffer;
    body;
    headers;
    hCursor;
    bCursor;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, ino, response, invalidate) {
        super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
        this.response = response;
        this.invalidate = invalidate;
        this.currentBuffer = 1 /* bufferType.BODY */;
        this.hCursor = 0;
        this.bCursor = 0;
        let __headers = [];
        for (const [key, val] of this.response.headers.entries()) {
            __headers.push(`${key}: ${val}`);
        }
        this.headers = new TextEncoder().encode(__headers.join('\n'));
    }
    isatty() { return false; }
    async read(len, _workerId) {
        let buffer;
        if (this.currentBuffer === 1 /* bufferType.BODY */) {
            // TODO: This should use readable stream so that the entire body does
            // not have to be saved in memory before it can be read
            if (this.body === undefined)
                this.body = await this.response.arrayBuffer();
            buffer = this.body.slice(this.bCursor, this.bCursor + len);
            this.bCursor += buffer.byteLength;
        }
        else {
            buffer = this.headers.slice(this.hCursor, this.hCursor + len);
            this.hCursor += buffer.byteLength;
        }
        return {
            err: constants.WASI_ESUCCESS,
            buffer
        };
    }
    close() {
        return this.invalidate();
    }
    async ioctl(request, buf) {
        switch (request) {
            case 0 /* ioctlRequests.WGETGS */: {
                if (buf === undefined || buf.byteLength < 4)
                    return constants.WASI_ENOBUFS;
                const __buf = new Int32Array(buf.buffer, buf.byteOffset);
                __buf[0] = this.response.status;
                return constants.WASI_ESUCCESS;
            }
            case 2 /* ioctlRequests.WGETRB */:
                this.currentBuffer = 1 /* bufferType.BODY */;
                return constants.WASI_ESUCCESS;
            case 1 /* ioctlRequests.WGETRH */:
                this.currentBuffer = 0 /* bufferType.HEADERS */;
                return constants.WASI_ESUCCESS;
            default:
                return constants.WASI_EINVAL;
        }
    }
}
