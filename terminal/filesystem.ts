import * as constants from "./constants.js";

export class OpenDirectory {
    public file_type: number = constants.WASI_PREOPENTYPE_DIR;
    public path: string;
    private handle: FileSystemDirectoryHandle;

    constructor(path: string, handle: FileSystemDirectoryHandle) {
        this.path = path;
        this.handle = handle;
    }

//     async open_entry(path: string, create: boolean) {
//         let handle = this.handle;
//         // for now we assume the path is valid and doesn't contain special characters
//         // (".", "..", "~"
//         for (let component of path.split("/") {
// 
//         }
// 
//         return
//     }

    async entries(): Promise<Record<string, FileSystemFileHandle | FileSystemDirectoryHandle>>  {
        const o = {};
        for await (const [name, handle] of this.entries()) {
            o[name] = handle;
        }
        return o;
    }



    async get_entry_for_path(path): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
        console.log(`OpenDirectory.get_entry_for_path()`);
        let entry = this.handle;
        for (let component of path.split("/")) {
            if (component == "") break;
            let found = false;
            if (entry == null) return null;
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

        const name = path.split("/").slice(-1);
        return new OpenFile(name, entry);
    }

    async create_entry_for_path(path) {
        console.log(`OpenDirectory.create_entry_for_path()`);
        let entry = this.handle;
        if (entry == null) return null;
        let components = path.split("/").filter((component) => component != "/");
        for (let i = 0; i < components.length; i++) {
            let component = components[i];
            let found = false;
            for await (const [name, handle] of entry.entries()) {
                console.log({name, handle});
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
                    entry = await entry.getDirectoryHandle(component, {create: true});
                }
            }
        }
        return new OpenFile(components.split(-1), entry);
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
        console.log(`OpenFile.read(${len})`);
        if (this.file_pos < await this.size()) {
            let file = await this.handle.getFile();
            let slice = await file.slice(this.file_pos, this.file_pos + len).arrayBuffer();
            this.file_pos += slice.byteLength;
            console.log(slice);
            return [slice, 0];
        } else {
            return [new Uint8Array, 0];
        }
    }

    async write(buffer) {
        console.log(`OpenFile.write(${buffer})`);
        const w = await this.handle.createWritable();
        await w.write({type: "write", position: this.file_pos, data: buffer});
        await w.close();
        this.file_pos += buffer.length;
        return 0;
    }

    async stat() {
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

