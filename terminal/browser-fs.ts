import * as constants from "./constants.js";
import {realpath, arraysEqual} from "./utils.js";
import {FileOrDir, OpenFlags, parsePath} from "./filesystem.js";


export class Filesystem {
    mounts: {parts: string[], name: string, handle: FileSystemDirectoryHandle, parent: Directory}[] = [];

    rootDir: Directory;

    async getRootDirectory(): Promise<Directory> {
        if (!this.rootDir) {
            const root = await navigator.storage.getDirectory();
	        this.rootDir = new Directory("", root, this);
        }
        return this.rootDir;
    }

    async getDirectoryHandle(handle: FileSystemDirectoryHandle, name: string, options: {create: boolean}={create: false}): Promise<FileSystemDirectoryHandle> {
	    const root = await navigator.storage.getDirectory();
	    let components = null;
	    try {
                components = await root.resolve(handle);
	    } catch {
	        console.log("There was an error in root.resolve...");
	    }

        // if there are many mounts for the same path, we want to return the latest
        const reversed_mounts = [].concat(this.mounts).reverse();
        for (const {parts,  name: child_name, handle: child_handle} of reversed_mounts) {
            if (arraysEqual(parts, components) && child_name === name) {
                return child_handle;
            }
        }
        return await handle.getDirectoryHandle(name, options);
    }
    
    async getFileHandle(handle: FileSystemDirectoryHandle, name: string, options: {create: boolean}={create: false}): Promise<FileSystemFileHandle> {
        const root = await navigator.storage.getDirectory();
        const components = await root.resolve(handle);

        // if there are many mounts for the same path, we want to return the latest
        const reversed_mounts = [].concat(this.mounts).reverse();
        for (const {parts,  name: child_name, handle: child_handle} of reversed_mounts) {
            if (arraysEqual(parts, components) && child_name === name) {
                throw TypeError;
            }
        }
        return await handle.getFileHandle(name, options);
    }

    async path_exists(absolute_path, mode: FileOrDir = FileOrDir.Any): Promise<boolean> {
        const {parts, name} = parsePath(absolute_path);
        const rootDir = await this.getRootDirectory();
        const padre = await rootDir.get_entry(parts.join("/"), mode, 0);
        try {
            await padre.entry._handle.getDirectoryHandle(name);
        } catch {
            return false;
        }
        return true;
    }

    async addMount(absolute_path: string, mounted_directory: FileSystemDirectoryHandle): Promise<number> {
        // TODO: for now path must be absolute
        const {parts, name} = parsePath(absolute_path);
        // TODO: refactor this when adding relative paths support for mount
        const rootDir = await this.getRootDirectory();
        const padre = await rootDir.get_entry(parts.join("/"), FileOrDir.Directory);
        try {
            await padre.entry._handle.getDirectoryHandle(name);
        } catch {
            return constants.WASI_ENOENT;
        }
        this.mounts.push({parts, name, handle: mounted_directory, parent: padre.entry});
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

    async resolveAbsolute(path: string): Promise<{err: number, name: string, dir_handle: FileSystemDirectoryHandle}> {
	    path = realpath(path, {HOME: "/home/ant"});
	    console.log(`Resolving absolute path '${path}'`);
	    if ((path == "/") || (path == "/.")) return {err: constants.WASI_ESUCCESS, name: ".", dir_handle: await navigator.storage.getDirectory()};
        const {parts, name} = parsePath(path);
	    let dir_handle = await navigator.storage.getDirectory();

	    try {
            for (const part of parts) {
                dir_handle = await this.getDirectoryHandle(dir_handle, part);
            }
	        return {err: constants.WASI_ESUCCESS, name, dir_handle};
	    } catch (err) {
            if (err.name === "NotFoundError") {
                return {err: constants.WASI_ENOENT, name: null, dir_handle: null};
            } else if (err.name === "TypeMismatchError") {
                return {err: constants.WASI_EEXIST, name: null, dir_handle: null};
            } else if (err.name === "TypeError") {
		        return {err: constants.WASI_EEXIST, name: null, dir_handle: null};
		    } else {
                throw err;
            }
        }
    }

    async resolve(dir_handle: FileSystemDirectoryHandle, path: string): Promise<{err: number, name: string, dir_handle: FileSystemDirectoryHandle}> {
	    if (path.includes("\\")) return { err: constants.WASI_EEXIST, name: null, dir_handle: null };

        const root = await navigator.storage.getDirectory();
	    let mypath = await root.resolve(dir_handle);
	    if (mypath == null) {
		    for (const mount of this.mounts) {
			    let realpath = "/" + mount.parts.join("/");
			    if (mount.handle == dir_handle) {
				    // TODO
                    mypath = await root.resolve(mount.parent._handle)
                    mypath.push(mount.name); // TODO: which name to use mount point or local?
                    break;
			    }

                // FIXME: something's not right here
                console.log("!!! check Filesystem.resolve");
			    // let dr = await mount.handle.resolve(dir_handle);
			    // if (dr != null) return {err: constants.WASI_ESUCCESS, name: mount.name, dir_handle: dr};
		    }
            if (mypath == null) {
                return {err: constants.WASI_EEXIST, name: null, dir_handle: null};
            }
	    }

	    let pth = "/" + mypath.join("/") + "/" + path;
	    pth = pth.replace("//", "/");
	    return this.resolveAbsolute(pth);
    }

    async entries(dir_handle: FileSystemDirectoryHandle): Promise<(File | Directory)[]>  {
        const root = await navigator.storage.getDirectory();
        const components = await root.resolve(dir_handle);

        const a = [];

        const reversed_mounts = [].concat(this.mounts).reverse();
        for (const {parts,  name, handle} of reversed_mounts) {
            if (arraysEqual(parts, components)) {
                switch(handle.kind) {
                    case "file": {
                        a.push(new File(name, handle, this));
                        break;
                    }
                    case "directory": {
                        a.push(new Directory(name, handle, this));
                        break;
                    }
                }
            }
        }

        for await (const [name, handle] of dir_handle.entries()) {
            // mounted direcotries hide directories they are mounted to
            let already_exists = false;
            for (const entry of a) {
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
                    a.push(new File(name, handle, this));
                    break;
                }
                case "directory": {
                    a.push(new Directory(name, handle, this));
                    break;
                }
            }
        }
        return a;
    }
}

export class Stdin {

}

abstract class Entry {
    public readonly file_type: number;
    public readonly path: string;
    protected readonly _handle: FileSystemDirectoryHandle | FileSystemFileHandle;
    protected readonly _filesystem: Filesystem;

    constructor(path: string, handle: FileSystemDirectoryHandle | FileSystemFileHandle, filesystem: Filesystem) {
        this.path = path;
        this._handle = handle;
        this._filesystem = filesystem;
    }

    abstract size(): Promise<number>;

    abstract lastModified(): Promise<number>;

    // TODO: fill dummy values with something meaningful
    async stat() {
        console.log(`Entry.stat() -- Entry -- mostly dummy. path = ${this.path} file_type = ${this.file_type}`);
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
        console.log('OpenDirectory.entries()');
        return await this._filesystem.entries(this._handle);
    }

    async lastModified(): Promise<number> {
        return 0;
        // // TODO: this is very slow for massive local directories
        // const entries = await this.entries();
        // const dates = await Promise.all(entries.map(entry => entry.lastModified()));
        // return Math.max(...dates);
    }

    open() {
        return new OpenDirectory(this.path, this._handle, this._filesystem);
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
        console.log(`OpenDirectory.get_entry(${path}, mode=${mode}, ${oflags})`);
    
        let {err, name, dir_handle} = await this._filesystem.resolve(this._handle, path);

        if (err !== constants.WASI_ESUCCESS) {
            return {err, entry: null};
        }    

	    if (name == ".") {
            let entry = new Directory(dir_handle.name, dir_handle, this._filesystem);
            return {err: constants.WASI_ESUCCESS, entry};
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
                    return {err: constants.WASI_ESUCCESS, handle: await this._filesystem.getFileHandle(dir_handle, name, {create})};
                } catch (err) {
                    if (err.name === 'TypeMismatchError' || err.name == 'TypeError') {
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
                return {err: constants.WASI_ESUCCESS, handle: await this._filesystem.getDirectoryHandle(dir_handle, name, {create})};
            } catch (err) {
		    console.log(`we got an error! (${err.name})`);
                if (err.name === 'TypeMismatchError') {
                    return {err: constants.WASI_ENOTDIR, handle: null};                              
                } else if (err.name === 'NotFoundError') {
                    return {err: constants.WASI_ENOENT, handle: null};
                } else if (err.name === "TypeError") {
		    return {err: constants.WASI_EEXIST, handle: null};
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
            await writable.write({type: "truncate", size: 0});
            await writable.close();
        }

        let entry;
        if (handle.kind == "file") {
            entry = new File(name, handle, this._filesystem);
        } else {
            entry = new Directory(name, handle, this._filesystem);
        }

        return {err: constants.WASI_ESUCCESS, entry};
    }

}

export class OpenDirectory extends Directory {
    public readonly file_type: number = constants.WASI_PREOPENTYPE_DIR;

    async delete_entry(path: string, options): Promise<{err: number}> {
        const {err, name, dir_handle} = await this._filesystem.resolve(this._handle, path);
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
        console.log(`OpenFile.read(${this.path} ${len})`);
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
	console.log(`OpenFile.write(${this.path} len=${buffer.byteLength}, position ${this._file_pos})`);
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
