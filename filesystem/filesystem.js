import * as constants from "../constants.js";
export class AbstractDescriptor {
    fdstat;
    path;
    async getFdstat() {
        return this.fdstat;
    }
    async initialize(path) {
        this.path = path;
        return constants.WASI_ESUCCESS;
    }
    getPath() {
        return this.path;
    }
    async setFdstatFlags(flags) {
        this.fdstat.fs_flags = flags;
        return constants.WASI_ESUCCESS;
    }
    async setFdstatRights(rightsBase, rightsInheriting) {
        this.fdstat.fs_rights_base = rightsBase;
        this.fdstat.fs_rights_inheriting = rightsInheriting;
        return constants.WASI_ESUCCESS;
    }
    async ioctl(_request, _buf) {
        return constants.WASI_ENOTTY;
    }
    async mountFs(_opts) {
        return { err: constants.WASI_ENOTSUP, fs: undefined };
    }
}
export class AbstractFileDescriptor extends AbstractDescriptor {
    isatty() {
        return false;
    }
    async readdir(_refresh) {
        return {
            err: constants.WASI_ENOTDIR,
            dirents: undefined,
        };
    }
}
export class AbstractDirectoryDescriptor extends AbstractDescriptor {
    async close() {
        return constants.WASI_EISDIR;
    }
    async read(_len, _workerId) {
        return { err: constants.WASI_EISDIR, buffer: undefined };
    }
    async read_str() {
        return { err: constants.WASI_EISDIR, content: undefined };
    }
    async pread(_len, _pos) {
        return { err: constants.WASI_EISDIR, buffer: undefined };
    }
    async arrayBuffer() {
        return { err: constants.WASI_EISDIR, buffer: undefined };
    }
    async write(_buffer) {
        return { err: constants.WASI_EISDIR, written: -1n };
    }
    async pwrite(_buffer, _offset) {
        return { err: constants.WASI_EISDIR, written: -1n };
    }
    async seek(_offset, _whence) {
        return { err: constants.WASI_EISDIR, offset: -1n };
    }
    async writableStream() {
        return { err: constants.WASI_EISDIR, stream: undefined };
    }
    isatty() {
        return false;
    }
    async truncate(_size) {
        return constants.WASI_EISDIR;
    }
    addPollSub(userdata, eventType, _workerId) {
        return Promise.resolve({
            userdata,
            error: constants.WASI_ENOTSUP,
            eventType,
            nbytes: 0n,
        });
    }
}
export class AbstractDeviceDescriptor extends AbstractDescriptor {
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting) {
        super();
        this.fdstat = {
            fs_flags,
            fs_rights_base,
            fs_rights_inheriting,
            fs_filetype: constants.WASI_FILETYPE_CHARACTER_DEVICE,
        };
    }
    async getFilestat() {
        return { err: constants.WASI_EBADF, filestat: undefined };
    }
    async setFilestatTimes(_atim, _mtim) {
        return constants.WASI_EBADF;
    }
    async close() {
        return constants.WASI_EBADF;
    }
    async read(_len, _workerId) {
        return { err: constants.WASI_EBADF, buffer: undefined };
    }
    async read_str() {
        return { err: constants.WASI_EBADF, content: undefined };
    }
    async pread(_len, _pos) {
        return { err: constants.WASI_EBADF, buffer: undefined };
    }
    async arrayBuffer() {
        return { err: constants.WASI_EBADF, buffer: undefined };
    }
    async write(_buffer) {
        return { err: constants.WASI_EBADF, written: -1n };
    }
    async pwrite(_buffer, _offset) {
        return { err: constants.WASI_EBADF, written: -1n };
    }
    async seek(_offset, _whence) {
        return { err: constants.WASI_EBADF, offset: -1n };
    }
    async readdir(_refresh) {
        return { err: constants.WASI_EBADF, dirents: undefined };
    }
    async writableStream() {
        return { err: constants.WASI_EBADF, stream: undefined };
    }
    async truncate(_size) {
        return constants.WASI_EBADF;
    }
    addPollSub(userdata, eventType, _workerId) {
        return Promise.resolve({
            userdata,
            error: constants.WASI_ENOTSUP,
            eventType,
            nbytes: 0n,
        });
    }
}
