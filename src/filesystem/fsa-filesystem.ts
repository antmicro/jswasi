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
} from "./filesystem";
import * as constants from "../constants";
import { getStoredData, setStoredData } from "./metadata";

class FsaFilesystem implements Filesystem {
  private async getRootHandle(): Promise<FileSystemDirectoryHandle> {
    return await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("root", { create: false });
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
    let start, stop;
    let handle =
      start_handle === undefined ? await this.getRootHandle() : start_handle;
    start = 1;
    try {
      stop = path.indexOf("/", start);
      while (true) {
        // TODO: can fsa api handle .. and .?
        handle = await handle.getDirectoryHandle(path.slice(start, stop));
        stop = path.indexOf("/", start);
        if (stop === -1) {
          start = -1;
          break;
        }
        start = stop + 1;
      }
      let __handle;
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
        err = FsaFilesystem.mapErr(e, isDir);
      }
      return { index: start, err, handle };
    }
  }

  async createDir(path: string): Promise<number> {
    let { index, err, handle } = await this.getHandle(
      path.slice(0, path.lastIndexOf("/")),
      true,
      undefined
    );
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }
    let __path = path.slice(index + 1);
    try {
      this.getHandle(__path, true, handle as FileSystemDirectoryHandle);
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
}

class FsaFileDescriptor implements Descriptor {
  private cursor: number;
  private handle: FileSystemFileHandle;
  private path: string;
  private fdstat: Fdstat;

  constructor(
    handle: FileSystemFileHandle,
    fs_flags: Fdflags,
    fs_rights_inheriting: Rights,
    fs_rights_base: Rights
  ) {
    this.handle = handle;
    this.fdstat = {
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      fs_filetype: undefined,
    };
  }

  async initialize(path: string) {
    this.path = path;
    const { filetype } = await getStoredData(path);
    this.fdstat.fs_filetype = filetype;
  }

  async getFdstat(): Promise<Fdstat> {
    return this.fdstat;
  }

  async getFilestat(): Promise<Filestat> {
    return getStoredData(this.path);
  }
}
