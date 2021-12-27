// @ts-ignore - different path structure in dist folder
import { get, set, del } from "./vendor/idb-keyval.js";
import * as constants from "./constants.js";
import { parsePath, arraysEqual } from "./utils.js";
import { OpenedFd } from "./devices.js";

// Specifies open mode for getting a filesystem entry
export const enum FileOrDir {
  // Only open if it's a file
  File = 1,
  // Only open if it's a directory
  Directory = 2,
  // Open either file or directory
  Any = 3,
}

// Open flags used by path_open.
export const enum OpenFlags {
  // If none of the flags shouldn't be set
  None = 0,
  // Create file if it doesn't exist. Value of constants.WASI_O_CREAT.
  Create = 1,
  // Fail if not a directory. Value of constants.WASI_O_DIRECTORY.
  Directory = 2,
  // Fail if file already exists. Value of constants.WASI_O_EXCL.
  Exclusive = 4,
  // Truncate file to size 0. Value of constants.WASI_O_TRUNC.
  Truncate = 8,
}

// Flags determining the method of how paths are resolved.
export const enum LookupFlags {
  // Don't follow symbolic links, return symbolic file itself
  NoFollow = 0,
  // As long as the resolved path corresponds to a symbolic link, it is expanded.
  SymlinkFollow = 1,
}

// File descriptor rights, determining which actions may be performed.
export const enum Rights {
  None = 0,
  // The right to invoke fd_datasync. If path_open is set, includes the right to invoke path_open with fdflags::dsync.
  FdDatasync = 1 << 0,
  // The right to invoke fd_read and sock_recv. If rights::fd_seek is set, includes the right to invoke fd_pread.
  FdRead = 1 << 1,
  // The right to invoke fd_seek. This flag implies rights::fd_tell.
  FdSeek = 1 << 2,
  // The right to invoke fd_fdstat_set_flags.
  FdFdstatSetFlags = 1 << 3,
  // The right to invoke fd_sync. If path_open is set, includes the right to invoke path_open with fdflags::rsync and fdflags::dsync.
  FdSync = 1 << 4,
  // The right to invoke fd_seek in such a way that the file offset remains unaltered (i.e., whence::cur with offset zero), or to invoke fd_tell.
  FdTell = 1 << 5,
  // The right to invoke fd_write and sock_send. If rights::fd_seek is set, includes the right to invoke fd_pwrite.
  FdWrite = 1 << 6,
  // The right to invoke fd_advise.
  FdAdvise = 1 << 7,
  // The right to invoke fd_allocate.
  FdAllocate = 1 << 8,
  // The right to invoke path_create_directory.
  PathCreateDirectory = 1 << 9,
  // If path_open is set, the right to invoke path_open with oflags::creat.
  PathCreateFile = 1 << 10,
  // The right to invoke path_link with the file descriptor as the source directory.
  PathLinkSource = 1 << 11,
  // The right to invoke path_link with the file descriptor as the target directory.
  PathLinkTarget = 1 << 12,
  // The right to invoke path_open.
  PathOpen = 1 << 13,
  // The right to invoke fd_readdir.
  FdReadDir = 1 << 14,
  // The right to invoke path_readlink.
  PathReadLink = 1 << 15,
  // The right to invoke path_rename with the file descriptor as the source directory.
  PathRenameSource = 1 << 16,
  // The right to invoke path_rename with the file descriptor as the target directory.
  PathRenameTarget = 1 << 17,
  // The right to invoke path_filestat_get.
  PathFilestatGet = 1 << 18,
  // The right to change a file's size (there is no path_filestat_set_size).
  // If path_open is set, includes the right to invoke path_open with oflags::trunc.
  PathFilestatSetSize = 1 << 19,
  // The right to invoke path_filestat_set_times.
  PathFilestatSetTimes = 1 << 20,
  // The right to invoke fd_filestat_get.
  FdFilestatGet = 1 << 21,
  // The right to invoke fd_filestat_set_size.
  FdFilestatSetSize = 1 << 22,
  // The right to invoke fd_filestat_set_times.
  FdFilestatSetTimes = 1 << 23,
  // The right to invoke path_symlink.
  PathSymlink = 1 << 24,
  //  The right to invoke path_remove_directory.
  PathRemoveDirectory = 1 << 25,
  // The right to invoke path_unlink_file.
  PathUnlinkFile = 1 << 26,
  // If rights::fd_read is set, includes the right to invoke poll_oneoff to subscribe to eventtype::fd_read.
  // If rights::fd_write is set, includes the right to invoke poll_oneoff to subscribe to eventtype::fd_write.
  PollFdReadWrite = 1 << 27,
  // The right to invoke sock_shutdown.
  SockShutdown = 1 << 28,
}

// File descriptor flags.
export const enum FdFlags {
  None = 0,
  // Append mode: Data written to the file is always appended to the file's end.
  Append = 1 << 0,
  // Write according to synchronized I/O data integrity completion. Only the data stored in the file is synchronized.
  DSync = 1 << 1,
  // Non-blocking mode.
  NonBlock = 1 << 2,
  // Synchronized read I/O operations.
  RSync = 1 << 3,
  // Write according to synchronized I/O file integrity completion.
  // In addition to synchronizing the data stored in the file, the implementation may also synchronously update the file's metadata.
  Sync = 1 << 4,
}

// Data about a file or directory stored persistently
export type StoredData = {
  // file type
  fileType: number;
  // read-write-execute permissions of user
  userMode: number;
  // read-write-execute permissions of group
  groupMode: number;
  // user ID of owner
  uid: number;
  // group ID of owner
  gid: number;
  // access time
  atim: bigint;
  // modification time
  mtim: bigint;
  // change time
  ctim: bigint;
};

// All metadata about a file or directory
export type Metadata = {
  // ID of device containing file
  dev: bigint;
  // inode number (always 0)
  ino: bigint;
  // file type
  fileType: number;
  // read-write-execute permissions of user
  userMode: number;
  // read-write-execute permissions of group
  groupMode: number;
  // number of hard links (always 0)
  nlink: bigint;
  // user ID of owner
  uid: number;
  // group ID of owner
  gid: number;
  // device ID (if special file)
  rdev: number;
  // total size, in bytes
  size: bigint;
  // block size for filesystem I/O
  blockSize: number;
  // number of 512B blocks allocated
  blocks: number;
  // access time
  atim: bigint;
  // modification time
  mtim: bigint;
  // change time
  ctim: bigint;
};

// Data returned about a file or directory in various syscalls
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
    options: { create: boolean } = { create: false },
    lookupFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
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
    // TODO: should also consider getFileHandle in case it's a symlink
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

    if (
      metadata.fileType === constants.WASI_FILETYPE_SYMBOLIC_LINK &&
      lookupFlags & LookupFlags.SymlinkFollow
    ) {
      // TODO: use this err, function return type should be Promise<{ err: number, dir: Directory}>
      const { err, linkedPath } = await dir.readlink(path);
      return this.getDirectory(
        dir,
        linkedPath,
        options,
        lookupFlags,
        openFlags,
        fsRightsBase,
        fsRightsInheriting,
        fdFlags
      );
    }

    return new Directory(name, path, handle, dir, this);
  }

  async getFile(
    dir: Directory,
    name: string,
    options: { create: boolean } = { create: false },
    lookupFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
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

    if (
      metadata.fileType === constants.WASI_FILETYPE_SYMBOLIC_LINK &&
      lookupFlags & LookupFlags.SymlinkFollow
    ) {
      // TODO: use this err, function return type should be Promise<{ err: number, dir: Directory}>
      const { err, linkedPath } = await dir.readlink(path);
      return this.getFile(
        dir,
        linkedPath,
        options,
        lookupFlags,
        openFlags,
        fsRightsBase,
        fsRightsInheriting,
        fdFlags
      );
    }

    return new File(name, path, handle, dir, this);
  }

  async pathExists(
    absolutePath: string,
    mode: FileOrDir = FileOrDir.Any
  ): Promise<boolean> {
    const { err } = await this.rootDir.getEntry(
      absolutePath,
      mode,
      LookupFlags.NoFollow,
      OpenFlags.None
    );
    return err === constants.WASI_ESUCCESS;
  }

  async addMount(
    absolutePath: string,
    mountedHandle: FileSystemDirectoryHandle
  ): Promise<number> {
    const { parts, name } = parsePath(absolutePath);
    const parent = await this.rootDir.getEntry(
      parts.join("/"),
      FileOrDir.Directory,
      LookupFlags.SymlinkFollow,
      OpenFlags.None
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
      await set(entry.path, metadata);
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
  ): Promise<{ err: number; entry: File }>;

  // eslint-disable-next-line no-dupe-class-members
  getEntry(
    path: string,
    mode: FileOrDir.Directory,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: Directory }>;

  // eslint-disable-next-line no-dupe-class-members
  getEntry(
    path: string,
    mode: FileOrDir,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: File | Directory }>;

  // eslint-disable-next-line no-dupe-class-members
  async getEntry(
    path: string,
    mode: FileOrDir,
    dirFlags: LookupFlags = LookupFlags.SymlinkFollow,
    openFlags: OpenFlags = OpenFlags.None,
    fsRightsBase: Rights = Rights.None,
    fsRightsInheriting: Rights = Rights.None,
    fdFlags: FdFlags = FdFlags.None
  ): Promise<{ err: number; entry: File | Directory }> {
    if (this.filesystem.DEBUG)
      console.log("Directory.getEntry", this, arguments);

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

    if (openFlags & OpenFlags.Directory) {
      mode = FileOrDir.Directory;
    }

    const open = async (
      create: boolean
    ): Promise<{ err: number; entry: File | Directory }> => {
      if (mode & FileOrDir.File) {
        try {
          const entry = await this.filesystem.getFile(
            parent,
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
        const entry = await this.filesystem.getDirectory(
          parent,
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
        return { err: constants.WASI_ESUCCESS, entry };
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
    let entry: File | Directory;
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
      const { err, entry } = await this.parent.getEntry(
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
      const { err, entry } = await this.parent.getEntry(
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
