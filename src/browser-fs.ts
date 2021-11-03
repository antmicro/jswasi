import * as constants from "./constants.js";
import { parsePath, arraysEqual } from "./utils.js";
import { OpenedFd } from "./browser-devices.js";

export const enum FileOrDir {
  File = 1,
  Directory = 2,
  Any = 3,
}

export const enum OpenFlags {
  Create = 1, // constants.WASI_O_CREAT,
  Directory = 2, // constants.WASI_O_DIRECTORY,
  Exclusive = 4, // constants.WASI_O_EXCL,
  Truncate = 8, // constants.WASI_O_TRUNC,
}

export class Filesystem {
  DEBUG: boolean = false;

  mounts: { parts: string[]; name: string; dir: Directory }[] = [];

  public readonly rootDir: Directory;

  constructor(public rootHandle: FileSystemDirectoryHandle) {
    this.rootDir = new Directory("", rootHandle, null, this);
  }

  async getDirectory(
    dir: Directory,
    name: string,
    options: { create: boolean } = { create: false }
  ): Promise<Directory> {
    // TODO: revisit this hack
    if (
      dir.path === "" &&
      (name === "." || name === ".." || name === "" || name === "/")
    )
      return this.rootDir;
    if (name === ".") {
      return dir;
    }
    if (name === "..") {
      return dir.parent;
    }

    const root = await navigator.storage.getDirectory();
    let components = null;
    try {
      components = await root.resolve(dir._handle);
    } catch {
      if (this.DEBUG) console.log("There was an error in root.resolve...");
    }

    // if there are many mounts for the same path, we want to return the latest
    const reversed_mounts = [].concat(this.mounts).reverse();
    for (const { parts, name: child_name, dir: child_dir } of reversed_mounts) {
      if (arraysEqual(parts, components) && child_name === name) {
        return child_dir;
      }
    }
    const handle = await dir._handle.getDirectoryHandle(name, options);
    return new Directory(name, handle, dir, this);
  }

  async getFile(
    dir: Directory,
    name: string,
    options: { create: boolean } = { create: false }
  ): Promise<File> {
    const handle = await dir._handle.getFileHandle(name, options);
    return new File(name, handle, dir, this);
  }

  async pathExists(
    absolute_path: string,
    mode: FileOrDir = FileOrDir.Any
  ): Promise<boolean> {
    const { err } = await this.rootDir.getEntry(
      absolute_path,
      FileOrDir.Directory,
      0
    );
    return err === constants.WASI_ESUCCESS;
  }

  async addMount(
    absolute_path: string,
    mounted_handle: FileSystemDirectoryHandle
  ): Promise<number> {
    const { parts, name } = parsePath(absolute_path);
    const parent = await this.rootDir.getEntry(
      parts.join("/"),
      FileOrDir.Directory
    );
    const dir = new Directory(name, mounted_handle, parent.entry, this);
    this.mounts.push({ parts, name, dir });
    return constants.WASI_ESUCCESS;
  }

  isMounted(absolute_path: string): boolean {
    const { parts: del_parts, name: del_name } = parsePath(absolute_path);
    for (let i = 0; i < this.mounts.length; i++) {
      const { parts, name } = this.mounts[i];
      if (arraysEqual(parts, del_parts) && name === del_name) {
        return true;
      }
    }
    return false;
  }

  removeMount(absolute_path: string) {
    const { parts: del_parts, name: del_name } = parsePath(absolute_path);
    for (let i = 0; i < this.mounts.length; i++) {
      const { parts, name } = this.mounts[i];
      if (arraysEqual(parts, del_parts) && name === del_name) {
        this.mounts.splice(i, 1);
        return;
      }
    }
  }

  async resolveAbsolute(
    path: string
  ): Promise<{ err: number; name: string; dir: Directory }> {
    if (this.DEBUG) console.log(`resolveAbsolute(${path})`);

    const { parts, name } = parsePath(path);
    let dir = this.rootDir;

    try {
      for (const part of parts) {
        dir = await this.getDirectory(dir, part);
      }
      if (this.DEBUG) console.log(`resolveAbsolute(${path}) = ${name}, ${dir}`);
      return { err: constants.WASI_ESUCCESS, name, dir };
    } catch (err) {
      if (err.name === "NotFoundError") {
        return { err: constants.WASI_ENOENT, name: null, dir: null };
      }
      if (err.name === "TypeMismatchError" || err.name == "TypeError") {
        return { err: constants.WASI_ENOTDIR, name: null, dir: null };
      }
      throw err;
    }
  }

  async getParent(
    dir: Directory,
    path: string
  ): Promise<{ err: number; name: string; parent: Directory }> {
    if (this.DEBUG)
      console.log(
        `getParent(dir._handle.name="${dir._handle.name}", path="${path}")`
      );

    if (path.includes("\\"))
      return { err: constants.WASI_EINVAL, name: null, parent: null };
    if (
      dir.path === "" &&
      (path === "." || path === ".." || path === "" || path === "/")
    )
      return { err: constants.WASI_ESUCCESS, name: "", parent: dir };
    if (path.startsWith("/")) dir = this.rootDir;

    const { parts, name } = parsePath(path);

    try {
      for (const part of parts) {
        dir = await this.getDirectory(dir, part);
      }
    } catch (err) {
      if (err.name === "NotFoundError") {
        return { err: constants.WASI_ENOENT, name: null, parent: null };
      }
      if (err.name === "TypeMismatchError" || err.name == "TypeError") {
        return { err: constants.WASI_ENOTDIR, name: null, parent: null };
      }
      throw err;
    }

    if (this.DEBUG)
      console.log(`getParent resolved as = {"${name}", "${dir.path}"}`);
    return { err: constants.WASI_ESUCCESS, name, parent: dir };
  }

  async entries(dir: Directory): Promise<(File | Directory)[]> {
    const root = await navigator.storage.getDirectory();
    const components = await root.resolve(dir._handle);

    const entries: (File | Directory)[] = [];

    const reversed_mounts = [].concat(this.mounts).reverse();
    for (const { parts, name, dir } of reversed_mounts) {
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

      switch (handle.kind) {
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

    return entries;
  }
}

abstract class Entry {
  public readonly file_type: number;

  public path: string;

  public parent: Directory;

  protected readonly _handle: FileSystemDirectoryHandle | FileSystemFileHandle;

  protected readonly _filesystem: Filesystem;

  constructor(
    path: string,
    handle: FileSystemDirectoryHandle | FileSystemFileHandle,
    parent: Directory,
    filesystem: Filesystem
  ) {
    if (filesystem.DEBUG)
      console.log(`new Entry(path="${path}", parent.path="${parent?.path}")`);
    this.path = path;
    this._handle = handle;
    this.parent = parent;
    this._filesystem = filesystem;
  }

  abstract size(): Promise<number>;

  abstract lastModified(): Promise<number>;

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    file_type: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
    if (this._filesystem.DEBUG)
      console.log(`Entry(this.path="${this.path}").stat()`);
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

  declare readonly _handle: FileSystemDirectoryHandle;

  async size(): Promise<number> {
    return 0;
  }

  async entries(): Promise<(File | Directory)[]> {
    if (this._filesystem.DEBUG)
      console.log(`Directory(this.path="${this.path}").entries()`);
    return await this._filesystem.entries(this);
  }

  async lastModified(): Promise<number> {
    return 0;
    // // TODO: this is very slow for massive local directories
    // const entries = await this.entries();
    // const dates = await Promise.all(entries.map(entry => entry.lastModified()));
    // return Math.max(...dates);
  }

  open(): OpenDirectory {
    return new OpenDirectory(
      this.path,
      this._handle,
      this.parent,
      this._filesystem
    );
  }

  // basically copied form RReverser's wasi-fs-access
  getEntry(
    path: string,
    mode: FileOrDir.File,
    openFlags?: OpenFlags
  ): Promise<{ err: number; entry: File }>;

  getEntry(
    path: string,
    mode: FileOrDir.Directory,
    openFlags?: OpenFlags
  ): Promise<{ err: number; entry: Directory }>;

  getEntry(
    path: string,
    mode: FileOrDir,
    openFlags?: OpenFlags
  ): Promise<{ err: number; entry: File | Directory }>;

  async getEntry(
    path: string,
    mode: FileOrDir,
    oflags: OpenFlags = 0
  ): Promise<{ err: number; entry: File | Directory }> {
    if (this._filesystem.DEBUG)
      console.log(
        `Directory(this.path="${this.path}").getEntry(path="${path}", mode=${mode}, oflags=${oflags})`
      );

    let { err, name, parent } = await this._filesystem.getParent(this, path);

    if (err !== constants.WASI_ESUCCESS) {
      return { err, entry: null };
    }

    if (name === "." || name === "..") {
      if (oflags & (OpenFlags.Create | OpenFlags.Exclusive)) {
        return { err: constants.WASI_EEXIST, entry: null };
      }
      if (oflags & OpenFlags.Truncate) {
        return { err: constants.WASI_EISDIR, entry: null };
      }

      if (name === ".") {
        const entry = new Directory(
          parent.path,
          parent._handle,
          parent.parent,
          this._filesystem
        );
        return { err: constants.WASI_ESUCCESS, entry };
      }
      if (name === "..") {
        const entry = new Directory(
          parent.parent.path,
          parent.parent._handle,
          parent.parent.parent,
          this._filesystem
        );
        return { err: constants.WASI_ESUCCESS, entry };
      }
    }

    if (oflags & OpenFlags.Directory) {
      mode = FileOrDir.Directory;
    }

    const openWithCreate = async (
      create: boolean
    ): Promise<{ err: number; entry: File | Directory }> => {
      if (mode & FileOrDir.File) {
        try {
          const entry = await this._filesystem.getFile(parent, name, {
            create,
          });
          return { err: constants.WASI_ESUCCESS, entry };
        } catch (err) {
          if (err.name === "TypeMismatchError" || err.name == "TypeError") {
            if (!(mode & FileOrDir.Directory)) {
              return { err: constants.WASI_EISDIR, entry: null };
            }
          } else if (err.name === "NotFoundError") {
            return { err: constants.WASI_ENOENT, entry: null };
          } else {
            throw err;
          }
        }
      }
      try {
        const entry = await this._filesystem.getDirectory(parent, name, {
          create,
        });
        return { err: constants.WASI_ESUCCESS, entry };
      } catch (err) {
        // console.log(`we got an error '${err.name}' during getting dir '${name}' in parent '${parent?.path}'`);
        if (err.name === "TypeMismatchError" || err.name === "TypeError") {
          return { err: constants.WASI_ENOTDIR, entry: null };
        }
        if (err.name === "NotFoundError") {
          return { err: constants.WASI_ENOENT, entry: null };
        }
        throw err;
      }
    };

    let entry: File | Directory;
    if (oflags & OpenFlags.Create) {
      if (oflags & OpenFlags.Exclusive) {
        if ((await openWithCreate(false)).err === constants.WASI_ESUCCESS) {
          return { err: constants.WASI_EEXIST, entry: null };
        }
      }
      ({ err, entry } = await openWithCreate(true));
    } else {
      ({ err, entry } = await openWithCreate(false));
    }

    if (err !== constants.WASI_ESUCCESS) {
      return { err, entry: null };
    }

    if (oflags & OpenFlags.Truncate) {
      if (entry._handle.kind === "directory") {
        return { err: constants.WASI_EISDIR, entry: null };
      }
      const writable = await entry._handle.createWritable();
      await writable.write({ type: "truncate", size: 0 });
      await writable.close();
    }

    return { err, entry };
  }
}

export class OpenDirectory extends Directory {
  public readonly file_type: number = constants.WASI_PREOPENTYPE_DIR;

  async deleteEntry(
    path: string,
    options = { recursive: false }
  ): Promise<{ err: number }> {
    console.log(`OpenDirectory(${this.path}).deleteEntry(${path}, ${options})`);
    const { err, name, parent } = await this._filesystem.getParent(this, path);
    await parent._handle.removeEntry(name, options);
    return { err: constants.WASI_ESUCCESS };
  }
}

export class File extends Entry {
  public readonly file_type: number = constants.WASI_FILETYPE_REGULAR_FILE;

  declare readonly _handle: FileSystemFileHandle;

  async size(): Promise<number> {
    const file = await this._handle.getFile();
    return file.size;
  }

  async lastModified(): Promise<number> {
    const file = await this._handle.getFile();
    return file.lastModified;
  }

  // TODO: remove OpenedFd dependency, add wrapper for OpenedFdDirectory
  open(): OpenedFd {
    return new OpenedFd(
      new OpenFile(this.path, this._handle, this.parent, this._filesystem)
    );
  }
}

// Represents File opened for reading and writing
// it is backed by File System Access API through a FileSystemFileHandle handle
export class OpenFile extends File {
  public readonly file_type: number = constants.WASI_FILETYPE_REGULAR_FILE;

  private _file_pos: number = 0;

  private DEBUG: boolean = false;

  async read(len: number): Promise<[Uint8Array, number]> {
    if (this.DEBUG) console.log(`OpenFile(${this.path}).read(${len})`);
    const size = await this.size();
    if (this._file_pos < size) {
      const file = await this._handle.getFile();
      let data = await file
        .slice(this._file_pos, this._file_pos + len)
        .arrayBuffer();
      data = await data.slice(0);
      const slice = new Uint8Array(data);
      this._file_pos += slice.byteLength;
      return [slice, 0];
    }
    return [new Uint8Array(0), 0];
  }

  // TODO: each write creates new writable, store it on creation
  async write(buffer: Uint8Array): Promise<number> {
    if (this.DEBUG)
      console.log(
        `OpenFile(${this.path}).write(${this.path} len=${buffer.byteLength}, position ${this._file_pos})`
      );
    try {
      const w = await this._handle.createWritable({ keepExistingData: true });
      await w.write({ type: "write", position: this._file_pos, data: buffer });
      await w.close();
      this._file_pos += buffer.byteLength;
    } catch (err) {
      console.log(`Error during writing: ${err}`);
      return 1;
    }
    return 0;
  }

  async seek(offset: number, whence: number): Promise<number> {
    if (this.DEBUG)
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
        this._file_pos = (await this.size()) + offset;
        break;
      }
    }
    return this._file_pos;
    // TODO: this only makes sense if we store WritableFileStream on class
    // await w.write({type: "seek", position: offset});
  }

  async truncate(size: number = 0) {
    if (this.DEBUG) console.log(`OpenFile(${this.path}).truncate()`);
    const writable = await this._handle.createWritable();
    await writable.write({ type: "truncate", size: 0 });
    await writable.close();
    this._file_pos = 0;
  }
}
