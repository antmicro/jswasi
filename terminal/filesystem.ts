import {WASI_FILETYPE_REGULAR_FILE} from "./constants";

class OpenDirectory {
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

class OpenFile {
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