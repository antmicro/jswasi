import * as constants from "./constants.js";

export class Directory {
    public readonly file_type: number = constants.WASI_FILETYPE_DIRECTORY;
    public readonly path: string;
    private readonly _handle: FileSystemDirectoryHandle;

    constructor(path: string, handle: FileSystemDirectoryHandle) {
        this.path = path;
        this._handle = handle;
    }

    // TODO: fill dummy values with something meaningful
    async stat() {
        console.log(`Directory.stat()`);
        return {
            dev: 0n,
            ino: 0n,
            file_type: this.file_type,
            nlink: 0n,
            size: BigInt(4096),
            atim: 0n,
            mtim: 0n,
            ctim: 0n,
        };
    }

    open() {
        return new OpenDirectory(this.path, this._handle);
    }
}

export class OpenDirectory {
    public readonly file_type: number = constants.WASI_PREOPENTYPE_DIR;
    public readonly path: string;
    private readonly _handle: FileSystemDirectoryHandle;

    constructor(path: string, handle: FileSystemDirectoryHandle) {
        this.path = path;
        this._handle = handle;
    }

    private async _resolve(path: string): Promise<{err: number, name: string, dir_handle: FileSystemDirectoryHandle}> {
        const parts = [];

        for(const component of path.split("/")) {
            if (component == "..") {
                if (parts.length == 0) {
                    return {err: constants.WASI_ENOTCAPABLE, name: null, dir_handle: null};
                } else {
                    parts.pop()
                }
            } else if (component !== ".") {
                parts.push(component);
            }
        }

        const name = parts.pop();
        let dir_handle = this._handle;
        for (const part of parts) {
            dir_handle = await dir_handle.getDirectoryHandle(part);
        }

        return {err: constants.WASI_ESUCCESS, name, dir_handle};
    }


    async entries(): Promise<(File | Directory)[]>  {
        const a = [];
        for await (const [name, handle] of this._handle.entries()) {
            switch(handle.kind) {
                case "file": {
                    a.push(new File(name, handle));
                    break;
                }
                case "directory": {
                    a.push(new Directory(name, handle));
                    break;
                }
            }
        }
        return a;
    }

    async get_entry(path: string): Promise<File | Directory> {
        console.log(`OpenDirectory.get_entry_for_path(${path})`);
        let entry = this._handle;
        let components = path.split("/");
        for (let i = 0; i < components.length; i++) {
            let component = components[i];
            if (component == "") break;
            // this is a hack for cases when we path_open a directory that is already opened
            // TODO: implement proper behaviour for "." and ".."
            if (i == components.length -1 && component === ".") break;
            let found = false;
            if (entry == null) return null;
            if (entry instanceof FileSystemFileHandle) {
                console.log(`component '${component}' is a file not a directory`);
                return null;
            }
            for await (const [name, handle] of entry.entries()) {
                console.log({name, handle});
                if (name === component) {
                    entry = handle;
                    found = true;
                    break;
                }
            }
            if (!found) {
                return null;
            }
        }

        if (entry instanceof FileSystemFileHandle) {
            return new File(path, entry);
        } else {
            return new Directory(path, entry);
        }
    }

    async create_entry(path: string) {
        console.log(`OpenDirectory.create_entry_for_path(${path})`);
        let entry = this._handle;
        if (entry == null) return null;
        let components = path.split("/").filter((component) => component != "/");
        for (let i = 0; i < components.length; i++) {
            let component = components[i];
            let found = false;
            if (entry instanceof FileSystemFileHandle) {
                console.log(`component '${component}' is a file not a directory`);
                return null;
            }
            for await (const [name, handle] of entry.entries()) {
                if (name === component) {
                    entry = handle;
                    found = true;
                    break;
                }
            }
            if (!found) {
                if (i == components.length - 1) {
                    entry = await entry.getFileHandle(component, {create: true});
                } else {
                    console.log(`component '${component}' missing`);
                    return null;
                }
            }
        }
        return new File(path, entry);
    }

    async delete_entry(path: string, options): Promise<{err: number}> {
        const {err, name, dir_handle} = await this._resolve(path);
        await dir_handle.removeEntry(name, options);
        return {err: constants.WASI_ESUCCESS};
    }
}

export class File {
    public readonly file_type: number = constants.WASI_FILETYPE_REGULAR_FILE;
    public readonly path: string;
    private readonly _handle: FileSystemFileHandle;

    constructor(path: string, handle: FileSystemFileHandle) {
        this.path = path;
        this._handle = handle;

    }

    // TODO: fill dummy values with something meaningful
    async stat() {
        console.log(`File.stat()`);
        let file = await this._handle.getFile();
        return {
            dev: 0n,
            ino: 0n,
            file_type: constants.WASI_FILETYPE_REGULAR_FILE,
            nlink: 0n,
            size: BigInt(file.size),
            atim: 0n,
            mtim: 0n,
            ctim: 0n,
        };
    }

    async open() {
        return new OpenFile(this.path, this._handle);
    }
}

// Represents File opened for reading and writing
// it is backed by File System Access API through a FileSystemFileHandle handle
export class OpenFile {
    public readonly file_type: number = constants.WASI_FILETYPE_REGULAR_FILE;
    public readonly path: string;
    private readonly _handle: FileSystemFileHandle;
    private _file_pos: number = 0;

    constructor(path: string, handle: FileSystemFileHandle) {
        this.path = path;
        this._handle = handle;
    }

    // return file size in bytes
    async size(): Promise<number> {
        let file = await this._handle.getFile();
        return file.size;
    }

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

    // TODO: fill dummy values with something meaningful
    async stat() {
        console.log(`OpenFile.stat()`);
        return {
            dev: 0n,
            ino: 0n,
            file_type: constants.WASI_FILETYPE_REGULAR_FILE,
            nlink: 0n,
            size: BigInt(await this.size()),
            atim: 0n,
            mtim: 0n,
            ctim: 0n,
        };
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
