import { AbstractDirectoryDescriptor, AbstractFileDescriptor, } from "../filesystem.js";
import * as constants from "../../constants.js";
export class ProcFileDescriptor extends AbstractFileDescriptor {
    procNode;
    contents;
    cursor;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, procNode) {
        super();
        this.procNode = procNode;
        this.fdstat = {
            fs_flags,
            fs_rights_base,
            fs_rights_inheriting,
            fs_filetype: this.procNode.getFilestat().filetype,
        };
        this.contents = new TextEncoder().encode(this.procNode.read());
        this.cursor = 0n;
    }
    addPollSub(userdata, eventType, _workerId) {
        return Promise.resolve({
            userdata,
            eventType,
            nbytes: BigInt(this.contents.byteLength),
            error: constants.WASI_ESUCCESS,
        });
    }
    arrayBuffer() {
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            buffer: this.contents,
        });
    }
    close() {
        return Promise.resolve(constants.WASI_ESUCCESS);
    }
    getFilestat() {
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            filestat: this.procNode.getFilestat(),
        });
    }
    pread(len, offset) {
        const buffer = this.contents.slice(Number(offset), Number(offset) + len);
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            buffer,
        });
    }
    pwrite(_buffer, _offset) {
        return Promise.resolve({
            err: constants.WASI_EACCES,
            written: 0n,
        });
    }
    read(len, _workerId) {
        const buffer = this.contents.slice(Number(this.cursor), Number(this.cursor) + len);
        this.cursor += BigInt(buffer.byteLength);
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            buffer,
        });
    }
    read_str() {
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            content: new TextDecoder().decode(this.contents),
        });
    }
    seek(offset, whence) {
        // TODO: this is basically copied from virtual-filesystem
        // this method could be unified for all filesystems and included
        // in AbstractFileDescriptor
        const size = BigInt(this.contents.byteLength);
        switch (whence) {
            case constants.WASI_WHENCE_CUR:
                if (this.cursor + offset < 0n) {
                    return Promise.resolve({
                        offset: this.cursor,
                        err: constants.WASI_EINVAL,
                    });
                }
                this.cursor += offset;
                break;
            case constants.WASI_WHENCE_SET:
                if (offset < 0n) {
                    return Promise.resolve({
                        offset: this.cursor,
                        err: constants.WASI_EINVAL,
                    });
                }
                this.cursor = offset;
                break;
            case constants.WASI_WHENCE_END:
                if (size < -offset) {
                    return Promise.resolve({
                        offset: this.cursor,
                        err: constants.WASI_EINVAL,
                    });
                }
                this.cursor = size + offset;
                break;
            default:
                return Promise.resolve({
                    offset: this.cursor,
                    err: constants.WASI_EINVAL,
                });
        }
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            offset: this.cursor,
        });
    }
    setFilestatTimes(_atim, _mtim) {
        return Promise.resolve(constants.WASI_EBADF);
    }
    truncate(_size) {
        return Promise.resolve(constants.WASI_EACCES);
    }
    writableStream() {
        return Promise.resolve({
            err: constants.WASI_EACCES,
            stream: undefined,
        });
    }
    write(_buffer) {
        return Promise.resolve({
            err: constants.WASI_EACCES,
            written: 0n,
        });
    }
}
export class ProcDirectoryDescriptor extends AbstractDirectoryDescriptor {
    procNode;
    dirents;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, procNode) {
        super();
        this.procNode = procNode;
        this.fdstat = {
            fs_flags,
            fs_rights_base,
            fs_rights_inheriting,
            fs_filetype: constants.WASI_FILETYPE_DIRECTORY,
        };
    }
    async readdir(refresh) {
        if (this.dirents === undefined || refresh) {
            const nodes = this.procNode.listNodes();
            if (nodes.err !== constants.WASI_ESUCCESS)
                return { err: nodes.err, dirents: undefined };
            this.dirents = Object.entries(nodes.nodes).map(([name, entry], index) => {
                return {
                    d_next: BigInt(index + 1),
                    d_ino: 0n,
                    name,
                    d_type: entry.getFilestat().filetype,
                };
            });
        }
        return {
            err: constants.WASI_ESUCCESS,
            dirents: this.dirents,
        };
    }
    getFilestat() {
        return Promise.resolve({
            err: constants.WASI_ESUCCESS,
            filestat: this.procNode.getFilestat(),
        });
    }
    setFilestatTimes(_atim, _mtim) {
        return Promise.resolve(constants.WASI_EBADF);
    }
}
