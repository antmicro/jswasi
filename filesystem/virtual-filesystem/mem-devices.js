import * as constants from "../../constants.js";
import { AbstractVirtualDeviceDescriptor } from "./device-filesystem.js";
export class MemoryDeviceDriver {
    devices;
    async initDriver() {
        this.devices = {
            [0 /* minor.DEV_NULL */]: VirtualNullDescriptor,
            [1 /* minor.DEV_ZERO */]: VirtualZeroDescriptor,
            [2 /* minor.DEV_URANDOM */]: VirtualUrandomDescriptor,
        };
        return constants.WASI_ESUCCESS;
    }
    async initDevice(_min) {
        return constants.WASI_ESUCCESS;
    }
    async teardownDevice(_min) {
        return constants.WASI_ESUCCESS;
    }
    async teardownDriver() {
        return constants.WASI_ESUCCESS;
    }
    async getDesc(min, fs_flags, fs_rights_base, fs_rights_inheriting, ino) {
        return {
            desc: new this.devices[min](fs_flags, fs_rights_base, fs_rights_inheriting, ino),
            err: constants.WASI_ESUCCESS,
        };
    }
}
class VirtualNullDescriptor extends AbstractVirtualDeviceDescriptor {
    isatty() {
        return false;
    }
    async read(_len, _workerId) {
        return {
            err: constants.WASI_ESUCCESS,
            buffer: new ArrayBuffer(0),
        };
    }
    async pread(_len, _pos) {
        return {
            err: constants.WASI_ESUCCESS,
            buffer: new ArrayBuffer(0),
        };
    }
    async arrayBuffer() {
        return {
            err: constants.WASI_ESUCCESS,
            buffer: new ArrayBuffer(0),
        };
    }
    async read_str() {
        return { err: constants.WASI_ESUCCESS, content: "" };
    }
    async write(buffer) {
        return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
    }
    async pwrite(buffer, _offset) {
        return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
    }
    async seek(_offset, _whence) {
        return { err: constants.WASI_ESUCCESS, offset: 0n };
    }
    // TODO: add dummy writableStream
    async truncate(_size) {
        return constants.WASI_ESUCCESS;
    }
}
class VirtualZeroDescriptor extends VirtualNullDescriptor {
    async read(len, _workerId) {
        let __buf = new ArrayBuffer(len);
        let __view8 = new Uint8Array(__buf);
        __view8.fill(0, 0, len);
        return {
            err: constants.WASI_ESUCCESS,
            buffer: __buf,
        };
    }
    async pread(len, _pos) {
        return this.read(len);
    }
}
class VirtualUrandomDescriptor extends VirtualNullDescriptor {
    async read(len, _workerId) {
        let __buf = new ArrayBuffer(len);
        let __view8 = new Uint8Array(__buf);
        for (var i = 0; i < len; i++) {
            __view8.set([Math.floor(Math.random() * 256)], i);
        }
        return {
            err: constants.WASI_ESUCCESS,
            buffer: __buf,
        };
    }
    async pread(len, _pos) {
        return this.read(len);
    }
}
