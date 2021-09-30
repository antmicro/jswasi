import * as constants from "./constants.js";
import {realpath, parsePath, arraysEqual} from "./utils.js";
import {FileOrDir, OpenFlags} from "./filesystem.js";


export class Filesystem {
    mounts: {parts: string[], name: string, dir: Directory}[] = [];

    rootDir: Directory;

    async getRootDirectory(): Promise<Directory> {
        if (!this.rootDir) {
            const root = await navigator.storage.getDirectory();
            const rootDir = new Directory("", root, null, this);
            rootDir.parent = rootDir; // TODO: root dir parent should root dir or null?
	        this.rootDir = rootDir;
        }
        return this.rootDir;
    }

    async getDirectory(dir: Directory, name: string, options: {create: boolean}={create: false}): Promise<Directory> {
        // TODO: revisit this hack
        if (name === ".") {
            return dir;
        } else if (name === "..") {
            return dir.parent;
        }

	    const root = await navigator.storage.getDirectory();
	    let components = null;
	    try {
                components = await root.resolve(dir._handle);
	    } catch {
	        console.log("There was an error in root.resolve...");
	    }

        // if there are many mounts for the same path, we want to return the latest
        const reversed_mounts = [].concat(this.mounts).reverse();
        for (const {parts,  name: child_name, dir: child_dir} of reversed_mounts) {
            if (arraysEqual(parts, components) && child_name === name) {
                return child_dir;
            }
        }
        const handle = await dir._handle.getDirectoryHandle(name, options);
        return new Directory(name, handle, dir, this);
    }
    
    async getFile(dir: Directory, name: string, options: {create: boolean}={create: false}): Promise<File> {
        const handle = await dir._handle.getFileHandle(name, options);
        return new File(name, handle, dir, this);
    }

    async path_exists(absolute_path, mode: FileOrDir = FileOrDir.Any): Promise<boolean> {
        const {parts, name} = parsePath(absolute_path);
        const rootDir = await this.getRootDirectory();
        const padre = (await rootDir.get_entry(parts.join("/"), mode, 0)).entry;
        try {
            await padre._handle.getDirectoryHandle(name);
        } catch {
            return false;
        }
        return true;
    }

    async addMount(absolute_path: string, mounted_handle: FileSystemDirectoryHandle): Promise<number> {
        // TODO: for now path must be absolute
        // TODO: refactor this when adding relative paths support for mount
        const {parts, name} = parsePath(absolute_path);
        const rootDir = await this.getRootDirectory();
        const parent = await rootDir.get_entry(parts.join("/"), FileOrDir.Directory);
        const dir = new Directory(name, mounted_handle, parent.entry, this);
        this.mounts.push({parts, name, dir});
        return constants.WASI_ESUCCESS;
    }

    isMounted(absolute_path: string): boolean {
        const {parts: del_parts, name: del_name} = parsePath(absolute_path);
        for (let i = 0; i < this.mounts.length; i++) {
            const {parts, name} = this.mounts[i];
            if (arraysEqual(parts, del_parts) && name === del_name) {
                return true;
            }
        }
        return false;
    }

    removeMount(absolute_path: string) {
        // TODO: for now path must be absolute
        const {parts: del_parts, name: del_name} = parsePath(absolute_path);
        for (let i = 0; i < this.mounts.length; i++) {
            const {parts, name} = this.mounts[i];
            if (arraysEqual(parts, del_parts) && name === del_name) {
                this.mounts.splice(i, 1);
                return;
            }
        }
    }

    async resolveAbsolute(path: string): Promise<{err: number, name: string, dir: Directory}> {
	    console.log(`resolveAbsolute(${path})`);

	    if ((path == "/") || (path == "/.")) return {err: constants.WASI_ESUCCESS, name: ".", dir: await this.getRootDirectory()};
        const {parts, name} = parsePath(path);
        let dir = await this.getRootDirectory();

	    try {
            for (const part of parts) {
                dir = await this.getDirectory(dir, part);
            }
	        console.log(`resolveAbsolute(${path}) = ${name}, ${dir}`);
	        return {err: constants.WASI_ESUCCESS, name, dir};
	    } catch (err) {
            if (err.name === "NotFoundError") {
                return {err: constants.WASI_ENOENT, name: null, dir: null};
            } else if (err.name === "TypeMismatchError" || err.name == "TypeError") {
                return {err: constants.WASI_ENOTDIR, name: null, dir: null};
		    } else {
                throw err;
            }
        }
    }

    async resolve(dir: Directory, path: string): Promise<{err: number, name: string, dir: Directory}> {
        console.log(`resolve(${dir._handle.name}, ${path})`);

	    if (path.includes("\\")) return { err: constants.WASI_EINVAL, name: null, dir: null };
        if (path.startsWith("/") dir = await this.getRootDirectory();
        
        const {parts, name} = parsePath(path);

	    try {
            for (const part of parts) {
                dir = await this.getDirectory(dir, part);
            }
	    } catch (err) {
            if (err.name === "NotFoundError") {
                return {err: constants.WASI_ENOENT, name: null, dir: null};
            } else if (err.name === "TypeMismatchError" || err.name == "TypeError") {
                return {err: constants.WASI_ENOTDIR, name: null, dir: null};
		    } else {
                throw err;
            }
        }

	    console.log(`= ${name}, ${dir}`);
	    return {err: constants.WASI_ESUCCESS, name, dir};
    }

    async entries(dir: Directory): Promise<(File | Directory)[]>  {
        const root = await navigator.storage.getDirectory();
        const components = await root.resolve(dir._handle);

        const entries: (File | Directory)[] = [];

        const reversed_mounts = [].concat(this.mounts).reverse();
        for (const {parts,  name, dir} of reversed_mounts) {
            if (arraysEqual(parts, components)) {
                entries.push(dir);
            }
        }

        for await (const [name, handle] of dir._handle.entries()) {
            // mounted direcotries hide directories they are mounted to
            let already_exists = false;
            for (const entry of entries) {
                if (entry.path === name) {
                    already_exists = true;
                    break;
                }
            }
            if (already_exists) {
                continue;
            }

            switch(handle.kind) {
                case "file": {
                    entries.push(new File(name, handle, dir, this));
                    break;
                }
                case "directory": {
                    entries.push(new Directory(name, handle, dir, this));
                    break;
                }
            }
        }

        entries.push(new Directory(".", dir._handle, dir, this));
        entries.push(new Directory("..", dir.parent._handle, dir.parent, this));
        return entries;
    }
}

export class Stdin {

}

abstract class Entry {
    public readonly file_type: number;
    public readonly path: string;
    public parent: Directory;
    protected readonly _handle: FileSystemDirectoryHandle | FileSystemFileHandle;
    protected readonly _filesystem: Filesystem;

    constructor(path: string, handle: FileSystemDirectoryHandle | FileSystemFileHandle, parent: Directory, filesystem: Filesystem) {
        this.path = path;
        this._handle = handle;
        this.parent = parent;
        this._filesystem = filesystem;
    }

    abstract size(): Promise<number>;

    abstract lastModified(): Promise<number>;

    // TODO: fill dummy values with something meaningful
    async stat() {
        console.log(`Entry(${this.path}).stat()`);
        let lmod = await this.lastModified();
	    if (!isFinite(lmod)) lmod = 0; // TODO:
        const time = BigInt(lmod) * BigInt(1_000_000n);
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
    
    async entries(): Promise<(File | Directory)[]>  {
        console.log(`Directory(${this.path}).entries()`);
        return await this._filesystem.entries(this);
    }

    async lastModified(): Promise<number> {
        return 0;
        // // TODO: this is very slow for massive local directories
        // const entries = await this.entries();
        // const dates = await Promise.all(entries.map(entry => entry.lastModified()));
        // return Math.max(...dates);
    }

    open() {
        return new OpenDirectory(this.path, this._handle, this, this._filesystem);
    }

    // basically copied form RReverser's wasi-fs-access
    get_entry(
        path: string,
        mode: FileOrDir.File,
        openFlags?: OpenFlags
    ): Promise<{err: number, entry: File}>;
    get_entry(
        path: string,
        mode: FileOrDir.Directory,
        openFlags?: OpenFlags
    ): Promise<{err: number, entry: Directory}>;
    get_entry(
        path: string,
        mode: FileOrDir,
        openFlags?: OpenFlags
    ): Promise<{err: number, entry: File | Directory}>;
    async get_entry(path: string, mode: FileOrDir, oflags: OpenFlags = 0): Promise<{err: number, entry: File | Directory}> {
        console.log(`Directory(${this.path}).get_entry(${path}, mode=${mode}, ${oflags})`);
    
        let {err: resolve_err, name, dir} = await this._filesystem.resolve(this, path);

        if (resolve_err !== constants.WASI_ESUCCESS) {
            return {err, entry: null};
        }    

        // TODO: that's not right
	    if (name == ".") {
            let entry = new Directory(name, dir._handle, this, this._filesystem);
            return {err: constants.WASI_ESUCCESS, entry};
	    }

        if (name === undefined) {
            if (oflags & (OpenFlags.Create | OpenFlags.Exclusive)) {
                return {err: constants.WASI_EEXIST, entry: null};
            }
            if (oflags & OpenFlags.Truncate) {
                return {err: constants.WASI_EISDIR, entry: null};
            }
            return {err: constants.WASI_ESUCCESS, entry: new Directory(this.path, this._handle, this, this._filesystem)};
        }

        if (oflags & OpenFlags.Directory) {
            mode = FileOrDir.Directory;
        }

        const openWithCreate = async (create: boolean): Promise<{err: number, entry: File | Directory}> => {
            if (mode & FileOrDir.File) {
                try {
                    const entry = await this._filesystem.getFile(dir, name, {create});
                    return {err: constants.WASI_ESUCCESS, entry};
                } catch (err) {
                    if (err.name === 'TypeMismatchError' || err.name == 'TypeError') {
                        if (!(mode & FileOrDir.Directory)) {
                            return {err: constants.WASI_EISDIR, entry: null};
                        }
                    } else if (err.name === 'NotFoundError') {
                        return {err: constants.WASI_ENOENT, entry: null};
                    } else {
                        throw err;
                    }
                }
            }
            try {
                const entry = await this._filesystem.getDirectory(dir, name, {create});
                return {err: constants.WASI_ESUCCESS, entry};
            } catch (err) {
                console.log(`we got an error! (${err.name})`);
                if (err.name === 'TypeMismatchError' || err.name === 'TypeError') {
                    return {err: constants.WASI_ENOTDIR, entry: null};                              
                } else if (err.name === 'NotFoundError') {
                    return {err: constants.WASI_ENOENT, entry: null};
                } else {
                    throw err;
                }
            }
        }

        let err = -1;
        let entry: File | Directory;
        if (oflags & OpenFlags.Create) {
            if (oflags & OpenFlags.Exclusive) {
                if ((await openWithCreate(false)).err === constants.WASI_ESUCCESS) {
                    return {err: constants.WASI_EEXIST, entry: null};
                }
            }
            ({err, entry} = await openWithCreate(true));
        } else {
            ({err, entry} = await openWithCreate(false));
        }

        if (err !== constants.WASI_ESUCCESS) {
            return {err, entry: null};
        }
                
        if (oflags & OpenFlags.Truncate) {
            if (entry._handle.kind === "directory") {
                return {err: constants.WASI_EISDIR, entry: null};
            }
            const writable = await entry._handle.createWritable();
            await writable.write({type: "truncate", size: 0});
            await writable.close();
        }

        return {err, entry};
    }

}

export class OpenDirectory extends Directory {
    public readonly file_type: number = constants.WASI_PREOPENTYPE_DIR;

    async delete_entry(path: string, options): Promise<{err: number}> {
        const {err, name, dir} = await this._filesystem.resolve(this, path);
        await dir._handle.removeEntry(name, options);
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
        return new OpenFile(this.path, this._handle, this.parent, this._filesystem);
    }
}

// Represents File opened for reading and writing
// it is backed by File System Access API through a FileSystemFileHandle handle
export class OpenFile extends File {
    public readonly file_type: number = constants.WASI_FILETYPE_REGULAR_FILE;
    private _file_pos: number = 0;

    async read(len: number): Promise<[Uint8Array, number]> {
        console.log(`OpenFile(${this.path}).read(${this.path} ${len})`);
        let size = await this.size();
        if (this._file_pos < size) {
            let file = await this._handle.getFile();
            let data = await file.slice(this._file_pos, this._file_pos + len).arrayBuffer();
            data = await data.slice(0);
            let slice = new Uint8Array(data);
            this._file_pos += slice.byteLength;
            return [slice, 0];
        } else {
            return [new Uint8Array(0), 0];
        }
    }

    // TODO: each write creates new writable, store it on creation
    async write(buffer: Uint8Array): Promise<number> {
	console.log(`OpenFile(${this.path}).write(${this.path} len=${buffer.byteLength}, position ${this._file_pos})`);
	try {
            const w = await this._handle.createWritable({ keepExistingData: true });
            await w.write({type: "write", position: this._file_pos, data: buffer});
	    await w.close();
            this._file_pos += buffer.byteLength;
	} catch {
            console.log("There was an error during writing!");
            return 1;
	}
        return 0;
    }

    async seek(offset: number, whence: number) {
        console.log(`OpenFile(${this.path}).seek(${offset}, ${whence})`);
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
        console.log(`OpenFile(${this.path}).truncate()`);
        const w = await this._handle.createWritable();
        await w.write({type: "truncate", size: 0})
        this._file_pos = 0;
    }
}
