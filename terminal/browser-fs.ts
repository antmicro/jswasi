import * as constants from "./constants.js";
import {FileOrDir, OpenFlags} from "./filesystem.js";

export async function resolve(dir_handle: FilesystemDirectoryHandle, path: string): Promise<{err: number, name: string, dir_handle: FileSystemDirectoryHandle}> {
    const parts = [];

    for(const component of path.split("/")) {
        if (component == "..") {
            parts.pop()
        } else if (component !== ".") {
            parts.push(component);
        }
    }

    const name = parts.pop();
    for (const part of parts) {
        try {
            dir_handle = await dir_handle.getDirectoryHandle(part);
        } catch (err) {
            if (err.name === "NotFoundError") {
                return {err: constants.WASI_ENOENT, name: null, dir_handle: null};
            } else if (err.name === "TypeMismatchError") {
                return {err: constants.WASI_EEXIST, name: null, dir_handle: null};
            } else {
                throw err;
            }
        }
    }

    return {err: constants.WASI_ESUCCESS, name, dir_handle};
}

export class BrowserFilesystem {
    mounts: [string, FileSystemDirectoryHandle][];

    async getRootDirectory(): Promise<Directory> {
        const root = await navigator.storage.getDirectory();
        return new Directory("/", root, this);
    }

    async addMount(path: string, mount_directory: FileSystemDirectoryHandle) {
        this.mounts.push([path, mount_directory]);
    }
}

abstract class Entry {
    public readonly file_type: number;
    public readonly path: string;
    protected readonly _handle: FileSystemDirectoryHandle | FileSystemFileHandle;
    protected readonly _filesystem: BrowserFilesystem;

    constructor(path: string, handle: FileSystemDirectoryHandle | FileSystemFileHandle, filesystem: BrowserFilesystem) {
        this.path = path;
        this._handle = handle;
        this._filesystem = filesystem;
    }

    abstract size(): Promise<number>;

    abstract lastModified(): Promise<number>;

    // TODO: fill dummy values with something meaningful
    async stat() {
        console.log(`Entry.stat()`);
        const time = BigInt(await this.lastModified()) * 1_000_000n;
        return {
            dev: 0n,
            ino: 0n,
            file_type: this.file_type,
            nlink: 0n,
            size: BigInt(await this.size()),
            atim: time,
            mtim: time, 
            ctim: time,
        };
    }
}

export class Directory extends Entry {
    public readonly file_type: number = constants.WASI_FILETYPE_DIRECTORY;
    declare _handle: FileSystemDirectoryHandle;

    async size(): Promise<number> {
        return 0;
    }
    
    async lastModified(): Promise<number> {
        // TODO: this could recursively call all entries lastModified() and pick latest
        //       but it wouldn't be too optimal and there is no way to store that information for now
        return 0;
    }

    open() {
        return new OpenDirectory(this.path, this._handle, this._filesystem);
    }
}

export class OpenDirectory extends Directory {
    public readonly file_type: number = constants.WASI_PREOPENTYPE_DIR;



    async entries(): Promise<(File | Directory)[]>  {
        const a = [];
        for await (const [name, handle] of this._handle.entries()) {
            switch(handle.kind) {
                case "file": {
                    a.push(new File(name, handle, this._filesystem));
                    break;
                }
                case "directory": {
                    a.push(new Directory(name, handle, this._filesystem));
                    break;
                }
            }
        }
        return a;
    }

    // basically copied form RReverser's wasi-fs-access
    async get_entry(path: string, mode: FileOrDir, oflags: OpenFlags = 0): Promise<{err: number, entry: File | Directory}> {
        console.log(`OpenDirectory.get_entry(${path}, ${oflags})`);
    
        let {err, name, dir_handle} = await resolve(this._handle, path);
        if (err !== constants.WASI_ESUCCESS) {
            return {err, entry: null};
        }    

        if (name === undefined) {
            if (oflags & (OpenFlags.Create | OpenFlags.Exclusive)) {
                return {err: constants.WASI_EEXIST, entry: null};
            }
            if (oflags & OpenFlags.Truncate) {
                return {err: constants.WASI_EISDIR, entry: null};
            }
            return {err: constants.WASI_ESUCCESS, entry: new Directory(this.path, this._handle, this._filesystem)};
        }

        
        if (oflags & OpenFlags.Directory) {
            mode = FileOrDir.Directory;
        }

        const openWithCreate = async (create: boolean): Promise<{err: number, handle: FileSystemFileHandle | FileSystemDirectoryHandle}> => {
            if (mode & FileOrDir.File) {
                try {
                    return {err: constants.WASI_ESUCCESS, handle: await dir_handle.getFileHandle(name, {create})};
                } catch (err) {
                    if (err.name === 'TypeMismatchError') {
                        if (!(mode & FileOrDir.Directory)) {
                            return {err: constants.WASI_EISDIR, handle: null};
                        }
                    } else if (err.name === 'NotFoundError') {
                        return {err: constants.WASI_ENOENT, handle: null};
                    } else {
                        throw err;
                    }
                }
            }
            try {
                return {err: constants.WASI_ESUCCESS, handle: await dir_handle.getDirectoryHandle(name, {create})};
            } catch (err) {
                if (err.name === 'TypeMismatchError') {
                    return {err: constants.WASI_ENOTDIR, handle: null};                              
                } else if (err.name === 'NotFoundError') {
                    return {err: constants.WASI_ENOENT, handle: null};
                } else {
                    throw err;
                }
            }
        }

        let handle;
        if (oflags & OpenFlags.Create) {
            if (oflags & OpenFlags.Exclusive) {
                if ((await openWithCreate(false)).err === constants.WASI_ESUCCESS) {
                    return {err: constants.WASI_EEXIST, entry: null};
                }
            }
            ({err, handle} = await openWithCreate(true));
        } else {
            ({err, handle} = await openWithCreate(false));
        }

        if (err !== constants.WASI_ESUCCESS) {
            return {err, entry: null};
        }
                
        if (oflags & OpenFlags.Truncate) {
            if (handle.kind === "directory") {
                return {err: constants.WASI_EISDIR, entry: null};
            }
            const writable = await handle.createWritable();
            writable.write({type: "truncate", size: 0});
            writable.close();
        }

        let entry;
        if (handle.kind == "file") {
            entry = new File(name, handle, this._filesystem);
        } else {
            entry = new Directory(name, handle, this._filesystem);
        }

        return {err: constants.WASI_ESUCCESS, entry};
    }

    async delete_entry(path: string, options): Promise<{err: number}> {
        const {err, name, dir_handle} = await resolve(this._handle, path);
        await dir_handle.removeEntry(name, options);
        return {err: constants.WASI_ESUCCESS};
    }
}

export class File extends Entry {
    public readonly file_type: number = constants.WASI_FILETYPE_REGULAR_FILE;
    declare protected readonly _handle: FileSystemFileHandle;

    async size(): Promise<number> {
        let file = await this._handle.getFile();
        return file.size;
    }
    
    async lastModified(): Promise<number> {
        let file = await this._handle.getFile();
        return file.lastModified;
    }

    async open() {
        return new OpenFile(this.path, this._handle, this._filesystem);
    }
}

// Represents File opened for reading and writing
// it is backed by File System Access API through a FileSystemFileHandle handle
export class OpenFile extends File {
    public readonly file_type: number = constants.WASI_FILETYPE_REGULAR_FILE;
    private _file_pos: number = 0;

    async read(len: number): Promise<[Uint8Array, number]> {
        console.log(`OpenFile.read(${len})`);
        if (this._file_pos < await this.size()) {
            let file = await this._handle.getFile();
            let slice = new Uint8Array(await file.slice(this._file_pos, this._file_pos + len).arrayBuffer());
            this._file_pos += slice.byteLength;
            return [slice, 0];
        } else {
            return [new Uint8Array(0), 0];
        }
    }

    // TODO: each write creates new writable, store it on creation
    async write(buffer: string) {
        console.log(`OpenFile.write(${buffer})`);
        const w = await this._handle.createWritable();
        await w.write({type: "write", position: this._file_pos, data: buffer});
        await w.close();
        this._file_pos += buffer.length;
        return 0;
    }

    async seek(offset: number, whence: number) {
        console.log(`OpenFile.seek(${offset}, ${whence})`);
        switch (whence) {
            case constants.WASI_WHENCE_SET: {
                this._file_pos = offset;
                break;
            }
            case constants.WASI_WHENCE_CUR: {
                this._file_pos += offset;
                break;
            }
            case constants.WASI_WHENCE_END: {
                this._file_pos = await this.size() + offset;
            }
        }
        // TODO: this only makes sense if we store WritableFileStream on class
        // await w.write({type: "seek", position: offset});
    }

    async truncate() {
        console.log(`OpenFile.truncate()`);
        const w = await this._handle.createWritable();
        await w.write({type: "truncate", size: 0})
        this._file_pos = 0;
    }
}
