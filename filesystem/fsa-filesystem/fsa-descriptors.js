import * as constants from "../../constants.js";
import { AbstractFileDescriptor, AbstractDirectoryDescriptor } from "../filesystem.js";
import { initMetadataPath, mapErr } from "./utils.js";
import { getStoredData, setStoredData } from "./metadata.js";
function initFsaDesc(desc, fs_flags, fs_rights_base, fs_rights_inheriting, 
// There is no point in keeping metadata of local files mounted
// in in the app in the indexedDB as the metadata would have to
// be recursively applied and removed each mount/umount. Also,
// filesystem access API doesn't provide access to all fields of
// Filestat structure so in such cases, just return dummy metadata
keepMetadata) {
    desc.keepMetadata = keepMetadata;
    if (desc.keepMetadata) {
        desc.metadataPath = "";
    }
    desc.fdstat = {
        fs_flags,
        fs_rights_base,
        fs_rights_inheriting,
        fs_filetype: undefined,
    };
}
export async function initializeFsaDesc(desc) {
    if (desc.keepMetadata && desc.metadataPath === "")
        desc.metadataPath = await initMetadataPath(desc.handle);
}
async function setFilestatTimesFsaDesc(desc, atim, mtim) {
    if (desc.keepMetadata) {
        let filestat = await getStoredData(desc.metadataPath);
        if (atim !== undefined)
            filestat.atim = atim;
        if (mtim !== undefined)
            filestat.mtim = mtim;
        if (atim !== undefined || mtim !== undefined) {
            await setStoredData(desc.metadataPath, filestat);
        }
    }
    return constants.WASI_ESUCCESS;
}
export class FsaFileDescriptor extends AbstractFileDescriptor {
    handle;
    // Filesystem access API doesn't support real symlinks so
    // assume that by default every file is a regular file
    static defaultFilestat = {
        dev: 0n,
        ino: 0n,
        filetype: constants.WASI_FILETYPE_REGULAR_FILE,
        nlink: 1n,
        size: 0n,
        atim: 0n,
        mtim: 0n,
        ctim: 0n,
    };
    metadataPath;
    keepMetadata;
    cursor;
    // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
    // @ts-ignore
    writer;
    file;
    constructor(handle, fs_flags, fs_rights_base, fs_rights_inheriting, keepMetadata) {
        super();
        this.handle = handle;
        this.cursor = 0n;
        initFsaDesc(this, fs_flags, fs_rights_base, fs_rights_inheriting, keepMetadata);
        this.file = undefined;
    }
    async initialize(path) {
        const err = await super.initialize(path);
        if (err !== constants.WASI_ESUCCESS)
            return err;
        await initializeFsaDesc(this);
        const size = BigInt((await this.__getFile()).file?.size);
        let filetype;
        if (this.keepMetadata) {
            const filestat = await getStoredData(this.metadataPath);
            if (filestat == undefined)
                return constants.WASI_ENOENT;
            filetype = filestat.filetype;
        }
        else {
            filetype = FsaFileDescriptor.defaultFilestat.filetype;
        }
        this.fdstat.fs_filetype = filetype;
        if (this.fdstat.fs_flags & constants.WASI_FDFLAG_APPEND)
            this.cursor = size;
        return constants.WASI_ESUCCESS;
    }
    // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
    // @ts-ignore
    async getWriter() {
        if (!this.writer) {
            // @ts-ignore
            this.writer = await this.handle.createWritable({
                keepExistingData: true,
            });
        }
        return this.writer;
    }
    /**
     * Auxiliary function for getting a file from a handle and handling errors
     */
    async __getFile() {
        if (!this.file) {
            try {
                const file = await this.handle.getFile();
                this.file = file;
                return { err: constants.WASI_ESUCCESS, file };
            }
            catch (_) {
                return { err: constants.WASI_EACCES, file: undefined };
            }
        }
        return { err: constants.WASI_ESUCCESS, file: this.file };
    }
    async read(len) {
        const { err, file } = await this.__getFile();
        if (err !== constants.WASI_ESUCCESS) {
            return { err, buffer: undefined };
        }
        const end = Number(this.cursor) + len;
        const buffer = await file
            .slice(Number(this.cursor), Number(end))
            .arrayBuffer();
        this.cursor += BigInt(buffer.byteLength);
        return {
            err: constants.WASI_ESUCCESS,
            buffer,
        };
    }
    async read_str() {
        const { err, file } = await this.__getFile();
        if (err !== constants.WASI_ESUCCESS) {
            return { err, content: undefined };
        }
        return { err: constants.WASI_ESUCCESS, content: await file.text() };
    }
    async pread(len, pos) {
        const { err, file } = await this.__getFile();
        if (err !== constants.WASI_ESUCCESS) {
            return { err, buffer: undefined };
        }
        const size = BigInt((await this.__getFile()).file?.size);
        const end = size < pos + BigInt(len) ? size : this.cursor + BigInt(len);
        return {
            err: constants.WASI_ESUCCESS,
            buffer: await file.slice(Number(pos), Number(end)).arrayBuffer(),
        };
    }
    async seek(offset, whence) {
        const size = BigInt((await this.__getFile()).file?.size);
        switch (whence) {
            case constants.WASI_WHENCE_CUR:
                if (this.cursor + offset < 0n) {
                    return { offset: this.cursor, err: constants.WASI_EINVAL };
                }
                this.cursor += offset;
                break;
            case constants.WASI_WHENCE_SET:
                if (offset < 0n) {
                    return { offset: this.cursor, err: constants.WASI_EINVAL };
                }
                this.cursor = offset;
                break;
            case constants.WASI_WHENCE_END:
                if (size < -offset) {
                    return { offset: this.cursor, err: constants.WASI_EINVAL };
                }
                this.cursor = size + offset;
                break;
            default:
                return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        return { err: constants.WASI_ESUCCESS, offset: this.cursor };
    }
    async setFilestatTimes(atim, mtim) {
        return setFilestatTimesFsaDesc(this, atim, mtim);
    }
    async write(buffer) {
        await (await this.getWriter()).write({
            type: "write",
            position: Number(this.cursor),
            data: buffer,
        });
        let written = BigInt(buffer.byteLength);
        this.cursor += written;
        return { err: constants.WASI_ESUCCESS, written };
    }
    async pwrite(buffer, offset) {
        await (await this.getWriter()).write({
            type: "write",
            position: Number(offset),
            data: buffer,
        });
        let written = BigInt(buffer.byteLength);
        return { err: constants.WASI_ESUCCESS, written };
    }
    async writableStream() {
        return { err: constants.WASI_ESUCCESS, stream: await this.getWriter() };
    }
    async truncate(size) {
        try {
            await (await this.getWriter()).write({ type: "truncate", size: Number(size) });
        }
        catch (e) {
            if (e instanceof DOMException) {
                return mapErr(e, false);
            }
            return constants.WASI_EINVAL;
        }
        await this.flush();
        this.cursor = 0n;
        return constants.WASI_ESUCCESS;
    }
    async arrayBuffer() {
        let buffer = await (await this.handle.getFile()).arrayBuffer();
        return { err: constants.WASI_ESUCCESS, buffer };
    }
    async flush() {
        if (this.writer) {
            const writer = this.writer;
            this.writer = null;
            // prevent other processes from closing the same descriptor
            // TODO: is mutex necessary here?
            try {
                await writer?.close();
            }
            catch (_) { }
        }
    }
    async close() {
        await this.flush();
        return constants.WASI_ESUCCESS;
    }
    async getFilestat() {
        let filestat = this.keepMetadata
            ? await getStoredData(this.metadataPath)
            : FsaFileDescriptor.defaultFilestat;
        // TODO: revisit errno choice
        if (filestat === undefined)
            return { err: constants.WASI_ENOTRECOVERABLE, filestat: undefined };
        filestat.size = BigInt((await this.__getFile()).file?.size);
        return { err: constants.WASI_ESUCCESS, filestat };
    }
    // This function should not be async, in case the local file variable is not
    // present, this call might not resolve on time
    async addPollSub(userdata, eventType, _workerId) {
        const nbytes = BigInt(this.file ? this.file.size : (await this.__getFile()).file.size);
        return {
            userdata,
            error: constants.WASI_ESUCCESS,
            eventType,
            nbytes,
        };
    }
}
export class FsaDirectoryDescriptor extends AbstractDirectoryDescriptor {
    handle;
    metadataPath;
    keepMetadata;
    static defaultFilestat = {
        dev: 0n,
        ino: 0n,
        filetype: constants.WASI_FILETYPE_DIRECTORY,
        nlink: 1n,
        size: 4096n,
        atim: 0n,
        mtim: 0n,
        ctim: 0n,
    };
    entries;
    constructor(handle, fs_flags, fs_rights_base, fs_rights_inheriting, keepMetadata) {
        super();
        this.handle = handle;
        initFsaDesc(this, fs_flags, fs_rights_base, fs_rights_inheriting, keepMetadata);
        this.fdstat.fs_filetype = constants.WASI_FILETYPE_DIRECTORY;
        this.entries = [];
    }
    async initialize(path) {
        const err = await super.initialize(path);
        if (err !== constants.WASI_ESUCCESS)
            return err;
        await initializeFsaDesc(this);
        return constants.WASI_ESUCCESS;
    }
    async getFilestat() {
        if (this.keepMetadata) {
            const filestat = await getStoredData(this.metadataPath);
            if (filestat === undefined)
                return { err: constants.WASI_ENOTRECOVERABLE, filestat: undefined };
            return { err: constants.WASI_ESUCCESS, filestat };
        }
        else {
            return {
                err: constants.WASI_ESUCCESS,
                filestat: FsaDirectoryDescriptor.defaultFilestat,
            };
        }
    }
    async setFilestatTimes(atim, mtim) {
        return setFilestatTimesFsaDesc(this, atim, mtim);
    }
    async readdir(refresh) {
        let err = constants.WASI_ESUCCESS;
        if (refresh || this.entries.length === 0) {
            this.entries = [];
            var i = 1n;
            // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
            // @ts-ignore
            for await (const [name, handle] of this.handle.entries()) {
                if (name.endsWith(".crswap")) {
                    continue;
                }
                let filestat;
                if (this.keepMetadata) {
                    filestat = await getStoredData(`${this.metadataPath}/${name}`);
                }
                else {
                    filestat =
                        handle instanceof FileSystemDirectoryHandle
                            ? FsaDirectoryDescriptor.defaultFilestat
                            : FsaFileDescriptor.defaultFilestat;
                }
                // TODO: revisit errno choice
                if (filestat === undefined) {
                    err = constants.WASI_ENOTRECOVERABLE;
                }
                else {
                    this.entries.push({
                        d_next: i++,
                        d_ino: filestat.ino,
                        name,
                        d_type: filestat.filetype,
                    });
                }
            }
        }
        return { err, dirents: this.entries };
    }
}
