// @ts-ignore, such imports are too fresh for typescript?
import { get, set, del } from "./vendor/idb-keyval.js";
import * as constants from "./constants.js";
import { parsePath, arraysEqual } from "./utils.js";
import { OpenedFd } from "./devices.js";

// eslint-disable-next-line no-shadow
export const enum FileOrDir {
  File = 1,
  Directory = 2,
  Any = 3,
}

// eslint-disable-next-line no-shadow
export const enum OpenFlags {
  Create = 1, // constants.WASI_O_CREAT
  Directory = 2, // constants.WASI_O_DIRECTORY
  Exclusive = 4, // constants.WASI_O_EXCL
  Truncate = 8, // constants.WASI_O_TRUNC
}

export type StoredData = {
  fileType: number; // file type
  userMode: number; // read-write-execute permissions of user
  groupMode: number; // read-write-execute permissions of group
  uid: number; // user ID of owner
  gid: number; // group ID of owner
  atim: bigint; // access time
  mtim: bigint; // modification time
  ctim: bigint; // change time
};

export type Metadata = {
  dev: bigint; // ID of device containing file
  ino: bigint; // inode number (always 0)
  fileType: number; // file type
  userMode: number; // read-write-execute permissions of user
  groupMode: number; // read-write-execute permissions of group
  nlink: bigint; // number of hard links (always 0)
  uid: number; // user ID of owner
  gid: number; // group ID of owner
  rdev: number; // device ID (if special file)
  size: bigint; // total size, in bytes
  blockSize: number; // block size for filesystem I/O
  blocks: number; // number of 512B blocks allocated
  atim: bigint; // access time
  mtim: bigint; // modification time
  ctim: bigint; // change time
};

export type Stat = {
  dev: bigint;
  ino: bigint;
  fileType: number;
  nlink: bigint;
  size: bigint;
  atim: bigint;
  mtim: bigint;
  ctim: bigint;
};

type Mount = { parts: string[]; name: string; dir: Directory };

export async function createFilesystem(): Promise<Filesystem> {
  const topHandle = await navigator.storage.getDirectory();
  const rootHandle = await topHandle.getDirectoryHandle("root", {
    create: true,
  });
  let rootMetadata: StoredData = await get("");
  if (!rootMetadata) {
    rootMetadata = {
      fileType: constants.WASI_FILETYPE_DIRECTORY,
      userMode: 7,
      groupMode: 7,
      uid: 0,
      gid: 0,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    };
    await set("", rootMetadata);
  }
  const metaHandle = await topHandle.getDirectoryHandle("meta", {
    create: true,
  });
  return new Filesystem(rootHandle, metaHandle);
}

export class Filesystem {
  DEBUG: boolean = false;

  // TODO: parts could be a key, that would optimise the lookup
  mounts: Mount[] = [];

  public readonly rootDir: Directory;

  public readonly metaDir: Directory;

  constructor(
    rootHandle: FileSystemDirectoryHandle,
    metaHandle: FileSystemDirectoryHandle
  ) {
    this.rootDir = new Directory("", "", rootHandle, null, this);
    this.metaDir = new Directory("", "", metaHandle, null, this);
  }

  async getDirectory(
    dir: Directory,
    name: string,
    options: { create: boolean } = { create: false }
  ): Promise<Directory> {
    // TODO: revisit this hack
    if (
      dir.name === "" &&
      (name === "." || name === ".." || name === "" || name === "/")
    )
      return this.rootDir;
    if (name === ".") {
      return dir;
    }
    if (name === "..") {
      return dir.parent;
    }

    const components = dir.path.split("/").slice(1);

    // if there are many mounts for the same path, we want to return the latest
    const reversedMounts = [].concat(this.mounts).reverse();
    for (const { parts, name: mountName, dir: mountDir } of reversedMounts) {
      if (arraysEqual(parts, components) && mountName === name) {
        return mountDir;
      }
    }

    const path = `${dir.path}/${name}`;
    const handle = await dir.handle.getDirectoryHandle(name, options);
    let metadata: StoredData = await get(path);
    if (!metadata) {
      metadata = {
        fileType: constants.WASI_FILETYPE_DIRECTORY, // file type
        userMode: 7,
        groupMode: 7,
        uid: 0, // user ID of owner
        gid: 0, // group ID of owner
        atim: 0n,
        mtim: 0n,
        ctim: 0n,
      };
      await set(path, metadata);
    }
    return new Directory(name, path, handle, dir, this);
  }

  async getFile(
    dir: Directory,
    name: string,
    options: { create: boolean } = { create: false }
  ): Promise<File> {
    const path = `${dir.path}/${name}`;
    const handle = await dir.handle.getFileHandle(name, options);
    const file = await handle.getFile();
    let metadata: StoredData = await get(path);
    if (!metadata) {
      metadata = {
        fileType: constants.WASI_FILETYPE_REGULAR_FILE,
        userMode: 7,
        groupMode: 7,
        uid: 0,
        gid: 0,
        atim: 0n,
        mtim: BigInt(file.lastModified) * 1_000_000n,
        ctim: 0n,
      };
      await set(path, metadata);
    }
    return new File(name, path, handle, dir, this);
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
    const path = `/${parts.join("/")}/${name}`;
    const dir = new Directory(name, path, mountedHandle, parent.entry, this);
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
      dir.name === "" &&
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
      console.log(`getParent resolved as = {"${name}", "${dir.name}"}`);
    return { err: constants.WASI_ESUCCESS, name, parent: dir };
  }

  async entries(dir: Directory): Promise<(File | Directory)[]> {
    const components = await this.rootDir.handle.resolve(dir.handle);

    const entries: (File | Directory)[] = [];

    const reversedMounts = [].concat(this.mounts).reverse();
    for (const { parts, dir: mountDir } of reversedMounts) {
      if (arraysEqual(parts, components)) {
        entries.push(mountDir);
      }
    }

    for await (const [name, handle] of dir.handle.entries()) {
      // mounted directories hide directories they are mounted to
      let alreadyExists = false;
      for (const entry of entries) {
        if (entry.name === name) {
          alreadyExists = true;
          break;
        }
      }
      if (!alreadyExists) {
        const path = `${dir.path}/${name}`;
        switch (handle.kind) {
          case "file": {
            entries.push(new File(name, path, handle, dir, this));
            break;
          }
          case "directory": {
            entries.push(new Directory(name, path, handle, dir, this));
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
  constructor(
    public name: string,
    public path: string,
    protected readonly handle: FileSystemDirectoryHandle | FileSystemFileHandle,
    public parent: Directory | null,
    protected readonly filesystem: Filesystem
  ) {
    if (filesystem.DEBUG) {
      console.log(`new Entry(path="${path}", parent.path="${parent?.path}")`);
    }
  }

  async metadata(): Promise<Metadata> {
    if (this.filesystem.DEBUG) {
      console.log(`Entry(path="${this.path}").metadata()`);
    }
    const storedData: StoredData = await get(this.path);
    let size;
    if (this.handle.kind === "file") {
      size = BigInt((await this.handle.getFile()).size);
    } else {
      size = 4096n;
    }
    return {
      dev: 0n,
      ino: 0n,
      nlink: 1n,
      rdev: 0,
      size,
      blockSize: 0,
      blocks: 0,
      ...storedData,
    };
  }

  async stat(): Promise<Stat> {
    if (this.filesystem.DEBUG) {
      console.log(`Entry(path="${this.path}").stat()`);
    }
    return this.metadata();
  }
}

export class Directory extends Entry {
  public readonly fileType: number = constants.WASI_FILETYPE_DIRECTORY;

  declare readonly handle: FileSystemDirectoryHandle;

  async entries(): Promise<(File | Directory)[]> {
    if (this.filesystem.DEBUG)
      console.log(`Directory(this.path="${this.name}").entries()`);
    return this.filesystem.entries(this);
  }

  open(): OpenDirectory {
    return new OpenDirectory(
      this.name,
      this.path,
      this.handle,
      this.parent,
      this.filesystem
    );
  }

  async addSymlink(source: string, destination: string): Promise<number> {
    const { err, entry } = await this.getEntry(
      source,
      FileOrDir.File,
      OpenFlags.Create | OpenFlags.Exclusive
    );
    if (err === constants.WASI_ESUCCESS) {
      const metadata = await entry.metadata();
      metadata.fileType = constants.WASI_FILETYPE_SYMBOLIC_LINK;
      const w = await entry.handle.createWritable({ keepExistingData: true });
      await w.write({
        type: "write",
        position: 0,
        data: destination,
      });
      await w.close();
      await set(entry.path, metadata);
    }

    return err;
  }

  async readlink(
    path: string
  ): Promise<{ err: number; linkedPath: string | null }> {
    const { err, entry } = await this.getEntry(path, FileOrDir.File);
    if (err === constants.WASI_ESUCCESS) {
      return { err, linkedPath: await (await entry.handle.getFile()).text() };
    }
    return { err, linkedPath: null };
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
        `Directory(path="${this.path}").getEntry(path="${path}", mode=${mode}, cflags=${cflags})`
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
          parent.name,
          parent.path,
          parent.handle,
          parent.parent,
          parent.filesystem
        );
        return { err: constants.WASI_ESUCCESS, entry };
      }
      if (name === "..") {
        const entry = new Directory(
          parent.parent.name,
          parent.parent.path,
          parent.parent.handle,
          parent.parent.parent,
          parent.parent.filesystem
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
    console.log(`OpenDirectory(${this.name}).deleteEntry(${path}, ${options})`);
    const { err, name, parent } = await this.filesystem.getParent(this, path);
    if (err === constants.WASI_ESUCCESS) {
      await parent.handle.removeEntry(name, options);
      await del(parent.path + name);
    }
    return { err };
  }

  // eslint-disable-next-line class-methods-use-this
  async close() {
    // TODO: what would that mean to close a FileSystemDirectoryHandle?
  }
}

export class File extends Entry {
  public readonly fileType: number = constants.WASI_FILETYPE_REGULAR_FILE;

  declare readonly handle: FileSystemFileHandle;

  // TODO: remove OpenedFd dependency, add wrapper for OpenedFdDirectory
  async open(): Promise<OpenedFd> {
    return new OpenedFd(
      new OpenFile(
        this.name,
        this.path,
        this.handle,
        this.parent,
        this.filesystem
      ),
      (await this.metadata()).fileType
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
    if (this.DEBUG)
      console.log(`OpenFile(${this.path}, ${this.name}).read(${len})`);
    let handle;
    let size;
    if (
      (await this.metadata()).fileType === constants.WASI_FILETYPE_SYMBOLIC_LINK
    ) {
      const file = await this.handle.getFile();
      const path = await file.text();
      const { err, entry } = await this.parent.getEntry(path, FileOrDir.File);
      if (err !== constants.WASI_ESUCCESS) {
        return [new Uint8Array(0), err];
      }
      handle = entry.handle;
      size = file.size;
    } else {
      handle = this.handle;
      size = (await this.metadata()).size;
    }
    if (this.filePosition < size) {
      const file = await handle.getFile();
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
        `OpenFile(${this.name}).write(${this.name} len=${buffer.byteLength}, position ${this.filePosition})`
      );
    let handle;
    if (
      (await this.metadata()).fileType === constants.WASI_FILETYPE_SYMBOLIC_LINK
    ) {
      const file = await this.handle.getFile();
      const path = await file.text();
      const { err, entry } = await this.parent.getEntry(path, FileOrDir.File);
      if (err !== constants.WASI_ESUCCESS) {
        return err;
      }
      handle = entry.handle;
    } else {
      handle = this.handle;
    }

    const w = await handle.createWritable({ keepExistingData: true });
    await w.write({
      type: "write",
      position: this.filePosition,
      data: buffer,
    });
    await w.close();
    this.filePosition += buffer.byteLength;
    return constants.WASI_ESUCCESS;
  }

  // eslint-disable-next-line class-methods-use-this
  async close() {
    // TODO: add implementation when reworking OpenFile
  }

  async seek(offset: number, whence: number): Promise<number> {
    if (this.DEBUG)
      console.log(`OpenFile(${this.name}).seek(${offset}, ${whence})`);
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
        this.filePosition = Number((await this.metadata()).size) + offset;
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
    if (this.DEBUG) console.log(`OpenFile(${this.name}).truncate(${size})`);
    const writable = await this.handle.createWritable();
    await writable.write({ type: "truncate", size });
    await writable.close();
    this.filePosition = 0;
  }
}
