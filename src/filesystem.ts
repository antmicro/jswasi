import * as constants from "./constants.js";
import { parsePath, arraysEqual } from "./utils.js";
import { OpenedFd } from "./devices.js";

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

  // TODO: parts could be a key, that would optimise the lookup
  mounts: { parts: string[]; name: string; dir: Directory }[] = [];

  // TODO: we don't need to keep the parsed path I think
  symlinks: {
    source: string;
    destination: string;
    parts: string[];
    name: string;
    to: Directory | File;
  }[] = [];

  public readonly rootDir: Directory;

  public readonly metaDir: Directory;

  constructor(
    rootHandle: FileSystemDirectoryHandle,
    metaHandle: FileSystemDirectoryHandle
  ) {
    this.rootDir = new Directory("", rootHandle, null, this);
    this.metaDir = new Directory("", metaHandle, null, this);
  }

  async loadSymlinks() {
    const { entry: symlinks } = await this.rootDir.getEntry(
      "/etc/symlinks.txt",
      FileOrDir.File,
      OpenFlags.Create
    );
    const file = await symlinks.handle.getFile();
    const content = await file.text();

    this.symlinks = (
      await Promise.all(
        Object.entries(JSON.parse(content)).map(
          async ([source, destination]: [string, string]) => {
            const { parts, name } = parsePath(source);
            const entry = await this.rootDir.getEntry(
              destination,
              FileOrDir.Any
            );
            if (entry.err === constants.WASI_ESUCCESS) {
              return { source, destination, parts, name, to: entry.entry };
            }
            // throw new Error(`Got symlink for non-existent file: ${destination}`);
            return null;
          }
        )
      )
    ).filter((symlink) => symlink !== null);
  }

  async addSymlink(to: File | Directory, source: string, destination: string) {
    const { parts, name } = parsePath(source);
    this.symlinks.push({ source, destination, parts, name, to });

    const { entry: symlinks } = await this.rootDir.getEntry(
      "/etc/symlinks.txt",
      FileOrDir.File
    );
    const data = JSON.stringify(
      Object.assign(
        {},
        ...this.symlinks.map(({ source: src, destination: dst }) => ({
          [src]: dst,
        }))
      )
    );
    const w = await symlinks.handle.createWritable();
    await w.write({
      type: "write",
      data,
    });
    await w.close();
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

    let components;
    try {
      components = await this.rootDir.handle.resolve(dir.handle);
    } catch {
      throw Error("There was an error in root.resolve...");
    }

    // if there are many mounts for the same path, we want to return the latest
    const reversedMounts = [].concat(this.mounts).reverse();
    for (const { parts, name: mountName, dir: mountDir } of reversedMounts) {
      if (arraysEqual(parts, components) && mountName === name) {
        return mountDir;
      }
    }

    // check if a symlink exists
    for (const { parts, name: symlinkName, to: symlinkDestination } of this
      .symlinks) {
      if (arraysEqual(parts, components) && symlinkName === name) {
        if (symlinkDestination instanceof Directory) {
          return symlinkDestination;
        }
        throw new TypeError("symlink doesn't point to a directory");
      }
    }

    const handle = await dir.handle.getDirectoryHandle(name, options);
    return new Directory(name, handle, dir, this);
  }

  async getFile(
    dir: Directory,
    name: string,
    options: { create: boolean } = { create: false }
  ): Promise<File> {
    let components;
    try {
      components = await this.rootDir.handle.resolve(dir.handle);
    } catch {
      throw Error("There was an error in root.resolve...");
    }
    // check if a symlink exists
    for (const { parts, name: symlinkName, to: symlinkDestination } of this
      .symlinks) {
      if (arraysEqual(parts, components) && symlinkName === name) {
        if (symlinkDestination instanceof File) {
          // check if symlink is valid
          // we only ever await once in the loop right before returning
          // eslint-disable-next-line no-await-in-loop
          await symlinkDestination.handle.getFile();
          return symlinkDestination;
        }
        throw new TypeError("symlink doesn't point to a file");
      }
    }

    const handle = await dir.handle.getFileHandle(name, options);
    return new File(name, handle, dir, this);
  }

  async pathExists(
    absolutePath: string,
    mode: FileOrDir = FileOrDir.Any
  ): Promise<boolean> {
    const { err } = await this.rootDir.getEntry(absolutePath, mode, 0);
    return err === constants.WASI_ESUCCESS;
  }

  async addMount(
    absolutePath: string,
    mountedHandle: FileSystemDirectoryHandle
  ): Promise<number> {
    const { parts, name } = parsePath(absolutePath);
    const parent = await this.rootDir.getEntry(
      parts.join("/"),
      FileOrDir.Directory
    );
    const dir = new Directory(name, mountedHandle, parent.entry, this);
    this.mounts.push({ parts, name, dir });
    return constants.WASI_ESUCCESS;
  }

  isMounted(absolutePath: string): boolean {
    const { parts: delParts, name: delName } = parsePath(absolutePath);
    for (let i = 0; i < this.mounts.length; i += 1) {
      const { parts, name } = this.mounts[i];
      if (arraysEqual(parts, delParts) && name === delName) {
        return true;
      }
    }
    return false;
  }

  removeMount(absolutePath: string) {
    const { parts: delParts, name: delName } = parsePath(absolutePath);
    for (let i = 0; i < this.mounts.length; i += 1) {
      const { parts, name } = this.mounts[i];
      if (arraysEqual(parts, delParts) && name === delName) {
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
        // eslint-disable-next-line no-await-in-loop
        dir = await this.getDirectory(dir, part);
      }
      if (this.DEBUG) console.log(`resolveAbsolute(${path}) = ${name}, ${dir}`);
      return { err: constants.WASI_ESUCCESS, name, dir };
    } catch (err) {
      if (err.name === "NotFoundError") {
        return { err: constants.WASI_ENOENT, name: null, dir: null };
      }
      if (err.name === "TypeMismatchError" || err.name === "TypeError") {
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
        `getParent(dir.handle.name="${dir.handle.name}", path="${path}")`
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
        // eslint-disable-next-line no-await-in-loop
        dir = await this.getDirectory(dir, part);
      }
    } catch (err) {
      if (err.name === "NotFoundError") {
        return { err: constants.WASI_ENOENT, name: null, parent: null };
      }
      if (err.name === "TypeMismatchError" || err.name === "TypeError") {
        return { err: constants.WASI_ENOTDIR, name: null, parent: null };
      }
      throw err;
    }

    if (this.DEBUG)
      console.log(`getParent resolved as = {"${name}", "${dir.path}"}`);
    return { err: constants.WASI_ESUCCESS, name, parent: dir };
  }

  async entries(dir: Directory): Promise<(File | Directory)[]> {
    const components = await this.rootDir.handle.resolve(dir.handle);

    const entries: (File | Directory)[] = [];

    const reversedMounts = [].concat(this.mounts).reverse();
    for (const { parts, mountDir } of reversedMounts) {
      if (arraysEqual(parts, components)) {
        entries.push(mountDir);
      }
    }

    // check if a symlink exists
    for (const { parts, name, to: symlinkDestination } of this.symlinks) {
      let alreadyExists = false;
      for (const entry of entries) {
        if (entry.path === name) {
          alreadyExists = true;
          break;
        }
      }
      if (!alreadyExists) {
        if (arraysEqual(parts, components)) {
          switch (symlinkDestination.handle.kind) {
            case "file": {
              entries.push(
                new File(name, symlinkDestination.handle, dir, this)
              );
              break;
            }
            case "directory": {
              entries.push(
                new Directory(name, symlinkDestination.handle, dir, this)
              );
              break;
            }
            default: {
              throw Error("Unexpected handle kind");
            }
          }
        }
      }
    }

    for await (const [name, handle] of dir.handle.entries()) {
      // mounted directories hide directories they are mounted to
      let alreadyExists = false;
      for (const entry of entries) {
        if (entry.path === name) {
          alreadyExists = true;
          break;
        }
      }
      if (!alreadyExists) {
        switch (handle.kind) {
          case "file": {
            entries.push(new File(name, handle, dir, this));
            break;
          }
          case "directory": {
            entries.push(new Directory(name, handle, dir, this));
            break;
          }
          default: {
            throw Error("Unexpected handle kind");
          }
        }
      }
    }

    return entries;
  }
}

abstract class Entry {
  public readonly fileType: number;

  public path: string;

  public parent: Directory | null;

  protected readonly handle: FileSystemDirectoryHandle | FileSystemFileHandle;

  protected readonly filesystem: Filesystem;

  constructor(
    path: string,
    handle: FileSystemDirectoryHandle | FileSystemFileHandle,
    parent: Directory | null,
    filesystem: Filesystem
  ) {
    if (filesystem.DEBUG) {
      console.log(`new Entry(path="${path}", parent.path="${parent?.path}")`);
    }
    this.path = path;
    this.handle = handle;
    this.parent = parent;
    this.filesystem = filesystem;
  }

  abstract size(): Promise<number>;

  abstract lastModified(): Promise<number>;

  // TODO: fill dummy values with something meaningful
  async stat(): Promise<{
    dev: bigint;
    ino: bigint;
    fileType: number;
    nlink: bigint;
    size: bigint;
    atim: bigint;
    mtim: bigint;
    ctim: bigint;
  }> {
    if (this.filesystem.DEBUG) {
      console.log(`Entry(this.path="${this.path}").stat()`);
    }
    let lmod = await this.lastModified();
    if (!Number.isFinite(lmod)) lmod = 0; // TODO:
    const time = BigInt(lmod) * 1_000_000n;
    return {
      dev: 0n,
      ino: 0n,
      fileType: this.fileType,
      nlink: 0n,
      size: BigInt(await this.size()),
      atim: time,
      mtim: time,
      ctim: time,
    };
  }
}

export class Directory extends Entry {
  public readonly fileType: number = constants.WASI_FILETYPE_DIRECTORY;

  declare readonly handle: FileSystemDirectoryHandle;

  async size(): Promise<number> {
    return 0;
  }

  async entries(): Promise<(File | Directory)[]> {
    if (this.filesystem.DEBUG)
      console.log(`Directory(this.path="${this.path}").entries()`);
    return this.filesystem.entries(this);
  }

  async lastModified(): Promise<number> {
    // // TODO: this is very slow for massive local directories
    // const entries = await this.entries();
    // const dates = await Promise.all(entries.map(entry => entry.lastModified()));
    // return Math.max(...dates);
    return 0;
  }

  open(): OpenDirectory {
    return new OpenDirectory(
      this.path,
      this.handle,
      this.parent,
      this.filesystem
    );
  }

  // basically copied form RReverser's wasi-fs-access
  getEntry(
    path: string,
    mode: FileOrDir.File,
    openFlags?: OpenFlags
  ): Promise<{ err: number; entry: File }>;

  // eslint-disable-next-line no-dupe-class-members
  getEntry(
    path: string,
    mode: FileOrDir.Directory,
    openFlags?: OpenFlags
  ): Promise<{ err: number; entry: Directory }>;

  // eslint-disable-next-line no-dupe-class-members
  getEntry(
    path: string,
    mode: FileOrDir,
    openFlags?: OpenFlags
  ): Promise<{ err: number; entry: File | Directory }>;

  // eslint-disable-next-line no-dupe-class-members
  async getEntry(
    path: string,
    mode: FileOrDir,
    cflags: OpenFlags = 0
  ): Promise<{ err: number; entry: File | Directory }> {
    if (this.filesystem.DEBUG)
      console.log(
        `Directory(this.path="${this.path}").getEntry(path="${path}", mode=${mode}, cflags=${cflags})`
      );

    const {
      err: getParentErr,
      name,
      parent,
    } = await this.filesystem.getParent(this, path);

    if (getParentErr !== constants.WASI_ESUCCESS) {
      return { err: getParentErr, entry: null };
    }

    if (name === "." || name === "..") {
      if (cflags & (OpenFlags.Create | OpenFlags.Exclusive)) {
        return { err: constants.WASI_EEXIST, entry: null };
      }
      if (cflags & OpenFlags.Truncate) {
        return { err: constants.WASI_EISDIR, entry: null };
      }

      if (name === ".") {
        const entry = new Directory(
          parent.path,
          parent.handle,
          parent.parent,
          this.filesystem
        );
        return { err: constants.WASI_ESUCCESS, entry };
      }
      if (name === "..") {
        const entry = new Directory(
          parent.parent.path,
          parent.parent.handle,
          parent.parent.parent,
          this.filesystem
        );
        return { err: constants.WASI_ESUCCESS, entry };
      }
    }

    if (cflags & OpenFlags.Directory) {
      mode = FileOrDir.Directory;
    }

    const openWithCreate = async (
      create: boolean
    ): Promise<{ err: number; entry: File | Directory }> => {
      if (mode & FileOrDir.File) {
        try {
          const entry = await this.filesystem.getFile(parent, name, {
            create,
          });
          return { err: constants.WASI_ESUCCESS, entry };
        } catch (err) {
          if (err.name === "TypeMismatchError" || err.name === "TypeError") {
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
        const entry = await this.filesystem.getDirectory(parent, name, {
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

    let err;
    let entry: File | Directory;
    if (cflags & OpenFlags.Create) {
      if (cflags & OpenFlags.Exclusive) {
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

    if (cflags & OpenFlags.Truncate) {
      if (entry.handle.kind === "directory") {
        return { err: constants.WASI_EISDIR, entry: null };
      }
      const writable = await entry.handle.createWritable();
      await writable.write({ type: "truncate", size: 0 });
      await writable.close();
    }

    return { err, entry };
  }
}

export class OpenDirectory extends Directory {
  public readonly fileType: number = constants.WASI_PREOPENTYPE_DIR;

  async deleteEntry(
    path: string,
    options = { recursive: false }
  ): Promise<{ err: number }> {
    console.log(`OpenDirectory(${this.path}).deleteEntry(${path}, ${options})`);
    const { err, name, parent } = await this.filesystem.getParent(this, path);
    if (err === constants.WASI_ESUCCESS) {
      await parent.handle.removeEntry(name, options);
    }
    return { err };
  }

  async close() {
    // TODO: what would that mean to close a FileSystemDirectoryHandle?
  }
}

export class File extends Entry {
  public readonly fileType: number = constants.WASI_FILETYPE_REGULAR_FILE;

  declare readonly handle: FileSystemFileHandle;

  async size(): Promise<number> {
    const file = await this.handle.getFile();
    return file.size;
  }

  async lastModified(): Promise<number> {
    const file = await this.handle.getFile();
    return file.lastModified;
  }

  // TODO: remove OpenedFd dependency, add wrapper for OpenedFdDirectory
  open(): OpenedFd {
    return new OpenedFd(
      new OpenFile(this.path, this.handle, this.parent, this.filesystem)
    );
  }
}

// Represents File opened for reading and writing
// it is backed by File System Access API through a FileSystemFileHandle handle
export class OpenFile extends File {
  public readonly fileType: number = constants.WASI_FILETYPE_REGULAR_FILE;

  private filePosition: number = 0;

  private DEBUG: boolean = false;

  async read(len: number): Promise<[Uint8Array, number]> {
    if (this.DEBUG) console.log(`OpenFile(${this.path}).read(${len})`);
    const size = await this.size();
    if (this.filePosition < size) {
      const file = await this.handle.getFile();
      let data = await file
        .slice(this.filePosition, this.filePosition + len)
        .arrayBuffer();
      data = data.slice(0);
      const slice = new Uint8Array(data);
      this.filePosition += slice.byteLength;
      return [slice, 0];
    }
    return [new Uint8Array(0), 0];
  }

  // TODO: each write creates new writable, store it on creation
  async write(buffer: Uint8Array): Promise<number> {
    if (this.DEBUG)
      console.log(
        `OpenFile(${this.path}).write(${this.path} len=${buffer.byteLength}, position ${this.filePosition})`
      );
    try {
      const w = await this.handle.createWritable({ keepExistingData: true });
      await w.write({
        type: "write",
        position: this.filePosition,
        data: buffer,
      });
      await w.close();
      this.filePosition += buffer.byteLength;
    } catch (err) {
      console.log(`Error during writing: ${err}`);
      return 1;
    }
    return 0;
  }

  async close() {
    // TODO: add implementation when reworking OpenFile
  }

  async seek(offset: number, whence: number): Promise<number> {
    if (this.DEBUG)
      console.log(`OpenFile(${this.path}).seek(${offset}, ${whence})`);
    switch (whence) {
      case constants.WASI_WHENCE_SET: {
        this.filePosition = offset;
        break;
      }
      case constants.WASI_WHENCE_CUR: {
        this.filePosition += offset;
        break;
      }
      case constants.WASI_WHENCE_END: {
        this.filePosition = (await this.size()) + offset;
        break;
      }
      default: {
        throw Error("Unhandled whence case");
      }
    }
    // TODO: this only makes sense if we store WritableFileStream on class
    // await w.write({type: "seek", position: offset});
    return this.filePosition;
  }

  async truncate(size: number = 0) {
    if (this.DEBUG)
      console.log(`OpenFile(${this.path}).truncate(${this.size})`);
    const writable = await this.handle.createWritable();
    await writable.write({ type: "truncate", size });
    await writable.close();
    this.filePosition = 0;
  }
}
