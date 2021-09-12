import * as constants from "./constants.js";
import {realpath, arraysEqual} from "./utils.js";
import {FileOrDir, OpenFlags, parsePath} from "./filesystem.js";


export class Filesystem {
    mounts: {parts: string[], name: string, handle: FileSystemDirectoryHandle}[] = [];

    rootDir: Directory;

    async getRootDirectory(): Promise<Directory> {
        const root = await navigator.storage.getDirectory();
	this.rootDir = new Directory("", root, this);
        return this.rootDir;
    }

    async addMount(absolute_path: string, mount_directory: FileSystemDirectoryHandle) {
        // TODO: for now path must be absolute
        const {parts, name} = parsePath(absolute_path);
	console.log(`Adding path ${absolute_path} --> parsed to ${name}`);
	console.log("Parts: ", parts.join("/"));
        this.mounts.push({parts, name, handle: mount_directory});
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
	path = realpath(path);
	console.log(`Resolving absolute path '${path}'`);
	if ((path == "/") || (path == "/.")) return {err: constants.WASI_ESUCCESS, name: ".", dir_handle: await navigator.storage.getDirectory()};
        const {parts, name} = parsePath(path);
	let dir_handle = await navigator.storage.getDirectory();

	try {
            for (const part of parts) {
                    dir_handle = await dir_handle.getDirectoryHandle(part);
            }
  	    //dir_handle = await dir_handle.getDirectoryHandle(name);
	    return {err: constants.WASI_ESUCCESS, name, dir_handle};
	} catch (err) {
	    return {err: constants.WASI_EEXIST, name: null, dir_handle: null};
	}
    }

    async resolve(dir_handle: FileSystemDirectoryHandle, path: string): Promise<{err: number, name: string, dir_handle: FileSystemDirectoryHandle}> {
	if (path.includes("\\")) return { err: constants.WASI_EEXIST, name: null, dir_handle: null };



/////////////////
            const root = await navigator.storage.getDirectory();
	    let mypath = await root.resolve(dir_handle);
	    if (mypath == null) {
		    console.log("TODO: This is probably a mounted dir -- not part of the root!");
		    console.log("dirhandle.name = ",dir_handle.name);
		    for (const a of this.mounts) {
			    console.log("Mount: ");
			    let realpath = "/" + a.parts.join("/");
			    console.log(a.name);
			    console.log("a.handle.name = ",a.handle.name);
			    if (a.handle == dir_handle) {
				    // TODO
				    console.log("THIS IS THE SAME HANDLE");
				   return {err: constants.WASI_ESUCCESS, name: ".", dir_handle: dir_handle};
			    }

			    let dr = await a.handle.resolve(dir_handle);
			    console.log("found (parent) dr.name = ",dr.name);
			    if (dr != null) return {err: constants.WASI_ESUCCESS, name: a.name, dir_handle: dr};
		    }
                    return {err: constants.WASI_EEXIST, name: null, dir_handle: null};
	    }

		    for (const a of this.mounts) {
			    console.log(a.parts.join("/"));
			    console.log(a.name);
		    }

	    let pth = "/" + mypath.join("/") + "/" + path;
	    pth = pth.replace("//", "/");
	    return this.resolveAbsolute(pth);
//////////////

	const {parts, name} = parsePath(path);
	for (const part of parts) {
            try {
                dir_handle = await this.getDirectoryHandle(dir_handle, part);
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
        return {err: constants.WASI_ESUCCESS, name, dir_handle};
    }

    async getDirectoryHandle(handle: FileSystemDirectoryHandle, name: string, options: {create: boolean}={create: false}): Promise<FileSystemDirectoryHandle> {
	    console.log("We are in getDirectoryHandle! handle.name=", handle.name, " name = ",name);
	const root = await navigator.storage.getDirectory();
	    console.log("got root!", root);
	let components = null;
	try {
            components = await root.resolve(handle);
	} catch {
	    console.log("There was an error in root.resolve...");
	}
	console.log("got components! components = ", components);

        // if there are many mounts for the same path, we want to return the latest
        const reversed_mounts = [].concat(this.mounts).reverse();
	console.log("mounts count = ", reversed_mounts.length);
        for (const {parts,  name: child_name, handle: child_handle} of reversed_mounts) {
	    console.log("We are in itaration!");
            if (arraysEqual(parts, components) && child_name === name) {
		console.log("Returning a mount handle ",child_handle);
                return child_handle;
            }
        }
	console.log("going to return handle.getDirectoryHandle...");
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
    const root = await navigator.storage.getDirectory();
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
        const entries = await this.entries();
        const dates = await Promise.all(entries.map(entry => entry.lastModified()));
        return Math.max(...dates);
    }

    open() {
        return new OpenDirectory(this.path, this._handle, this._filesystem);
    }
}

export class OpenDirectory extends Directory {
    public readonly file_type: number = constants.WASI_PREOPENTYPE_DIR;

    // basically copied form RReverser's wasi-fs-access
    async get_entry(path: string, mode: FileOrDir, oflags: OpenFlags = 0): Promise<{err: number, entry: File | Directory}> {
        console.log(`OpenDirectory.get_entry(${path}, mode=${mode}, ${oflags})`);
    
        let {err, name, dir_handle} = await this._filesystem.resolve(this._handle, path);

	console.log("Got an entry with name '",name,"'");

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

	console.log("We are here now");

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
