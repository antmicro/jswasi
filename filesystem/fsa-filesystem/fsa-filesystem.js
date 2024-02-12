import { AbstractFileDescriptor, AbstractDirectoryDescriptor, } from "../filesystem.js";
import { stringToBool, basename, dirname } from "../../utils.js";
import * as constants from "../../constants.js";
import { listStoredKeys, delStoredData, getStoredData, setStoredData, } from "./metadata.js";
async function initMetadataPath(handle) {
    const components = await (await navigator.storage.getDirectory()).resolve(handle);
    return components.join("/");
}
/**
 * Returns wasi error code corresponding to a given DOMException
 *
 * @param e - DOMException instance
 * @param isDir - some error variants differ depending on whether a directory or a file was requested
 *
 * @returns wasi error code
 */
function mapErr(e, isDir) {
    switch (e.name) {
        case "NotAllowedError":
            return constants.WASI_EACCES;
        case "TypeMismatchError":
            if (isDir) {
                return constants.WASI_ENOTDIR;
            }
            else {
                return constants.WASI_EISDIR;
            }
        case "NotFoundError":
            return constants.WASI_ENOENT;
        case "InvalidModificationError":
            return constants.WASI_ENOTEMPTY;
        case "QuotaExceededError":
            return constants.WASI_EDQUOT;
        default:
            return constants.WASI_EINVAL;
    }
}
export class FsaFilesystem {
    rootHandle;
    keepMetadata;
    getRootHandle() {
        return this.rootHandle;
    }
    /**
     * Returns a handle using relative or absolute path
     *
     * @param path - path that is absolute or relative to the given handle
     * @param isDir - tells if the demanded path corresponds to a file or a directory
     * @param start_handle - handle from which to start searching if the given path is relative
     *
     * @returns an object holding three values:
     * index - index of the last processed path separator, if the search failed this separator is the one after the component that failed, however if the search succeeded it is equal to -1
     * err - wasi error code
     * handle - a demanded handle, if the search failed this field holds the last succesfully found handle
     */
    async getHandle(path, isDir, start_handle) {
        let stop, start, __isDir = true;
        let handle = start_handle === undefined ? this.getRootHandle() : start_handle;
        try {
            if (path.startsWith("/")) {
                start = 1;
            }
            else {
                start = 0;
            }
            for (stop = path.indexOf("/", start); stop != -1; stop = path.indexOf("/", start)) {
                // TODO: can fsa api handle .. and .?
                handle = await handle.getDirectoryHandle(path.slice(start, stop));
                start = stop + 1;
            }
            let __handle;
            __isDir = isDir;
            let component = path.slice(start);
            if (component === "") {
                __handle = handle;
            }
            else if (isDir) {
                __handle = await handle.getDirectoryHandle(component);
            }
            else {
                __handle = await handle.getFileHandle(component);
            }
            return {
                handle: __handle,
                err: constants.WASI_ESUCCESS,
                index: -1,
            };
        }
        catch (e) {
            let err;
            try {
                err = mapErr(e, __isDir);
            }
            catch {
                err = constants.WASI_EINVAL;
            }
            return { index: stop, err, handle };
        }
    }
    async unlinkat(desc, path, is_dir) {
        let start_handle = undefined;
        if (desc !== undefined) {
            if (desc instanceof FsaDirectoryDescriptor) {
                start_handle = desc.handle;
            }
            else {
                return constants.WASI_EINVAL;
            }
        }
        let { err, handle } = await this.getHandle(dirname(path), true, start_handle);
        if (err !== constants.WASI_ESUCCESS) {
            return err;
        }
        let name = basename(path);
        try {
            // check if deleted entry matches given type
            // TODO: does leaving it unchecked make sense?
            let __err = (await this.getHandle(name, is_dir, handle)).err;
            if (__err !== constants.WASI_ESUCCESS) {
                return __err;
            }
            handle.removeEntry(name, {
                recursive: false,
            });
            await delStoredData(`${await initMetadataPath(handle)}/${path}`);
            return constants.WASI_ESUCCESS;
        }
        catch (e) {
            let __err = constants.WASI_EINVAL;
            if (e instanceof DOMException) {
                __err = mapErr(e, true);
            }
            return __err;
        }
    }
    async mkdirat(desc, path) {
        let start_handle = undefined;
        if (desc !== undefined) {
            if (desc instanceof FsaDirectoryDescriptor) {
                start_handle = desc.handle;
            }
            else {
                return constants.WASI_EINVAL;
            }
        }
        let { err, handle } = await this.getHandle(dirname(path), true, start_handle);
        if (err !== constants.WASI_ESUCCESS) {
            return err;
        }
        let name = basename(path);
        ({ err } = await this.getHandle(name, true, handle));
        if (err === constants.WASI_ESUCCESS) {
            return constants.WASI_EEXIST;
        }
        if (err !== constants.WASI_ENOENT) {
            return err;
        }
        try {
            handle = await handle.getDirectoryHandle(path, {
                create: true,
            });
        }
        catch (e) {
            if (e instanceof DOMException) {
                const __err = mapErr(e, true);
                if (__err !== constants.WASI_ESUCCESS)
                    return __err;
            }
        }
        if (this.keepMetadata) {
            await setStoredData(await initMetadataPath(handle), {
                dev: 0n,
                ino: 0n,
                filetype: constants.WASI_FILETYPE_DIRECTORY,
                nlink: 1n,
                size: 4096n,
                mtim: 0n,
                atim: 0n,
                ctim: 0n,
            });
        }
        return constants.WASI_ESUCCESS;
    }
    async symlinkat(target, desc, linkpath) {
        let start_handle;
        if (desc !== undefined) {
            if (desc instanceof FsaDirectoryDescriptor) {
                start_handle = desc.handle;
            }
            else {
                return constants.WASI_EINVAL;
            }
        }
        let { err, handle } = await this.getHandle(dirname(linkpath), true, start_handle);
        if (err !== constants.WASI_ESUCCESS) {
            return err;
        }
        let name = basename(linkpath);
        ({ err } = await this.getHandle(name, false, handle));
        if (err === constants.WASI_ESUCCESS || err === constants.WASI_EISDIR) {
            return constants.WASI_EEXIST;
        }
        if (err !== constants.WASI_ENOENT) {
            return err;
        }
        let symlink = await handle.getFileHandle(linkpath, {
            create: true,
        });
        // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
        // @ts-ignore
        let symlink_writable = await symlink.createWritable();
        await symlink_writable.write(target);
        await symlink_writable.close();
        if (this.keepMetadata) {
            // TODO: fill dummy data with something meaningful
            await setStoredData(await initMetadataPath(symlink), {
                dev: 0n,
                ino: 0n,
                filetype: constants.WASI_FILETYPE_SYMBOLIC_LINK,
                nlink: 1n,
                size: BigInt(target.length),
                mtim: 0n,
                atim: 0n,
                ctim: 0n,
            });
        }
        return constants.WASI_ESUCCESS;
    }
    async getFilestat(path) {
        if (this.keepMetadata) {
            const metadataPath = this.getRootHandle().name + path;
            const filestat = await getStoredData(metadataPath);
            return {
                filestat,
                err: filestat ? constants.WASI_ESUCCESS : constants.WASI_ENOENT,
            };
        }
        else {
            const { err } = await this.getHandle(path, true, undefined);
            switch (err) {
                case constants.WASI_ENOTDIR:
                    return {
                        err: constants.WASI_ESUCCESS,
                        filestat: FsaDirectoryDescriptor.defaultFilestat,
                    };
                case constants.WASI_ESUCCESS:
                    return {
                        err: constants.WASI_ESUCCESS,
                        filestat: FsaFileDescriptor.defaultFilestat,
                    };
                default:
                    return {
                        err,
                        filestat: undefined,
                    };
            }
        }
    }
    async open(path, dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags, _workerId) {
        let result = await this.getHandle(path, true, undefined);
        let err = result.err, index = result.index, desc = undefined;
        switch (err) {
            // The search was succesfull and a directory was found
            case constants.WASI_ESUCCESS: {
                if (oflags & constants.WASI_O_CREAT) {
                    if (oflags & constants.WASI_O_EXCL) {
                        err = constants.WASI_EEXIST;
                    }
                    else {
                        err = constants.WASI_EISDIR;
                    }
                }
                else {
                    err = result.err;
                }
                index = result.index;
                desc = new FsaDirectoryDescriptor(result.handle, fdflags, fs_rights_base, fs_rights_inheriting, this.keepMetadata);
                break;
            }
            case constants.WASI_ENOTDIR: {
                if (index === -1) {
                    // the last component of the path caused an ENOTDIR error
                    if (oflags & constants.WASI_O_DIRECTORY &&
                        !(dirflags & constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW)) {
                        // directory was demanded and symlink follow is disabled - no point in further search
                        break;
                    }
                    const __result = await this.getHandle(basename(path), false, result.handle);
                    if (__result.err === constants.WASI_ESUCCESS) {
                        if (oflags & constants.WASI_O_CREAT &&
                            oflags & constants.WASI_O_EXCL) {
                            // The requested file already exists, while CREAT and EXCL are requested
                            // TODO: this check should rather be a part of top level fs
                            err = constants.WASI_EEXIST;
                        }
                        else if (!(oflags & constants.WASI_O_DIRECTORY)) {
                            // Indicate that the demanded path might be a symlink
                            // It is up to the top level fs to find out if the file is a symlink
                            // If user demanded a directory and a regular file was found, the search continues
                            // as that file might be a symlink that can be resolved to a directory
                            err = __result.err;
                        }
                        desc = new FsaFileDescriptor(__result.handle, fdflags, fs_rights_base, fs_rights_inheriting, this.keepMetadata);
                    }
                    break;
                }
                else if (dirflags & constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW) {
                    // If some component in the middle of the path is not a directory, it might be
                    // a symlink, if symlink follow flag is set, return a descriptor to the symlink
                    const __result = await this.getHandle(basename(path.slice(0, index)), false, result.handle);
                    if (__result.err === constants.WASI_ESUCCESS) {
                        desc = new FsaFileDescriptor(__result.handle, fdflags, fs_rights_base, fs_rights_inheriting, this.keepMetadata);
                    }
                    break;
                }
            }
            case constants.WASI_ENOENT: {
                // the last path component is the only one to fail
                // if O_CREAT is set, create the file
                if (oflags & constants.WASI_O_CREAT && index === -1) {
                    try {
                        const handle = await result.handle.getFileHandle(basename(path), {
                            create: true,
                        });
                        err = constants.WASI_ESUCCESS;
                        desc = new FsaFileDescriptor(handle, fdflags, fs_rights_base, fs_rights_inheriting, this.keepMetadata);
                        if (this.keepMetadata) {
                            desc.metadataPath = await initMetadataPath(handle);
                            await setStoredData(desc.metadataPath, {
                                dev: 0n,
                                ino: 0n,
                                filetype: constants.WASI_FILETYPE_REGULAR_FILE,
                                nlink: 1n,
                                size: 0n,
                                mtim: 0n,
                                atim: 0n,
                                ctim: 0n,
                            });
                        }
                    }
                    catch (e) {
                        if (e instanceof DOMException) {
                            err = mapErr(e, false);
                        }
                        else {
                            err = constants.WASI_EINVAL;
                        }
                    }
                }
                break;
            }
        }
        return { err, index, desc };
    }
    async renameat(oldDesc, oldPath, newDesc, newPath) {
        // Filesystem Access API doesn't support renaming entries at this point
        // This feature is now under development, the progress can be tracked here
        // https://chromestatus.com/feature/5640802622504960
        // Once it is stabilized, this implementation should use it
        // EXDEV indicates that user attempted to move files between mount points
        // most userspace apps will handle it by copying source and then removing it
        // Since clang uses path_rename and doesn't implement a fallback, a simple,
        // temporary solution is kept that is able to move a regular file by copying
        // TODO: remove this once fsapi implements renaming or use vfs temporary mount
        // in clang wrapper to avoid moving on fsa filesystem
        const BUFSIZE = 2048;
        if (oldDesc !== undefined && !(oldDesc instanceof FsaDirectoryDescriptor))
            return constants.WASI_EINVAL;
        const { handle: srcHandle, err: errSrc } = await this.getHandle(oldPath, false, oldDesc.handle);
        if (errSrc === constants.WASI_EISDIR)
            return constants.WASI_EXDEV;
        else if (errSrc !== constants.WASI_ESUCCESS)
            return errSrc;
        // Creating descriptors this way is dangerous and error-prone, this is just
        // a temporary workaround
        const srcDesc = new FsaFileDescriptor(srcHandle, 0, constants.WASI_RIGHTS_ALL, constants.WASI_RIGHTS_ALL, this.keepMetadata);
        await initializeFsaDesc(srcDesc);
        const srcFilestat = await srcDesc.getFilestat();
        if (srcFilestat.err !== constants.WASI_ESUCCESS)
            return srcFilestat.err;
        if (srcFilestat.filestat.filetype === constants.WASI_FILETYPE_SYMBOLIC_LINK)
            return constants.WASI_EXDEV;
        if (newDesc !== undefined && !(newDesc instanceof FsaDirectoryDescriptor))
            return constants.WASI_EINVAL;
        const { handle: __destHandle, err: __errDest } = await this.getHandle(dirname(newPath), true, newDesc.handle);
        if (__errDest !== constants.WASI_ESUCCESS)
            return __errDest;
        const destHandle = await __destHandle.getFileHandle(basename(newPath), { create: true });
        const destDesc = new FsaFileDescriptor(destHandle, 0, constants.WASI_RIGHTS_ALL, constants.WASI_RIGHTS_ALL, this.keepMetadata);
        await initializeFsaDesc(destDesc);
        while (true) {
            const { err, buffer } = await srcDesc.read(BUFSIZE);
            if (err !== constants.WASI_ESUCCESS)
                return err;
            if (buffer.byteLength === 0)
                break;
            const write = await destDesc.write(buffer);
            if (write.err !== constants.WASI_ESUCCESS)
                return err;
        }
        await srcDesc.close();
        await destDesc.close();
        await setStoredData(destDesc.metadataPath, srcFilestat.filestat);
        await this.unlinkat(oldDesc, oldPath, false);
        return constants.WASI_ESUCCESS;
    }
    async initialize(opts) {
        const __opts = opts;
        if (__opts.prompt) {
            // Metadata is not yet supported for local directories
            // name and prompt options cannot be used together
            // create makes no sense with prompt
            if (__opts.keepMetadata || __opts.name || __opts.create)
                return constants.WASI_EINVAL;
            try {
                // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
                // @ts-ignore
                this.rootHandle = await showDirectoryPicker();
            }
            catch (_) {
                // TODO: Catch error and return proper error code
                return constants.WASI_ENOENT;
            }
        }
        else if (__opts.name) {
            if (__opts.keepMetadata === undefined)
                this.keepMetadata = false;
            else
                this.keepMetadata = stringToBool(__opts.keepMetadata);
            const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle(__opts.name, {
                create: __opts.create === undefined ? false : stringToBool(__opts.create),
            });
            this.rootHandle = handle;
            const rootStoredData = await getStoredData(__opts.name);
            if (__opts.keepMetadata && !rootStoredData) {
                await setStoredData(__opts.name, FsaDirectoryDescriptor.defaultFilestat);
            }
        }
        return constants.WASI_ESUCCESS;
    }
    async mknodat(_desc, _path, _dev, _args) {
        return constants.WASI_EINVAL;
    }
    async cleanup() {
        // TODO: this should be callable using ioctl
        if (!this.keepMetadata)
            return;
        const label = this.rootHandle.name;
        await Promise.all((await listStoredKeys()).map(async (key) => {
            if (key.startsWith(label)) {
                const result = await this.open(key.replace(label, ""), 0, 0, constants.WASI_RIGHTS_ALL, constants.WASI_RIGHTS_ALL, 0, 0);
                if (result.err === constants.WASI_ENOENT)
                    await delStoredData(key);
            }
        }));
    }
}
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
async function initializeFsaDesc(desc) {
    if (desc.keepMetadata && desc.metadataPath === "") {
        desc.metadataPath = await initMetadataPath(desc.handle);
    }
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
class FsaFileDescriptor extends AbstractFileDescriptor {
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
class FsaDirectoryDescriptor extends AbstractDirectoryDescriptor {
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
