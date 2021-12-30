// @ts-ignore TODO: port idb-keyval to Typescript with no implicit any
import { del, get, set } from "../vendor/idb-keyval.js";
import * as constants from "../constants.js";
import { arraysEqual, parsePath } from "../utils.js";
import {
  FdFlags,
  FileOrDir,
  LookupFlags,
  Metadata,
  OpenFlags,
  Rights,
  Stat,
  StoredData,
} from "./enums.js";
import {
  Directory,
  DirEntry,
  Entry,
  File,
  Filesystem,
  Mount,
  OpenDirectory,
  OpenFile,
} from "./interfaces.js";

export async function createFsaFilesystem(): Promise<FsaFilesystem> {
  const topHandle = await navigator.storage.getDirectory();
  const rootHandle = await topHandle.getDirectoryHandle("root", {
    create: true,
  });
  let rootStoredData: StoredData = await get("");
  if (!rootStoredData) {
    rootStoredData = {
      fileType: constants.WASI_FILETYPE_DIRECTORY,
      userMode: 7,
      groupMode: 7,
      uid: 0,
      gid: 0,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    };
    await set("", rootStoredData);
  }
  const metaHandle = await topHandle.getDirectoryHandle("meta", {
    create: true,
  });
  return new FsaFilesystem(rootHandle, metaHandle);
}

class FsaFilesystem implements Filesystem {
  // TODO: parts could be a key, that would optimise the lookup
  mounts: Mount[] = [];

  readonly rootDir: FsaDirectory;

  readonly metaDir: FsaDirectory;

  constructor(
    rootHandle: FileSystemDirectoryHandle,
    metaHandle: FileSystemDirectoryHandle
  ) {
    this.rootDir = new FsaDirectory("", rootHandle, null, this);
    this.metaDir = new FsaDirectory("", metaHandle, null, this);
  }

  getRootDir(): FsaDirectory {
    return this.rootDir;
  }

  getMetaDir(): FsaDirectory {
    return this.metaDir;
  }

  getMounts(): Mount[] {
    return this.mounts;
  }

  async getDirectory(
    dir: FsaOpenDirectory,
    name: string,
    options: { create: boolean } = { create: false },
    lookupFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: FsaDirectory }> {
    // TODO: revisit this hack
    if (
      dir.name() === "" &&
      (name === "." || name === ".." || name === "" || name === "/")
    )
      return { err: constants.WASI_ESUCCESS, entry: this.getRootDir() };
    if (name === ".") {
      return {
        err: constants.WASI_ESUCCESS,
        entry: new FsaDirectory(
          dir.path(),
          dir.handle,
          dir.parent(),
          dir.filesystem
        ),
      };
    }
    if (name === "..") {
      return { err: constants.WASI_ESUCCESS, entry: dir.parent() };
    }

    const components = dir.path().split("/").slice(1);

    // if there are many mounts for the same path, we want to return the latest
    const reversedMounts = [].concat(this.getMounts).reverse();
    for (const { parts, name: mountName, dir: mountDir } of reversedMounts) {
      if (arraysEqual(parts, components) && mountName === name) {
        return mountDir;
      }
    }

    const path = `${dir.path()}/${name}`;
    // TODO: should also consider getFileHandle in case it's a symlink
    const handle = await dir.handle.getDirectoryHandle(name, options);
    let storedData: StoredData = await get(path);
    if (!storedData) {
      storedData = {
        fileType: constants.WASI_FILETYPE_DIRECTORY, // file type
        userMode: 7,
        groupMode: 7,
        uid: 0, // user ID of owner
        gid: 0, // group ID of owner
        atim: 0n,
        mtim: 0n,
        ctim: 0n,
      };
      await set(path, storedData);
    }

    if (
      storedData.fileType === constants.WASI_FILETYPE_SYMBOLIC_LINK &&
      lookupFlags & LookupFlags.SymlinkFollow
    ) {
      const { err, linkedPath } = await dir.readlink(path);
      if (err !== constants.WASI_ESUCCESS) {
        return { err, entry: null };
      }
      return dir.getEntry(
        linkedPath,
        FileOrDir.Directory,
        lookupFlags,
        openFlags,
        fsRightsBase,
        fsRightsInheriting,
        fdFlags
      );
    }

    return {
      err: constants.WASI_ESUCCESS,
      entry: new FsaDirectory(path, handle, dir, this),
    };
  }

  async getFile(
    dir: FsaOpenDirectory,
    name: string,
    options: { create: boolean } = { create: false },
    lookupFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: FsaFile }> {
    const path = `${dir.path()}/${name}`;
    const handle = await dir.handle.getFileHandle(name, options);
    const file = await handle.getFile();
    let storedData: StoredData = await get(path);
    if (!storedData) {
      storedData = {
        fileType: constants.WASI_FILETYPE_REGULAR_FILE,
        userMode: 7,
        groupMode: 7,
        uid: 0,
        gid: 0,
        atim: 0n,
        mtim: BigInt(file.lastModified) * 1_000_000n,
        ctim: 0n,
      };
      await set(path, storedData);
    }

    if (
      storedData.fileType === constants.WASI_FILETYPE_SYMBOLIC_LINK &&
      lookupFlags & LookupFlags.SymlinkFollow
    ) {
      const { err, linkedPath } = await dir.readlink(path);
      if (err !== constants.WASI_ESUCCESS) {
        return { err, entry: null };
      }
      return dir.getEntry(
        linkedPath,
        FileOrDir.File,
        lookupFlags,
        openFlags,
        fsRightsBase,
        fsRightsInheriting,
        fdFlags
      );
    }

    return {
      err: constants.WASI_ESUCCESS,
      entry: new FsaFile(path, handle, dir, this),
    };
  }

  async pathExists(
    absolutePath: string,
    mode: FileOrDir = FileOrDir.Any
  ): Promise<boolean> {
    const { err } = await this.getRootDir()
      .open()
      .getEntry(absolutePath, mode, LookupFlags.NoFollow, OpenFlags.None);
    return err === constants.WASI_ESUCCESS;
  }

  async addMount(
    absolutePath: string,
    mountedHandle: FileSystemDirectoryHandle
  ): Promise<number> {
    const { parts, name } = parsePath(absolutePath);
    const parent = await this.getRootDir()
      .open()
      .getEntry(
        parts.join("/"),
        FileOrDir.Directory,
        LookupFlags.SymlinkFollow,
        OpenFlags.None
      );
    const path = `/${parts.join("/")}/${name}`;
    const dir = new FsaDirectory(path, mountedHandle, parent.entry, this);
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
    const { parts, name } = parsePath(path);
    let dir = this.getRootDir();

    try {
      for (const part of parts) {
        // eslint-disable-next-line no-await-in-loop
        ({ entry: dir } = await this.getDirectory(dir.open(), part));
      }
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
    dir: FsaDirectory,
    path: string
  ): Promise<{ err: number; name: string; parent: FsaDirectory }> {
    if (path.includes("\\"))
      return { err: constants.WASI_EINVAL, name: null, parent: null };
    if (
      dir.name() === "" &&
      (path === "." || path === ".." || path === "" || path === "/")
    )
      return { err: constants.WASI_ESUCCESS, name: "", parent: dir };
    if (path.startsWith("/")) dir = this.getRootDir();

    const { parts, name } = parsePath(path);

    try {
      for (const part of parts) {
        // eslint-disable-next-line no-await-in-loop
        ({ entry: dir } = await this.getDirectory(dir.open(), part));
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

    return { err: constants.WASI_ESUCCESS, name, parent: dir };
  }

  async dirEntries(dir: FsaOpenDirectory): Promise<DirEntry[]> {
    const components = await this.getRootDir().handle.resolve(dir.handle);

    const entries: DirEntry[] = [];

    const reversedMounts = [].concat(this.getMounts).reverse();
    for (const { parts, dir: mountDir } of reversedMounts) {
      if (arraysEqual(parts, components)) {
        entries.push(mountDir);
      }
    }

    for await (const [name, handle] of dir.handle.entries()) {
      // mounted directories hide directories they are mounted to
      let alreadyExists = false;
      for (const entry of entries) {
        if (entry.name() === name) {
          alreadyExists = true;
          break;
        }
      }
      if (!alreadyExists) {
        const path = `${dir.path()}/${name}`;
        entries.push(new FsaDirEntry(path, handle, dir, this));
      }
    }

    return entries;
  }
}

abstract class FsaEntry implements Entry {
  private readonly storedPath: string;

  protected storedName: string;

  private readonly storedParent: FsaDirectory;

  constructor(
    path: string,
    public readonly handle: FileSystemDirectoryHandle | FileSystemFileHandle,
    parent: FsaDirectory,
    public readonly filesystem: FsaFilesystem
  ) {
    this.storedPath = path;
    this.storedName = path.split("/").slice(-1)[0];
    this.storedParent = parent;
  }

  path(): string {
    return this.storedPath;
  }

  name(): string {
    return this.storedName;
  }

  parent(): FsaDirectory {
    return this.storedParent;
  }

  async metadata(): Promise<Metadata> {
    const storedData: StoredData = await get(this.path());
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
      gid: storedData.gid,
      uid: storedData.uid,
      userMode: storedData.userMode,
      groupMode: storedData.groupMode,
      blockSize: 0,
      blocks: 0,
      fileType: storedData.fileType,
      atim: storedData.atim,
      mtim: storedData.mtim,
      ctim: storedData.ctim,
    };
  }

  async stat(): Promise<Stat> {
    return this.metadata();
  }
}

class FsaDirEntry extends FsaEntry {}

export class FsaDirectory extends FsaEntry implements Directory {
  public readonly fileType: number = constants.WASI_FILETYPE_DIRECTORY;

  declare readonly handle: FileSystemDirectoryHandle;

  open(): FsaOpenDirectory {
    return new FsaOpenDirectory(
      this.path(),
      this.handle,
      this.parent(),
      this.filesystem
    );
  }
}

export class FsaOpenDirectory extends FsaDirectory implements OpenDirectory {
  public readonly fileType: number = constants.WASI_PREOPENTYPE_DIR;

  async metadata(): Promise<Metadata> {
    const storedData: StoredData = await get(this.path());
    return {
      dev: 0n,
      ino: 0n,
      nlink: 1n,
      rdev: 0,
      size: 4096n,
      gid: storedData.gid,
      uid: storedData.uid,
      userMode: storedData.userMode,
      groupMode: storedData.groupMode,
      blockSize: 0,
      blocks: 0,
      fileType: constants.WASI_PREOPENTYPE_DIR,
      atim: storedData.atim,
      mtim: storedData.mtim,
      ctim: storedData.ctim,
    };
  }

  async entries(): Promise<DirEntry[]> {
    return this.filesystem.dirEntries(this);
  }

  async deleteEntry(
    path: string,
    options: { recursive: boolean } = { recursive: false }
  ): Promise<{ err: number }> {
    const { err, name, parent } = await this.filesystem.getParent(this, path);
    if (err === constants.WASI_ESUCCESS) {
      await parent.handle.removeEntry(name, options);
      await del(parent.path() + name);
    }
    return { err };
  }

  async addSymlink(source: string, destination: string): Promise<number> {
    const { err, entry } = await this.getEntry(
      source,
      FileOrDir.File,
      LookupFlags.SymlinkFollow,
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
      await set(entry.path(), metadata);
    }

    return err;
  }

  // return contents of symlink file, namely the path of a file/directory it is pointing to
  async readlink(
    path: string
  ): Promise<{ err: number; linkedPath: string | null }> {
    const { err, entry } = await this.getEntry(
      path,
      FileOrDir.File,
      LookupFlags.NoFollow,
      OpenFlags.None
    );
    if (err === constants.WASI_ESUCCESS) {
      return { err, linkedPath: await (await entry.handle.getFile()).text() };
    }
    return { err, linkedPath: null };
  }

  // basically copied form RReverser's wasi-fs-access
  getEntry(
    path: string,
    mode: FileOrDir.File,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: FsaFile }>;

  // eslint-disable-next-line no-dupe-class-members
  getEntry(
    path: string,
    mode: FileOrDir.Directory,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: FsaDirectory }>;

  // eslint-disable-next-line no-dupe-class-members
  getEntry(
    path: string,
    mode: FileOrDir,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: FsaFile | FsaDirectory }>;

  // eslint-disable-next-line no-dupe-class-members
  async getEntry(
    path: string,
    mode: FileOrDir,
    dirFlags: LookupFlags = LookupFlags.SymlinkFollow,
    openFlags: OpenFlags = OpenFlags.None,
    fsRightsBase: Rights = Rights.None,
    fsRightsInheriting: Rights = Rights.None,
    fdFlags: FdFlags = FdFlags.None
  ): Promise<{ err: number; entry: FsaFile | FsaDirectory }> {
    const {
      err: getParentErr,
      name,
      parent,
    } = await this.filesystem.getParent(this, path);

    if (getParentErr !== constants.WASI_ESUCCESS) {
      return { err: getParentErr, entry: null };
    }

    if (name === "." || name === "..") {
      if (openFlags & (OpenFlags.Create | OpenFlags.Exclusive)) {
        return { err: constants.WASI_EEXIST, entry: null };
      }
      if (openFlags & OpenFlags.Truncate) {
        return { err: constants.WASI_EISDIR, entry: null };
      }

      if (name === ".") {
        const entry = new FsaDirectory(
          parent.path(),
          parent.handle,
          parent.parent(),
          parent.filesystem
        );
        return { err: constants.WASI_ESUCCESS, entry };
      }
      if (name === "..") {
        const entry = new FsaDirectory(
          parent.parent().path(),
          parent.parent().handle,
          parent.parent().parent(),
          parent.parent().filesystem
        );
        return { err: constants.WASI_ESUCCESS, entry };
      }
    }

    if (openFlags & OpenFlags.Directory) {
      mode = FileOrDir.Directory;
    }

    const open = async (
      create: boolean
    ): Promise<{ err: number; entry: FsaFile | FsaDirectory }> => {
      if (mode & FileOrDir.File) {
        try {
          return await this.filesystem.getFile(
            parent.open(),
            name,
            {
              create,
            },
            dirFlags,
            openFlags,
            fsRightsBase,
            fsRightsInheriting,
            fdFlags
          );
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
        return await this.filesystem.getDirectory(
          parent.open(),
          name,
          {
            create,
          },
          dirFlags,
          openFlags,
          fsRightsBase,
          fsRightsInheriting,
          fdFlags
        );
      } catch (err) {
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
    let entry: FsaFile | FsaDirectory;
    if (openFlags & OpenFlags.Create) {
      if (openFlags & OpenFlags.Exclusive) {
        if ((await open(false)).err === constants.WASI_ESUCCESS) {
          return { err: constants.WASI_EEXIST, entry: null };
        }
      }
      ({ err, entry } = await open(true));
    } else {
      ({ err, entry } = await open(false));
    }

    if (err !== constants.WASI_ESUCCESS) {
      return { err, entry: null };
    }

    if (openFlags & OpenFlags.Truncate) {
      if (entry.handle.kind === "directory") {
        return { err: constants.WASI_EISDIR, entry: null };
      }
      const writable = await entry.handle.createWritable();
      await writable.write({ type: "truncate", size: 0 });
      await writable.close();
    }

    return { err, entry };
  }

  // eslint-disable-next-line class-methods-use-this
  async close() {
    // TODO: what would that mean to close a FileSystemDirectoryHandle?
  }

  setAsCwd() {
    this.storedName = ".";
  }
}

export class FsaFile extends FsaEntry implements File {
  public readonly fileType: number = constants.WASI_FILETYPE_REGULAR_FILE;

  declare readonly handle: FileSystemFileHandle;

  async open(): Promise<FsaOpenFile> {
    return new FsaOpenFile(
      this.path(),
      this.handle,
      this.parent(),
      this.filesystem
    );
  }
}

// Represents File opened for reading and writing
// it is backed by File System Access API through a FileSystemFileHandle handle
export class FsaOpenFile extends FsaEntry implements OpenFile {
  public readonly fileType: number = constants.WASI_FILETYPE_REGULAR_FILE;

  private filePosition: number = 0;

  private DEBUG: boolean = false;

  public declare readonly handle: FileSystemFileHandle;

  // eslint-disable-next-line class-methods-use-this
  isatty(): boolean {
    return true;
  }

  async read(len: number): Promise<[Uint8Array, number]> {
    let handle: FileSystemFileHandle;
    let size;
    if (
      (await this.metadata()).fileType === constants.WASI_FILETYPE_SYMBOLIC_LINK
    ) {
      const file = await this.handle.getFile();
      const path = await file.text();
      const { err, entry } = await this.parent()
        .open()
        .getEntry(
          path,
          FileOrDir.File,
          LookupFlags.SymlinkFollow,
          OpenFlags.None
        );
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

  async scheduleRead(
    workerId: number,
    requestedLen: number,
    sbuf: SharedArrayBuffer
  ): Promise<void> {
    const lck = new Int32Array(sbuf, 0, 1);
    const readLen = new Int32Array(sbuf, 4, 1);
    const readBuf = new Uint8Array(sbuf, 8, requestedLen);

    const [data, err] = await this.read(requestedLen);
    if (err === 0) {
      readLen[0] = data.byteLength;
      readBuf.set(data);
    }
    Atomics.store(lck, 0, err);
    Atomics.notify(lck, 0);
  }

  // TODO: each write creates new writable, store it on creation
  async write(buffer: Uint8Array): Promise<number> {
    let handle: FileSystemFileHandle;
    if (
      (await this.metadata()).fileType === constants.WASI_FILETYPE_SYMBOLIC_LINK
    ) {
      const file = await this.handle.getFile();
      const path = await file.text();
      const { err, entry } = await this.parent()
        .open()
        .getEntry(
          path,
          FileOrDir.File,
          LookupFlags.SymlinkFollow,
          OpenFlags.None
        );
      if (err !== constants.WASI_ESUCCESS) {
        return err;
      }
      handle = entry.handle;
    } else {
      handle = this.handle;
    }

    const w = await handle.createWritable({ keepExistingData: true });
    // data passed to write function cannot have the underlying buffer as shared
    const data = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(data).set(new Uint8Array(buffer));
    await w.write({
      type: "write",
      position: this.filePosition,
      data,
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
    const writable = await this.handle.createWritable();
    await writable.write({ type: "truncate", size });
    await writable.close();
    this.filePosition = 0;
  }

  async arrayBuffer(): Promise<ArrayBufferView | ArrayBuffer> {
    return (await this.handle.getFile()).arrayBuffer();
  }

  async readableStream(): Promise<NodeJS.ReadableStream> {
    return (await this.handle.getFile()).stream();
  }

  async writableStream(): Promise<WritableStream> {
    return this.handle.createWritable();
  }
}
