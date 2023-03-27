import {
  Filestat,
  Descriptor,
  Fdstat,
  Filesystem,
  Rights,
  Fdflags,
  Timestamp,
  Whence,
  Dirent,
  OpenFlags,
  LookupFlags,
} from "./filesystem.js";
import { basename, dirname } from "../utils.js";
import * as constants from "../constants.js";
import { delStoredData, getStoredData, setStoredData } from "./metadata.js";

async function initMetadataPath(handle: FileSystemHandle): Promise<string> {
  const components = await (
    await navigator.storage.getDirectory()
  ).resolve(handle);
  return components.join("/");
}

/**
 * Returns wasi error code corresponding to a given DOMException
 *
 * @param e - DOMException instance
 * @param isDir - some error variants differ depending on whether a directory or a file was requested
 *
 * @returns wasi error code
 */
function mapErr(e: DOMException, isDir: boolean): number {
  switch (e.name) {
    case "NotAllowedError":
      return constants.WASI_EACCES;
    case "TypeMismatchError":
      if (isDir) {
        return constants.WASI_ENOTDIR;
      } else {
        return constants.WASI_EISDIR;
      }
    case "NotFoundError":
      return constants.WASI_ENOENT;
    case "InvalidModificationError":
      return constants.WASI_ENOTEMPTY;
    default:
      return constants.WASI_EINVAL;
  }
}

class FsaFilesystem implements Filesystem {
  private rootHandle: FileSystemDirectoryHandle;

  private getRootHandle(): FileSystemDirectoryHandle {
    return this.rootHandle;
  }

  constructor(rootHandle: FileSystemDirectoryHandle) {
    this.rootHandle = rootHandle;
  }

  /**
   * Returns a handle using relative or absolute path
   *
   * @param path - path that is absolute or relative to the given handle
   * @param isDir - tells if the demanded path corresponds to a file or a directory
   * @param start_handle - handle from which to start searching if the given path is relative
   *
   * @returns an object holding three values:
   * index - index of the last processed path separator, if the search failed this separator is the one after the component that failed, however if the search succeeded it is equal to -1
   * err - wasi error code
   * handle - a demanded handle, if the search failed this field holds the last succesfully found handle
   */
  private async getHandle(
    path: string,
    isDir: boolean,
    start_handle: FileSystemDirectoryHandle
  ): Promise<{ index: number; err: number; handle: FileSystemHandle }> {
    let stop,
      start,
      __isDir = true;
    let handle =
      start_handle === undefined ? this.getRootHandle() : start_handle;
    try {
      if (path.startsWith("/")) {
        start = 1;
      } else {
        start = 0;
      }
      for (
        stop = path.indexOf("/", start);
        stop != -1;
        stop = path.indexOf("/", start)
      ) {
        // TODO: can fsa api handle .. and .?
        handle = await handle.getDirectoryHandle(path.slice(start, stop));
        start = stop + 1;
      }
      let __handle;
      __isDir = isDir;
      let component = path.slice(start);
      if (component === "") {
        __handle = handle;
      } else if (isDir) {
        __handle = await handle.getDirectoryHandle(component);
      } else {
        __handle = await handle.getFileHandle(component);
      }
      return {
        handle: __handle,
        err: constants.WASI_ESUCCESS,
        index: -1,
      };
    } catch (e) {
      let err = constants.WASI_EINVAL;
      if (e instanceof DOMException) {
        err = mapErr(e, __isDir);
      }
      return { index: stop, err, handle };
    }
  }

  async unlinkat(
    desc: Descriptor,
    path: string,
    is_dir: boolean
  ): Promise<number> {
    let start_handle = undefined;
    if (desc !== undefined) {
      if (desc instanceof FsaDirectoryDescriptor) {
        start_handle = desc.handle;
      } else {
        return constants.WASI_EINVAL;
      }
    }
    let { err, handle } = await this.getHandle(
      dirname(path),
      true,
      start_handle
    );
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }
    let name = basename(path);
    try {
      // check if deleted entry matches given type
      // TODO: does leaving it unchecked make sense?
      let __err = (
        await this.getHandle(name, is_dir, handle as FileSystemDirectoryHandle)
      ).err;
      if (__err !== constants.WASI_ESUCCESS) {
        return __err;
      }
      (handle as FileSystemDirectoryHandle).removeEntry(name, {
        recursive: false,
      });
      await delStoredData(`${await initMetadataPath(handle)}/${path}`);
      return constants.WASI_ESUCCESS;
    } catch (e) {
      let __err = constants.WASI_EINVAL;
      if (e instanceof DOMException) {
        __err = mapErr(e, true);
      }
      return __err;
    }
  }

  async mkdirat(desc: Descriptor, path: string): Promise<number> {
    let start_handle = undefined;
    if (desc !== undefined) {
      if (desc instanceof FsaDirectoryDescriptor) {
        start_handle = desc.handle;
      } else {
        return constants.WASI_EINVAL;
      }
    }
    let { err, handle } = await this.getHandle(
      dirname(path),
      true,
      start_handle
    );
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }
    let name = basename(path);
    ({ err } = await this.getHandle(
      name,
      true,
      handle as FileSystemDirectoryHandle
    ));
    if (err === constants.WASI_ESUCCESS) {
      return constants.WASI_EEXIST;
    }
    if (err !== constants.WASI_ENOENT) {
      return err;
    }
    handle = await (handle as FileSystemDirectoryHandle).getDirectoryHandle(
      path,
      {
        create: true,
      }
    );
    await setStoredData(await initMetadataPath(handle), {
      dev: 0n,
      ino: 0n,
      filetype: constants.WASI_FILETYPE_DIRECTORY,
      nlink: 1n,
      size: 4096n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    });
    return constants.WASI_ESUCCESS;
  }

  async symlinkat(
    target: string,
    desc: Descriptor,
    linkpath: string
  ): Promise<number> {
    let start_handle;
    if (desc !== undefined) {
      if (desc instanceof FsaDirectoryDescriptor) {
        start_handle = desc.handle;
      } else {
        return constants.WASI_EINVAL;
      }
    }
    let { err, handle } = await this.getHandle(
      dirname(linkpath),
      true,
      start_handle
    );
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }
    let name = basename(linkpath);
    ({ err } = await this.getHandle(
      name,
      false,
      handle as FileSystemDirectoryHandle
    ));
    if (err === constants.WASI_ESUCCESS || err === constants.WASI_EISDIR) {
      return constants.WASI_EEXIST;
    }
    if (err !== constants.WASI_ENOENT) {
      return err;
    }
    let symlink = await (handle as FileSystemDirectoryHandle).getFileHandle(
      linkpath,
      {
        create: true,
      }
    );
    let symlink_writable = await symlink.createWritable();
    await symlink_writable.write(target);
    await symlink_writable.close();

    // TODO: fill dummy data with something meaningful
    await setStoredData(await initMetadataPath(symlink), {
      dev: 0n,
      ino: 0n,
      filetype: constants.WASI_FILETYPE_SYMBOLIC_LINK,
      nlink: 1n,
      size: BigInt(target.length),
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    });
    return constants.WASI_ESUCCESS;
  }

  async getFilestat(
    path: string
  ): Promise<{ err: number; filestat: Filestat }> {
    let metadataPath = this.getRootHandle().name + path;
    let storedData = await getStoredData(metadataPath);
    return { err: constants.WASI_ESUCCESS, filestat: storedData };
  }

  async open(
    path: string,
    dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags
  ): Promise<{ err: number; index: number; desc: Descriptor }> {
    let result = await this.getHandle(path, true, undefined);
    let err = result.err,
      index = result.index,
      desc = undefined;
    switch (err) {
      // The search was succesfull and a directory was found
      case constants.WASI_ESUCCESS: {
        if (oflags & constants.WASI_O_CREAT) {
          if (oflags & constants.WASI_O_EXCL) {
            err = constants.WASI_EEXIST;
          } else {
            err = constants.WASI_EISDIR;
          }
        } else {
          err = result.err;
        }
        index = result.index;
        desc = new FsaDirectoryDescriptor(
          result.handle as FileSystemDirectoryHandle,
          fdflags,
          fs_rights_base,
          fs_rights_inheriting
        );
        break;
      }
      case constants.WASI_ENOTDIR: {
        if (index === -1) {
          // the last component of the path caused an ENOTDIR error
          if (
            oflags & constants.WASI_O_DIRECTORY &&
            !(dirflags & constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW)
          ) {
            // directory was demanded and symlink follow is disabled - no point in further search
            break;
          }
          const __result = await this.getHandle(
            basename(path),
            false,
            result.handle as FileSystemDirectoryHandle
          );
          if (__result.err === constants.WASI_ESUCCESS) {
            if (
              oflags & constants.WASI_O_CREAT &&
              oflags & constants.WASI_O_EXCL
            ) {
              // The requested file already exists, while CREAT and EXCL are requested
              // TODO: this check should rather be a part of top level fs
              err = constants.WASI_EEXIST;
            } else if (!(oflags & constants.WASI_O_DIRECTORY)) {
              // Indicate that the demanded path might be a symlink
              // It is up to the top level fs to find out if the file is a symlink
              // If user demanded a directory and a regular file was found, the search continues
              // as that file might be a symlink that can be resolved to a directory
              err = __result.err;
            }
            desc = new FsaFileDescriptor(
              __result.handle as FileSystemFileHandle,
              fdflags,
              fs_rights_base,
              fs_rights_inheriting
            );
          }
          break;
        } else if (dirflags & constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW) {
          // If some component in the middle of the path is not a directory, it might be
          // a symlink, if symlink follow flag is set, return a descriptor to the symlink
          const __result = await this.getHandle(
            path.slice(index + 1),
            false,
            result.handle as FileSystemDirectoryHandle
          );
          if (__result.err === constants.WASI_ESUCCESS) {
            desc = new FsaFileDescriptor(
              __result.handle as FileSystemFileHandle,
              fdflags,
              fs_rights_base,
              fs_rights_inheriting
            );
            break;
          }
        }
      }
      case constants.WASI_ENOENT: {
        // the last path component is the only one to fail
        // if O_CREAT is set, create the file
        if (oflags & constants.WASI_O_CREAT && index === -1) {
          try {
            const handle = await (
              result.handle as FileSystemDirectoryHandle
            ).getFileHandle(basename(path), {
              create: true,
            });
            err = constants.WASI_ESUCCESS;
            desc = new FsaFileDescriptor(
              handle,
              fdflags,
              fs_rights_base,
              fs_rights_inheriting
            );
            desc.metadataPath = await initMetadataPath(handle);
            await setStoredData(desc.metadataPath, {
              dev: 0n,
              ino: 0n,
              filetype: constants.WASI_FILETYPE_REGULAR_FILE,
              nlink: 1n,
              size: 0n,
              mtim: 0n,
              atim: 0n,
              ctim: 0n,
            });
          } catch (e) {
            if (e instanceof DOMException) {
              err = mapErr(e, false);
            } else {
              err = constants.WASI_EINVAL;
            }
          }
        }
        break;
      }
    }

    return { err, index, desc };
  }
  async renameat(
    _oldDesc: Descriptor,
    _oldPath: string,
    _newDesc: Descriptor,
    _newPath: string
  ): Promise<number> {
    // Filesystem Access API doesn't support renaming entries at this point
    // This feature is now under development, it's progress can be tracked here
    // https://chromestatus.com/feature/5640802622504960
    // Once it is stabilized, this implementation should use it
    // EXDEV indicates that user attempted to move files between mount points
    // most userspace apps will handle it by copying source and then removing it
    return constants.WASI_EXDEV;
  }
}

/**
 * Abstract class that holds common implementations for both FsaFileDescriptor and FsaDirectoryDescriptor
 * The sole purpose of this class is to avoid redundant Descriptor implementations
 */
abstract class FsaDescriptor implements Descriptor {
  protected fdstat: Fdstat;
  protected path: string;
  metadataPath: string;
  protected abstract handle: FileSystemHandle;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights
  ) {
    this.metadataPath = "";
    this.fdstat = {
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      fs_filetype: undefined,
    };
  }

  getPath(): string {
    return this.path;
  }

  async getFdstat(): Promise<Fdstat> {
    return this.fdstat;
  }

  async getFilestat(): Promise<Filestat> {
    return getStoredData(this.metadataPath);
  }

  async initialize(path: string): Promise<void> {
    this.path = path;
    if (this.metadataPath === "") {
      this.metadataPath = await initMetadataPath(this.handle);
    }
  }

  abstract read(len: number): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract read_str(): Promise<{ err: number; content: string }>;
  abstract arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }>;
  abstract pwrite(
    buffer: ArrayBuffer,
    pos: bigint
  ): Promise<{ err: number; written: bigint }>;
  abstract seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }>;
  abstract readdir(
    refresh: boolean
  ): Promise<{ err: number; dirents: Dirent[] }>;
  abstract writableStream(): Promise<{ err: number; stream: WritableStream }>;
  abstract truncate(size: bigint): Promise<number>;

  async setFilestatTimes(atim: Timestamp, mtim: Timestamp): Promise<number> {
    let filestat = await getStoredData(this.metadataPath);

    if (atim !== undefined) filestat.atim = atim;
    if (mtim !== undefined) filestat.mtim = mtim;

    if (atim !== undefined || mtim !== undefined) {
      await setStoredData(this.metadataPath, filestat);
    }

    return constants.WASI_ESUCCESS;
  }

  async setFdstatRights(rights_b: Rights, rights_i: Rights): Promise<number> {
    this.fdstat.fs_rights_base = rights_b;
    this.fdstat.fs_rights_inheriting = rights_i;
    return constants.WASI_ESUCCESS;
  }

  async setFdstatFlags(flags: Fdflags): Promise<number> {
    this.fdstat.fs_flags = flags;
    return constants.WASI_ESUCCESS;
  }

  async close(): Promise<number> {
    return constants.WASI_ESUCCESS;
  }

  isatty(): boolean {
    return false;
  }
}

class FsaFileDescriptor extends FsaDescriptor implements Descriptor {
  private cursor: bigint;
  private writer: FileSystemWritableFileStream;
  private file: File;
  override handle: FileSystemFileHandle;

  constructor(
    handle: FileSystemFileHandle,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting);
    this.handle = handle;
    this.file = undefined;
  }

  override async initialize(path: string) {
    await super.initialize(path);
    const { filetype } = await getStoredData(this.metadataPath);
    const size = BigInt((await this.__getFile()).file?.size);
    this.fdstat.fs_filetype = filetype;
    if (this.fdstat.fs_flags & constants.WASI_FDFLAG_APPEND) {
      this.cursor = size;
    } else {
      this.cursor = 0n;
    }
  }

  async getWriter(): Promise<FileSystemWritableFileStream> {
    if (!this.writer) {
      this.writer = await this.handle.createWritable({
        keepExistingData: true,
      });
    }
    return this.writer;
  }

  /**
   * Auxiliary function for getting a file from a handle and handling errors
   */
  private async __getFile(): Promise<{ err: number; file: File }> {
    if (!this.file) {
      try {
        const file = await this.handle.getFile();
        this.file = file;
        return { err: constants.WASI_ESUCCESS, file };
      } catch (_) {
        return { err: constants.WASI_EACCES, file: undefined };
      }
    }
    return { err: constants.WASI_ESUCCESS, file: this.file };
  }

  async read(len: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    const { err, file } = await this.__getFile();
    if (err !== constants.WASI_ESUCCESS) {
      return { err, buffer: undefined };
    }

    const end = Number(this.cursor) + len;
    const buffer = await file
      .slice(Number(this.cursor), Number(end))
      .arrayBuffer();
    this.cursor += BigInt(buffer.byteLength);
    return {
      err: constants.WASI_ESUCCESS,
      buffer,
    };
  }

  async read_str(): Promise<{ err: number; content: string }> {
    const { err, file } = await this.__getFile();
    if (err !== constants.WASI_ESUCCESS) {
      return { err, content: undefined };
    }
    return { err: constants.WASI_ESUCCESS, content: await file.text() };
  }

  async pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    const { err, file } = await this.__getFile();
    if (err !== constants.WASI_ESUCCESS) {
      return { err, buffer: undefined };
    }
    const size = BigInt((await this.__getFile()).file?.size);
    const end = size < pos + BigInt(len) ? size : this.cursor + BigInt(len);
    return {
      err: constants.WASI_ESUCCESS,
      buffer: await file.slice(Number(this.cursor), Number(end)).arrayBuffer(),
    };
  }

  async seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    const size = BigInt((await this.__getFile()).file?.size);
    switch (whence) {
      case constants.WASI_WHENCE_CUR:
        if (this.cursor + offset < 0n) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor += offset;
        break;
      case constants.WASI_WHENCE_SET:
        if (offset < 0n) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor = offset;
        break;
      case constants.WASI_WHENCE_END:
        if (size < -offset) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor = size + offset;
        break;
      default:
        return { offset: this.cursor, err: constants.WASI_EINVAL };
    }
    return { err: constants.WASI_ESUCCESS, offset: this.cursor };
  }

  async readdir(): Promise<{ err: number; dirents: Dirent[] }> {
    return { err: constants.WASI_ENOTDIR, dirents: undefined };
  }

  async write(buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    await (
      await this.getWriter()
    ).write({
      type: "write",
      position: Number(this.cursor),
      data: buffer,
    });
    let written = BigInt(buffer.byteLength);
    this.cursor += written;
    return { err: constants.WASI_ESUCCESS, written };
  }

  async pwrite(
    buffer: ArrayBuffer,
    offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    await (
      await this.getWriter()
    ).write({
      type: "write",
      position: Number(offset),
      data: buffer,
    });
    let written = BigInt(buffer.byteLength);
    return { err: constants.WASI_ESUCCESS, written };
  }

  async writableStream(): Promise<{ err: number; stream: WritableStream }> {
    return { err: constants.WASI_ESUCCESS, stream: await this.getWriter() };
  }

  async truncate(size: bigint): Promise<number> {
    try {
      await (
        await this.getWriter()
      ).write({ type: "truncate", size: Number(size) });
    } catch (e) {
      if (e instanceof DOMException) {
        return mapErr(e, false);
      }
      return constants.WASI_EINVAL;
    }
    await this.flush();
    this.cursor = 0n;
    return constants.WASI_ESUCCESS;
  }

  async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    let buffer = await (await this.handle.getFile()).arrayBuffer();
    return { err: constants.WASI_ESUCCESS, buffer };
  }

  async flush(): Promise<void> {
    if (this.writer) {
      let __promise = this.writer?.close();
      this.writer = null;
      // prevent other processes from closing the same descriptor
      // TODO: is mutex necessary here?
      await __promise;
    }
  }
  override async close(): Promise<number> {
    await this.flush();
    return constants.WASI_ESUCCESS;
  }

  override async getFilestat() {
    let meta = await getStoredData(this.metadataPath);
    meta.size = BigInt((await this.__getFile()).file?.size);
    return meta;
  }
}

class FsaDirectoryDescriptor extends FsaDescriptor implements Descriptor {
  private entries: Dirent[];
  override handle: FileSystemDirectoryHandle;

  constructor(
    handle: FileSystemDirectoryHandle,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting);
    this.handle = handle;
    this.fdstat.fs_filetype = constants.WASI_FILETYPE_DIRECTORY;
    this.entries = [];
  }

  async read(_len: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EISDIR, buffer: undefined };
  }

  async read_str(): Promise<{ err: number; content: string }> {
    return { err: constants.WASI_EISDIR, content: "" };
  }

  async writableStream(): Promise<{ err: number; stream: WritableStream }> {
    return { err: constants.WASI_EISDIR, stream: undefined };
  }

  async pread(
    _len: number,
    _pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EISDIR, buffer: undefined };
  }

  async write(_buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_EISDIR, written: -1n };
  }

  async pwrite(
    _buffer: ArrayBuffer,
    _offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_EISDIR, written: -1n };
  }

  async seek(
    _offset: bigint,
    _whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    return { err: constants.WASI_EISDIR, offset: -1n };
  }

  async truncate(_size: bigint): Promise<number> {
    return constants.WASI_EISDIR;
  }

  async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EISDIR, buffer: undefined };
  }

  async readdir(refresh: boolean): Promise<{ err: number; dirents: Dirent[] }> {
    if (refresh || this.entries.length === 0) {
      this.entries = [];
      var i = 1n;
      for await (const name of this.handle.keys()) {
        if (name.endsWith(".crswap")) {
          continue;
        }
        let filestat = await getStoredData(`${this.metadataPath}/${name}`);
        this.entries.push({
          d_next: i++,
          d_ino: filestat.ino,
          name,
          d_type: filestat.filetype,
        });
      }
    }
    return { err: constants.WASI_ESUCCESS, dirents: this.entries };
  }
}

export async function createFsaFilesystem(
  name: string
): Promise<FsaFilesystem> {
  const topLevelHandle = await navigator.storage.getDirectory();
  let rootHandle;
  try {
    rootHandle = await topLevelHandle.getDirectoryHandle(name);
  } catch (e) {
    if (
      e instanceof DOMException &&
      (e as DOMException).name == "NotFoundError"
    ) {
      rootHandle = await topLevelHandle.getDirectoryHandle(name, {
        create: true,
      });
    } else {
      return undefined;
    }
  }

  const rootStoredData = await getStoredData(name);
  if (!rootStoredData) {
    await setStoredData(name, {
      dev: 0n,
      ino: 0n,
      filetype: constants.WASI_FILETYPE_DIRECTORY,
      nlink: 1n,
      size: 4096n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    });
  }
  return new FsaFilesystem(rootHandle);
}
