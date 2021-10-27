import * as constants from "./constants.js";
import { FileOrDir, OpenFlags } from "./filesystem.js";

export class Directory {
  public readonly file_type: number = constants.WASI_FILETYPE_DIRECTORY;

  public readonly path: string;

  protected readonly _handle: FileSystemDirectoryHandle;

  constructor(path: string, handle: FileSystemDirectoryHandle) {
    this.path = path;
    this._handle = handle;
  }

  // TODO: fill dummy values with something meaningful
  async stat() {
    console.log("Directory.stat()");
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

export class OpenDirectory extends Directory {
  public readonly file_type: number = constants.WASI_PREOPENTYPE_DIR;

  private async _resolve(path: string): Promise<{
    err: number;
    name: string;
    dir_handle: FileSystemDirectoryHandle;
  }> {
    const parts = [];

    for (const component of path.split("/")) {
      if (component == "..") {
        parts.pop();
      } else if (component !== ".") {
        parts.push(component);
      }
    }

    const name = parts.pop();
    let dir_handle = this._handle;
    if (dir_handle == null) {
      return { err: constants.WASI_ENOENT, name: null, dir_handle: null };
    }
    for (const part of parts) {
      try {
        dir_handle = await dir_handle.getDirectoryHandle(part);
      } catch (err) {
        console.log(err);
        if (err.name === "NotFoundError") {
          return { err: constants.WASI_ENOENT, name: null, dir_handle: null };
        }
        if (err.name === "TypeMismatchError") {
          return { err: constants.WASI_EEXIST, name: null, dir_handle: null };
        }
        throw err;
      }
    }

    return { err: constants.WASI_ESUCCESS, name, dir_handle };
  }

  async entries(): Promise<(File | Directory)[]> {
    const a = [];
    for await (const [name, handle] of this._handle.entries()) {
      switch (handle.kind) {
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

  // basically copied form RReverser's wasi-fs-access
  async get_entry(
    path: string,
    mode: FileOrDir,
    oflags: OpenFlags = 0
  ): Promise<{ err: number; entry: File | Directory }> {
    console.log(`OpenDirectory.get_entry(${path}, ${oflags})`);

    let { err, name, dir_handle } = await this._resolve(path);
    if (err !== constants.WASI_ESUCCESS) {
      return { err, entry: null };
    }

    if (name === undefined) {
      if (oflags & (OpenFlags.Create | OpenFlags.Exclusive)) {
        return { err: constants.WASI_EEXIST, entry: null };
      }
      if (oflags & OpenFlags.Truncate) {
        return { err: constants.WASI_EISDIR, entry: null };
      }
      return {
        err: constants.WASI_ESUCCESS,
        entry: new Directory(this.path, this._handle),
      };
    }

    if (oflags & OpenFlags.Directory) {
      mode = FileOrDir.Directory;
    }

    const openWithCreate = async (
      create: boolean
    ): Promise<{
      err: number;
      handle: FileSystemFileHandle | FileSystemDirectoryHandle;
    }> => {
      if (mode & FileOrDir.File) {
        try {
          return {
            err: constants.WASI_ESUCCESS,
            handle: await dir_handle.getFileHandle(name, { create }),
          };
        } catch (err) {
          if (err.name === "TypeMismatchError") {
            if (!(mode & FileOrDir.Directory)) {
              return { err: constants.WASI_EISDIR, handle: null };
            }
          } else if (err.name === "NotFoundError") {
            return { err: constants.WASI_ENOENT, handle: null };
          } else {
            throw err;
          }
        }
      }
      try {
        return {
          err: constants.WASI_ESUCCESS,
          handle: await dir_handle.getDirectoryHandle(name, { create }),
        };
      } catch (err) {
        if (err.name === "TypeMismatchError") {
          return { err: constants.WASI_ENOTDIR, handle: null };
        }
        throw err;
      }
    };

    let handle;
    if (oflags & OpenFlags.Create) {
      if (oflags & OpenFlags.Exclusive) {
        if ((await openWithCreate(false)).err === constants.WASI_ESUCCESS) {
          return { err: constants.WASI_EEXIST, entry: null };
        }
      }
      ({ err, handle } = await openWithCreate(true));
    } else {
      ({ err, handle } = await openWithCreate(false));
    }

    if (err !== constants.WASI_ESUCCESS) {
      return { err, entry: null };
    }

    if (oflags & OpenFlags.Truncate) {
      if (handle.kind === "directory") {
        return { err: constants.WASI_EISDIR, entry: null };
      }
      const writable = await handle.createWritable();
      writable.write({ type: "truncate", size: 0 });
      writable.close();
    }

    let entry;
    if (handle.kind == "file") {
      entry = new File(name, handle);
    } else {
      entry = new Directory(name, handle);
    }

    return { err: constants.WASI_ESUCCESS, entry };
  }

  async delete_entry(path: string, options): Promise<{ err: number }> {
    const { err, name, dir_handle } = await this._resolve(path);
    await dir_handle.removeEntry(name, options);
    return { err: constants.WASI_ESUCCESS };
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
    console.log("File.stat()");
    const file = await this._handle.getFile();
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
    const file = await this._handle.getFile();
    return file.size;
  }

  async read(len: number): Promise<[Uint8Array, number]> {
    console.log(`OpenFile.read(${len})`);
    if (this._file_pos < (await this.size())) {
      const file = await this._handle.getFile();
      const slice = new Uint8Array(
        await file.slice(this._file_pos, this._file_pos + len).arrayBuffer()
      );
      this._file_pos += slice.byteLength;
      return [slice, 0];
    }
    return [new Uint8Array(0), 0];
  }

  // TODO: each write creates new writable, store it on creation
  async write(buffer: string) {
    console.log(`OpenFile.write(${buffer})`);
    const w = await this._handle.createWritable();
    await w.write({ type: "write", position: this._file_pos, data: buffer });
    await w.close();
    this._file_pos += buffer.length;
    return 0;
  }

  // TODO: fill dummy values with something meaningful
  async stat() {
    console.log("OpenFile.stat()");
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
        this._file_pos = (await this.size()) + offset;
      }
    }
    // TODO: this only makes sense if we store WritableFileStream on class
    // await w.write({type: "seek", position: offset});
  }

  async truncate() {
    console.log("OpenFile.truncate()");
    const w = await this._handle.createWritable();
    await w.write({ type: "truncate", size: 0 });
    this._file_pos = 0;
  }
}
