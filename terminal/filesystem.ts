import {WASI_ESUCCESS, WASI_FILETYPE_DIRECTORY, WASI_FILETYPE_REGULAR_FILE} from "./constants.js";

export class File {
    file_type = WASI_FILETYPE_REGULAR_FILE;
    data;

    constructor(data) {
        this.data = new Uint8Array(data);
    }

    get size() {
        return this.data.byteLength;
    }

    open() {
        return new PreopenFile(this);
    }

    stat() {
        return {
             dev: 0n,
             ino: 0n,
             file_type: this.file_type,
             nlink: 0n,
             size: BigInt(this.size),
             atim: 0n,
             mtim: 0n,
             ctim: 0n,
         };
     }
 
     truncate() {
         this.data = new Uint8Array([]);
     }
}

export class PreopenFile {
    file_type = WASI_FILETYPE_REGULAR_FILE;
    file;
    file_pos = 0;

    constructor(file) {
        this.file = file;
    }

    get size() {
        return this.file.size;
    }

    read(len): [Uint8Array, number] {
        if (this.file_pos < this.file.data.byteLength) {
            let slice = this.file.data.slice(this.file_pos, this.file_pos + len);
            this.file_pos += slice.length;
            console.log("PreopenFile.read() returning: " + new TextDecoder().decode(slice));
            return [slice, 0];
        } else {
            return [new Uint8Array, 0];
        }
    }

    write(buffer) {
        // File.data is and Uint8Array, we need to resize it if necessary
        if (this.file_pos + buffer.length > this.size) {
            let old = this.file.data;
            this.file.data = new Uint8Array(this.file_pos + buffer.length);
            this.file.data.set(old);
        }
        this.file.data.set(
            new TextEncoder().encode(buffer), this.file_pos
        );
        this.file_pos += buffer.length;
        return 0;
    }

    stat() {
        return this.file.stat();
    }
}

export class Directory {
    file_type = WASI_FILETYPE_DIRECTORY;
    directory;

    constructor(contents) {
        this.directory = contents;
    }

    open(name) {
        return new PreopenDirectory(name, this.directory);
    }

    get_entry_for_path(path) {
        let entry = this;
        for (let component of path.split("/")) {
            if (component == "") break;
            if (entry.directory[component] != undefined) {
                entry = entry.directory[component];
            } else {
                return null;
            }
        }
        return entry;
    }

    create_entry_for_path(path) {
        let entry = this;
        let components = path.split("/").filter((component) => component != "/");
        for (let i = 0; i < components.length; i++) {
            let component = components[i];
            if (entry.directory[component] != undefined) {
                entry = entry.directory[component];
            } else {
                if (i == components.length - 1) {
                    entry.directory[component] = new File(new ArrayBuffer(0));
                } else {
                    entry.directory[component] = new Directory({});
                }
                entry = entry.directory[component];
            }
        }
        return entry;
    }
}

export class PreopenDirectory extends Directory {
    prestat_name;

    constructor(name, contents) {
        super(contents);
        this.prestat_name = new TextEncoder().encode(name);
    }
}

import {WASI_FILETYPE_REGULAR_FILE} from "./constants";

export class OpenDirectory {
    public path: string;
    private handle: FileSystemDirectoryHandle;

    constructor(path: string, handle: FileSystemDirectoryHandle) {
        this.path = path;
        this.handle = handle;
    }

    // get all entries in a directory, for eg. in fd_readdir call
    entries(): Iterable<FileSystemHandle> {

    }

    resolve(path: string): FileSystemHandle {

    }

    get_entry_for_path(path) {
        let entry = this;
        for (let component of path.split("/")) {
            if (component == "") break;
            if (entry.directory[component] != undefined) {
                entry = entry.directory[component];
            } else {
                return null;
            }
        }
        return entry;
    }

    create_entry_for_path(path) {
        let entry = this;
        let components = path.split("/").filter((component) => component != "/");
        for (let i = 0; i < components.length; i++) {
            let component = components[i];
            if (entry.directory[component] != undefined) {
                entry = entry.directory[component];
            } else {
                if (i == components.length - 1) {
                    entry.directory[component] = new File(new ArrayBuffer(0));
                } else {
                    entry.directory[component] = new Directory({});
                }
                entry = entry.directory[component];
            }
        }
        return entry;
    }

    open_entry(path: string) {

    }

    delete_entry(path: string) {

    }
}

export class OpenFile {
    public path: string;
    public handle: FileSystemFileHandle;
    private file_pos: number = 0;

    constructor(path: string, handle: FileSystemFileHandle) {
        this.path = path;
        this.handle = handle;
    }

    // return file size in bytes
    async size() {
        let file = await this.handle.getFile();
        return file.size;
    }

    async read(len) {
        // worker_console_log(`${typeof this.file_pos}, ${typeof len}`)
        if (this.file_pos < await this.size()) {
            let file = await this.handle.getFile();
            let slice = await file.slice(this.file_pos, this.file_pos + len).arrayBuffer();
            this.file_pos += slice.length;
            return [slice, 0];
        } else {
            return [[], 0];
        }
    }

    async write(buffer) {
        const w = await this.handle.createWritable();
        await w.write({type: "write", position: this.file_pos, data: buffer})
        this.file_pos += buffer.length;
        return 0;
    }

    async stat() {
        return {
            dev: 0n,
            ino: 0n,
            file_type: WASI_FILETYPE_REGULAR_FILE,
            nlink: 0n,
            size: BigInt(await this.size()),
            atim: 0n,
            mtim: 0n,
            ctim: 0n,
        };
    }

    async seek(position: number) {
        const w = await this.handle.createWritable();
        await w.write({type: "seek", position})
        this.file_pos = position;
        return 0;
    }

    async truncate() {
        const w = await this.handle.createWritable();
        await w.write({type: "truncate", size: 0})
        this.file_pos = 0;
        return 0;
    }
}

export type FileDescriptorTable = Record<number, OpenFile | OpenDirectory>;

