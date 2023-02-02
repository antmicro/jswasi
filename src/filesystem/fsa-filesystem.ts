import {
  Filestat,
  Descriptor,
  Fdstat,
  Filesystem,
  Rights,
  Fdflags,
  Fstflags,
  Timestamp,
  Whence,
  Dirent,
  OpenFlags,
  LookupFlags,
} from "./filesystem";
import { msToNs } from "../utils";
import * as constants from "../constants";
import { getStoredData, setStoredData } from "./metadata";

class FsaFilesystem implements Filesystem {
  private rootHandle: FileSystemDirectoryHandle;

  private async getRootHandle(): Promise<FileSystemDirectoryHandle> {
    return this.rootHandle;
  }

  constructor(rootHandle: FileSystemDirectoryHandle) {
    this.rootHandle = rootHandle;
  }

  /**
   * Returns wasi error code corresponding to a given DOMException
   *
   * @param e - DOMException instance
   * @param isDir - some error variants differ depending on whether a directory or a file was requested
   *
   * @returns wasi error code
   */
  private static mapErr(e: DOMException, isDir: boolean): number {
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
      default:
        return constants.WASI_EINVAL;
    }
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
      start_handle === undefined ? await this.getRootHandle() : start_handle;
    try {
      start = 1;
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
      if (isDir) {
        __handle = await handle.getDirectoryHandle(path.slice(start));
      } else {
        __handle = await handle.getFileHandle(path.slice(start));
      }
      return {
        handle: __handle,
        err: constants.WASI_ESUCCESS,
        index: -1,
      };
    } catch (e) {
      let err = constants.WASI_EINVAL;
      if (e instanceof DOMException) {
        err = FsaFilesystem.mapErr(e, __isDir);
      }
      return { index: stop, err, handle };
    }
  }

  async createDir(path: string): Promise<number> {
    let __last_separator = path.lastIndexOf("/");
    let { err, handle } = await this.getHandle(
      path.slice(0, __last_separator),
      true,
      undefined
    );
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }
    let name = path.slice(__last_separator + 1);
    try {
      this.getHandle(name, true, handle as FileSystemDirectoryHandle);
    } catch (e) {
      let __err = constants.WASI_EINVAL;
      if (e instanceof DOMException) {
        __err = FsaFilesystem.mapErr(e, true);
      }
      switch (__err) {
        case constants.WASI_ENOENT:
          (handle as FileSystemDirectoryHandle).getDirectoryHandle(path, {
            create: true,
          });
          // TODO: fill dummy data with something meaningful
          await setStoredData(path, {
            dev: 0n,
            ino: 0n,
            filetype: constants.WASI_FILETYPE_DIRECTORY,
            nlink: 0n,
            size: 4096n,
            mtim: 0n,
            atim: 0n,
            ctim: 0n,
          });
          return constants.WASI_ESUCCESS;
        default:
          return __err;
      }
    }
    return constants.WASI_EEXIST;
  }

  async getFilestat(
    path: string
  ): Promise<{ err: number; filestat: Filestat }> {
    let storedData = await getStoredData(path);
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
      index = result.err,
      desc = undefined;
    switch (result.err) {
      // The search was succesfull and a directory was found
      case constants.WASI_ESUCCESS: {
        err = result.err;
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
            path.slice(path.lastIndexOf("/") + 1),
            true,
            result.handle as FileSystemDirectoryHandle
          );
          if (__result.err === constants.WASI_ESUCCESS) {
            if (!(oflags & constants.WASI_O_DIRECTORY)) {
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
    }
    return { err, index, desc };
  }
}

/**
 * Abstract class that holds common implementations for both FsaFileDescriptor and FsaDirectoryDescriptor
 * The sole purpose of this class is to avoid redundant Descriptor implementations
 */
abstract class FsaDescriptor implements Descriptor {
  protected fdstat: Fdstat;
  protected path: string;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights
  ) {
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
    return getStoredData(this.path);
  }

  abstract initialize(path: string): Promise<void>;
  abstract arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract read(len: number): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract read_str(): Promise<{ err: number; content: string }>;
  abstract pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract write(buffer: DataView): Promise<{ err: number; written: bigint }>;
  abstract pwrite(
    buffer: DataView,
    pos: bigint
  ): Promise<{ err: number; written: bigint }>;
  abstract seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }>;
  abstract readdir(
    refresh: boolean
  ): Promise<{ err: number; dirents: Dirent[] }>;

  async setFilestatTimes(
    fstflags: Fstflags,
    atim: Timestamp,
    mtim: Timestamp
  ): Promise<number> {
    let filestat = await getStoredData(this.path);

    const __atim =
      fstflags &
      (constants.WASI_FSTFLAGS_ATIM | constants.WASI_FSTFLAGS_ATIM_NOW);
    switch (__atim) {
      case constants.WASI_FSTFLAGS_ATIM:
        filestat.atim = atim;
        break;
      case constants.WASI_FSTFLAGS_ATIM_NOW:
        filestat.atim = msToNs(performance.now());
        break;
      case constants.WASI_FSTFLAGS_ATIM | constants.WASI_FSTFLAGS_ATIM_NOW:
        return constants.WASI_EINVAL;
    }

    const __mtim =
      fstflags &
      (constants.WASI_FSTFLAGS_MTIM | constants.WASI_FSTFLAGS_MTIM_NOW);
    switch (__mtim) {
      case constants.WASI_FSTFLAGS_MTIM:
        filestat.mtim = mtim;
        break;
      case constants.WASI_FSTFLAGS_MTIM_NOW:
        filestat.mtim = msToNs(performance.now());
      case constants.WASI_FSTFLAGS_MTIM | constants.WASI_FSTFLAGS_MTIM:
        return constants.WASI_EINVAL;
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
}

class FsaFileDescriptor extends FsaDescriptor implements Descriptor {
  private cursor: bigint;
  private handle: FileSystemFileHandle;
  private writer: FileSystemWritableFileStream;

  constructor(
    handle: FileSystemFileHandle,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights
  ) {
    super(fs_flags, fs_rights_inheriting, fs_rights_base);
    this.handle = handle;
  }

  async initialize(path: string) {
    this.path = path;
    const { filetype, size } = await getStoredData(path);
    this.fdstat.fs_filetype = filetype;
    const append = (this.fdstat.fs_flags & constants.WASI_FDFLAG_APPEND) != 0;
    if (append) {
      this.writer = await this.handle.createWritable({
        keepExistingData: true,
      });
      this.cursor = size;
    } else {
      this.writer = await this.handle.createWritable({
        keepExistingData: false,
      });
      this.cursor = 0n;
    }
  }

  /**
   * Auxiliary function for getting a file from a handle and handling errors
   */
  private async __getFile(): Promise<{ err: number; file: File }> {
    try {
      const file = await this.handle.getFile();
      return { err: constants.WASI_ESUCCESS, file };
    } catch (_) {
      return { err: constants.WASI_EACCES, file: undefined };
    }
  }

  async read(len: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    const { err, file } = await this.__getFile();
    if (err !== constants.WASI_ESUCCESS) {
      return { err, buffer: undefined };
    }

    const { size } = await getStoredData(this.path);
    const end = size < this.cursor + len ? Number(size) : this.cursor + len;
    this.cursor += end;
    return {
      err: constants.WASI_ESUCCESS,
      buffer: await file.slice(this.cursor, end).arrayBuffer(),
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
    const { size } = await getStoredData(this.path);
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
    const { size } = await getStoredData(this.path);
    switch (whence) {
      case constants.WASI_WHENCE_CUR:
        if (this.cursor + offset > size || offset < this.cursor) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor += offset;
        break;
      case constants.WASI_WHENCE_SET:
        if (Number(size) < offset || offset < 0) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor = offset;
        break;
      case constants.WASI_WHENCE_END:
        if (offset > 0 || size < -offset) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor = size - offset;
        break;
      default:
        return { offset: this.cursor, err: constants.WASI_EINVAL };
    }
    return { err: constants.WASI_ESUCCESS, offset: this.cursor };
  }

  async readdir(): Promise<{ err: number; dirents: Dirent[] }> {
    return { err: constants.WASI_ENOTDIR, dirents: undefined };
  }

  async write(buffer: DataView): Promise<{ err: number; written: bigint }> {
    await this.writer.write({
      type: "write",
      position: Number(this.cursor),
      data: buffer,
    });
    let filestat = await getStoredData(this.path);
    let written = BigInt(buffer.byteLength);
    this.cursor += written;
    filestat.size += written;
    return { err: constants.WASI_ESUCCESS, written };
  }

  async pwrite(
    buffer: DataView,
    offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    await this.writer.write({
      type: "write",
      position: Number(offset),
      data: buffer,
    });
    let filestat = await getStoredData(this.path);
    let written = BigInt(buffer.byteLength);
    filestat.size += written;
    return { err: constants.WASI_ESUCCESS, written };
  }
}

class FsaDirectoryDescriptor extends FsaDescriptor implements Descriptor {
  private handle: FileSystemDirectoryHandle;
  private entries: Dirent[];

  constructor(
    handle: FileSystemDirectoryHandle,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting);
    this.handle = handle;
    this.fdstat.fs_filetype = constants.WASI_FILETYPE_DIRECTORY;
  }

  async initialize(path: string) {
    this.path = path;
  }

  async read(_len: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EISDIR, buffer: undefined };
  }

  async read_str(): Promise<{ err: number; content: string }> {
    return { err: constants.WASI_EISDIR, content: "" };
  }

  async pread(
    _len: number,
    _pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EISDIR, buffer: undefined };
  }

  async write(_buffer: DataView): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_EISDIR, written: -1n };
  }

  async pwrite(
    _buffer: DataView,
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

  async readdir(refresh: boolean): Promise<{ err: number; dirents: Dirent[] }> {
    if (refresh) {
      this.entries = [];
      var i = 1n;
      for await (const name of this.handle.keys()) {
        if (name.endsWith(".crswap")) {
          continue;
        }
        let filestat = await getStoredData(`${this.path}/${name}`);
        this.entries.push({
          d_next: i++,
          d_ino: filestat.ino,
          d_namlen: name.length,
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
    return undefined;
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

  const rootStoredData = await getStoredData("/");
  if (!rootStoredData) {
    await setStoredData("/", {
      dev: 0n,
      ino: 0n,
      filetype: constants.WASI_FILETYPE_DIRECTORY,
      nlink: 0n,
      size: 4096n,
      atim: 0n,
      mtim: 0n,
      ctim: 0n,
    });
  }
  return new FsaFilesystem(rootHandle);
}
