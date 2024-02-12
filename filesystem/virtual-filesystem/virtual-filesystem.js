import { AbstractFileDescriptor, AbstractDirectoryDescriptor, } from "../filesystem.js";
import * as constants from "../../constants.js";
// @ts-ignore
import * as vfs from "../../third_party/vfs.js";
function wasiFiletype(stat) {
    switch (stat.mode & vfs.constants.S_IFMT) {
        case vfs.constants.S_IFREG:
            return constants.WASI_FILETYPE_REGULAR_FILE;
        case vfs.constants.S_IFDIR:
            return constants.WASI_FILETYPE_DIRECTORY;
        case vfs.constants.S_IFBLK:
            return constants.WASI_FILETYPE_BLOCK_DEVICE;
        case vfs.constants.S_IFCHR:
            return constants.WASI_FILETYPE_CHARACTER_DEVICE;
        case vfs.constants.S_IFLNK:
            return constants.WASI_FILETYPE_SYMBOLIC_LINK;
        case vfs.constants.S_IFSOCK:
            // Posix doesn't include two filetypes for datagram and stream sockets
            return constants.WASI_FILETYPE_SOCKET_STREAM;
        default:
            return constants.WASI_FILETYPE_UNKNOWN;
    }
}
export function wasiFilestat(stat) {
    return {
        dev: BigInt(stat.dev),
        ino: BigInt(stat.ino),
        nlink: BigInt(stat.nlink),
        filetype: wasiFiletype(stat),
        size: BigInt(stat.size),
        atim: BigInt(stat.atime),
        mtim: BigInt(stat.mtime),
        ctim: BigInt(stat.ctime),
    };
}
export class VirtualFilesystem {
    virtualFs;
    constructor() {
        const __devMgr = new vfs.DeviceManager();
        const __inoMgr = new vfs.INodeManager(__devMgr);
        const [_, __rootDirIno] = __inoMgr.createINode(vfs.Directory, {});
        const __fdMgr = new vfs.FileDescriptorManager(__inoMgr);
        this.virtualFs = new vfs.VirtualFS(0o022, __rootDirIno, __devMgr, __inoMgr, __fdMgr);
    }
    async mkdirat(desc, path) {
        let navigated;
        let __desc;
        if (desc === undefined) {
            navigated = this.virtualFs._navigate(path, false);
        }
        else {
            if (desc instanceof VirtualFilesystemDirectoryDescriptor) {
                __desc = desc;
                navigated = this.virtualFs._navigateFrom(__desc.dir, path, false);
            }
            else {
                return constants.WASI_EINVAL;
            }
        }
        if (navigated.target) {
            return constants.WASI_EEXIST;
        }
        const [_, index] = this.virtualFs._iNodeMgr.createINode(vfs.Directory, {
            mode: vfs.DEFAULT_DIRECTORY_PERM,
            uid: 0,
            gid: 0,
            parent: navigated.dir._dir["."],
        });
        navigated.dir.addEntry(path, index);
        return constants.WASI_ESUCCESS;
    }
    async getFilestat(path) {
        try {
            const __stat = this.virtualFs.statSync(path);
            return {
                err: constants.WASI_ESUCCESS,
                filestat: wasiFilestat(__stat),
            };
        }
        catch (e) {
            return e.errno;
        }
    }
    async unlinkat(desc, path, is_dir) {
        try {
            let navigated;
            if (desc === undefined) {
                navigated = this.virtualFs._navigate(path, false);
            }
            else if (desc instanceof VirtualFilesystemDirectoryDescriptor) {
                navigated = this.virtualFs._navigateFrom(desc.dir, path, false);
            }
            else {
                return constants.WASI_EINVAL;
            }
            if (!navigated.target) {
                return constants.WASI_ENOENT;
            }
            if (is_dir) {
                if (!(navigated.target instanceof vfs.Directory)) {
                }
            }
            else {
                if (navigated instanceof vfs.Directory) {
                    return constants.WASI_EISDIR;
                }
            }
            navigated.dir.deleteEntry(navigated.name);
            return constants.WASI_ESUCCESS;
        }
        catch (e) {
            return e.errno;
        }
    }
    async open(path, _dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags, _workerId) {
        const navigated = this.virtualFs._navigate(path, false);
        if (navigated.target) {
            let err, index;
            if (navigated.remaining) {
                err = constants.WASI_ENOTDIR;
                // navigated.remaining doesn't include leading slash, hence -1
                index = path.length - navigated.remaining.length - 1;
            }
            else {
                index = -1;
                if (oflags & constants.WASI_O_CREAT && oflags & constants.WASI_O_EXCL) {
                    err = constants.WASI_EEXIST;
                }
                else {
                    err = constants.WASI_ESUCCESS;
                }
            }
            let desc;
            if (navigated.target instanceof vfs.Directory) {
                desc = new VirtualFilesystemDirectoryDescriptor(fdflags, fs_rights_base, fs_rights_inheriting, navigated.target, this.virtualFs._iNodeMgr);
            }
            else {
                if ((navigated.target instanceof vfs.File ||
                    navigated.target instanceof vfs.Symlink) &&
                    !(oflags & constants.WASI_O_DIRECTORY)) {
                    desc = new VirtualFilesystemFileDescriptor(fdflags, fs_rights_base, fs_rights_inheriting, this.virtualFs._fdMgr.createFd(navigated.target, vfs.constants.O_RDWR)[0]);
                }
                else {
                    desc = new VirtualFilesystemDirectoryDescriptor(fdflags, fs_rights_base, fs_rights_inheriting, navigated.dir, this.virtualFs._iNodeMgr);
                    if (oflags & constants.WASI_O_DIRECTORY) {
                        err = constants.WASI_ENOTDIR;
                    }
                    else if (navigated.target instanceof vfs.CharacterDev) {
                        err = constants.WASI_ENODEV;
                    }
                }
            }
            return { err, index, desc };
        }
        else if (oflags & constants.WASI_O_CREAT) {
            let [target, index] = this.virtualFs._iNodeMgr.createINode(vfs.File, {
                mode: vfs.DEFAULT_FILE_PERM,
                uid: 0,
                gid: 0,
            });
            navigated.dir.addEntry(navigated.name, index);
            const [__desc, _] = this.virtualFs._fdMgr.createFd(target, vfs.constants.O_RDWR);
            return {
                err: constants.WASI_ESUCCESS,
                index: -1,
                desc: new VirtualFilesystemFileDescriptor(fdflags, fs_rights_base, fs_rights_inheriting, __desc),
            };
        }
        else {
            return {
                err: constants.WASI_ENOENT,
                index: -1,
                desc: new VirtualFilesystemDirectoryDescriptor(fdflags, fs_rights_base, fs_rights_inheriting, navigated.dir, this.virtualFs._iNodeMgr),
            };
        }
    }
    async renameat(oldDesc, oldPath, newDesc, newPath) {
        let oldNavigated;
        let __oldDesc;
        if (oldDesc === undefined) {
            oldNavigated = this.virtualFs._navigate(oldPath, false);
        }
        else {
            if (oldDesc instanceof VirtualFilesystemDirectoryDescriptor) {
                __oldDesc = oldDesc;
                oldNavigated = this.virtualFs._navigateFrom(__oldDesc.dir, oldPath, false);
            }
            else {
                return constants.WASI_EINVAL;
            }
        }
        let newNavigated;
        let __newDesc;
        if (newDesc === undefined) {
            newNavigated = this.virtualFs._navigate(newPath, false);
        }
        else {
            if (newDesc instanceof VirtualFilesystemDirectoryDescriptor) {
                __newDesc = newDesc;
                newNavigated = this.virtualFs._navigateFrom(__newDesc.dir, newPath, false);
            }
            else {
                return constants.WASI_EINVAL;
            }
        }
        if (!oldNavigated.target) {
            return constants.WASI_ENOENT;
        }
        if (!newNavigated.target) {
            if (newNavigated.remaining.length !== 0) {
                return constants.WASI_ENOENT;
            }
        }
        else {
            return constants.WASI_EEXIST;
        }
        const index = oldNavigated.dir.getEntryIndex(oldNavigated.name);
        newNavigated.dir.addEntry(newNavigated.name, index);
        oldNavigated.dir.deleteEntry(oldNavigated.name, index);
        return constants.WASI_ESUCCESS;
    }
    async symlinkat(target, desc, linkpath) {
        let navigated;
        let __desc;
        if (desc === undefined) {
            navigated = this.virtualFs._navigate(linkpath, false);
        }
        else {
            if (desc instanceof VirtualFilesystemDirectoryDescriptor) {
                __desc = desc;
                navigated = this.virtualFs._navigateFrom(__desc.dir, linkpath, false);
            }
            else {
                return constants.WASI_EINVAL;
            }
        }
        if (navigated.target) {
            return constants.WASI_EEXIST;
        }
        const [_, index] = this.virtualFs._iNodeMgr.createINode(vfs.Symlink, {
            mode: vfs.DEFAULT_SYMLINK_PERM,
            uid: 0,
            gid: 0,
            link: target,
        });
        __desc.dir.addEntry(navigated.name, index);
        return constants.WASI_ESUCCESS;
    }
    async initialize(_opts) {
        return constants.WASI_ESUCCESS;
    }
    async mknodat(_desc, _path, _dev, _args) {
        return constants.WASI_EINVAL;
    }
}
function initVirtualDesc(desc, fs_flags, fs_rights_base, fs_rights_inheriting, stat) {
    desc.fdstat = {
        fs_flags,
        fs_rights_base,
        fs_rights_inheriting,
        fs_filetype: wasiFiletype(stat),
    };
}
class VirtualFilesystemWritableFileStream extends WritableStream {
    constructor(fd) {
        super({
            async write(chunk) {
                await fd.write(chunk.buffer);
                new WritableStream();
            },
        });
    }
}
class VirtualFilesystemFileDescriptor extends AbstractFileDescriptor {
    desc;
    cursor;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, desc) {
        super();
        this.desc = desc;
        initVirtualDesc(this, fs_flags, fs_rights_base, fs_rights_inheriting, desc._iNode.getMetadata());
        if (fs_flags & constants.WASI_FDFLAG_APPEND &&
            this.fdstat.fs_filetype !== constants.WASI_FILETYPE_SYMBOLIC_LINK) {
            this.cursor = desc._iNode._data.byteLength;
        }
        else {
            this.cursor = 0;
        }
    }
    async arrayBuffer() {
        return {
            err: constants.WASI_ESUCCESS,
            buffer: this.desc._iNode._data,
        };
    }
    async pread(len, pos) {
        return {
            err: constants.WASI_ESUCCESS,
            buffer: this.desc._iNode._data.slice(Number(pos), len + Number(pos)),
        };
    }
    async read(len) {
        const buffer = this.desc._iNode._data.slice(this.cursor, this.cursor + len);
        this.cursor += buffer.byteLength;
        return {
            err: constants.WASI_ESUCCESS,
            buffer,
        };
    }
    async read_str() {
        let content;
        if (this.fdstat.fs_filetype === constants.WASI_FILETYPE_REGULAR_FILE) {
            new TextDecoder().decode((content = this.desc._iNode._data));
        }
        else {
            content = this.desc._iNode._link;
        }
        return {
            err: constants.WASI_ESUCCESS,
            content,
        };
    }
    async write(buffer) {
        try {
            const written = await this.desc._iNode.write(buffer, this.cursor);
            this.cursor += written;
            return {
                err: constants.WASI_ESUCCESS,
                written: written,
            };
        }
        catch (e) {
            return { err: e.errno, written: 0n };
        }
    }
    async pwrite(buffer, offset) {
        try {
            return {
                err: constants.WASI_ESUCCESS,
                written: await this.desc._iNode.write(buffer, Number(offset)),
            };
        }
        catch (e) {
            return e.errno;
        }
    }
    async seek(offset, whence) {
        let size;
        if (this.fdstat.fs_filetype === constants.WASI_FILETYPE_SYMBOLIC_LINK) {
            size = BigInt((await this.desc._iNode._link).length);
        }
        else {
            size = BigInt((await this.desc._iNode._data).byteLength);
        }
        switch (whence) {
            case constants.WASI_WHENCE_CUR:
                if (this.cursor + Number(offset) < 0n) {
                    return { offset: BigInt(this.cursor), err: constants.WASI_EINVAL };
                }
                this.cursor += Number(offset);
                break;
            case constants.WASI_WHENCE_SET:
                if (offset < 0n) {
                    return { offset: BigInt(this.cursor), err: constants.WASI_EINVAL };
                }
                this.cursor = Number(offset);
                break;
            case constants.WASI_WHENCE_END:
                if (size < -offset) {
                    return { offset: BigInt(this.cursor), err: constants.WASI_EINVAL };
                }
                this.cursor = Number(size + offset);
                break;
            default:
                return { offset: BigInt(this.cursor), err: constants.WASI_EINVAL };
        }
        return { err: constants.WASI_ESUCCESS, offset: BigInt(this.cursor) };
    }
    async truncate(size) {
        try {
            this.desc._iNode._data.resize(Number(size));
            return constants.WASI_ESUCCESS;
        }
        catch (e) {
            return e.errno;
        }
    }
    async writableStream() {
        try {
            return {
                err: constants.WASI_ESUCCESS,
                stream: new VirtualFilesystemWritableFileStream(this),
            };
        }
        catch (e) {
            return e.errno;
        }
    }
    async getFilestat() {
        return {
            err: constants.WASI_ESUCCESS,
            filestat: wasiFilestat(this.desc._iNode.getMetadata()),
        };
    }
    async setFilestatTimes(atim, mtim) {
        if (mtim !== undefined)
            this.desc._iNode._metadata.mtime = mtim;
        if (atim !== undefined)
            this.desc._iNode._metadata.atime = atim;
        return constants.WASI_ESUCCESS;
    }
    async close() {
        return constants.WASI_ESUCCESS;
    }
    addPollSub(userdata, eventType, _workerId) {
        return Promise.resolve({
            userdata,
            eventType,
            error: constants.WASI_ESUCCESS,
            nbytes: BigInt(this.desc._iNode._data.byteLength),
        });
    }
}
export class VirtualFilesystemDirectoryDescriptor extends AbstractDirectoryDescriptor {
    dir;
    inodeMgr;
    dirents;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, dir, inodeMgr) {
        super();
        this.dir = dir;
        this.inodeMgr = inodeMgr;
        initVirtualDesc(this, fs_flags, fs_rights_base, fs_rights_inheriting, dir.getMetadata());
        this.dirents = undefined;
    }
    async readdir(refresh) {
        try {
            if (this.dirents === undefined || refresh) {
                this.dirents = Array.from(this.dir._dir)
                    .filter(([name, _inode]) => {
                    return name !== "." && name !== "..";
                })
                    .map(([name, inode], index) => {
                    return {
                        d_next: BigInt(index + 1),
                        d_ino: BigInt(inode),
                        name: name,
                        d_type: wasiFiletype(this.inodeMgr.getINode(inode).getMetadata()),
                    };
                });
            }
            return {
                err: constants.WASI_ESUCCESS,
                dirents: this.dirents,
            };
        }
        catch (e) {
            return {
                err: e.errno,
                dirents: [],
            };
        }
    }
    async getFilestat() {
        return {
            err: constants.WASI_ESUCCESS,
            filestat: wasiFilestat(this.dir.getMetadata()),
        };
    }
    async setFilestatTimes(atim, mtim) {
        if (mtim !== undefined)
            this.dir._metadata.mtime = mtim;
        if (atim !== undefined)
            this.dir._metadata.atime = atim;
        return constants.WASI_ESUCCESS;
    }
}
