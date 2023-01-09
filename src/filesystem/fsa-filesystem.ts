import { Filestat, Descriptor, Fdstat, Filesystem } from "./filesystem";
import { pathSeparators } from "../utils";
import * as constants from "../constants";

class FsaFilesystem implements Filesystem {
  private mounts: Record<string, Filesystem>;
  private async getRootHandle(): Promise<FileSystemDirectoryHandle> {
    return await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("root", { create: false });
  }

  /**
   * Returns a handle using relative or absolute path
   *
   * @param path - path that is absolute or relative to the given handle
   * @param isDir - tells if the demanded path corresponds to a file or a directory
   * @param handle - handle from which to start searching if the given path is relative
   *
   * @returns an object holding three values:
   * index - index of the last processed path separator, if the search failed this separator is the one after the component that failed, if the search succeeded it is the last separator in the path
   * err - wasi error code
   * handle - a demanded handle, if the search failed this field holds the last succesfully found handle
   */
  private async getHandle(
    path: string,
    isDir: boolean,
    handle: FileSystemDirectoryHandle = undefined
  ): Promise<{ index: number; err: number; handle: FileSystemHandle }> {
    let start, stop;
    if (path.startsWith("/")) {
      handle = await this.getRootHandle();
      start = 1;
    } else {
      if (handle === undefined) {
        handle = await this.getRootHandle();
      } else {
        handle = handle;
      }
      start = 0;
    }
    try {
      stop = path.indexOf("/", start);
      while (true) {
        handle = await handle.getDirectoryHandle(path.slice(start, stop));
        stop = path.indexOf("/", start);
        if (stop === -1) {
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
        index: undefined,
      };
    } catch (e) {
      let err = constants.WASI_EINVAL;
      if (e instanceof DOMException) {
        switch (e.name) {
          case "NotAllowedError":
            err = constants.WASI_EACCES;
            break;
          case "TypeMismatchError":
            if (isDir) {
              err = constants.WASI_ENOTDIR;
            } else {
              err = constants.WASI_EISDIR;
            }
          case "NotFoundError":
            err = constants.WASI_ENOENT;
            break;
        }
      }
      return { index: start, err, handle };
    }
  }

  getMounts(): Record<string, Filesystem> {
    return this.mounts;
  }

  async addMount(path: string, filesystem: Filesystem): Promise<number> {
    let { index, err, handle } = await this.getHandle(path, true);
    if (err === constants.WASI_ENOENT) {
      let mountPoint = this.mounts[path.slice(0, index)];
      if (mountPoint === undefined) {
        return constants.WASI_ENOENT;
      } else {
        return mountPoint.addMount(path.slice(index + 1), filesystem);
      }
    } else if (err !== constants.WASI_ESUCCESS) {
      return err;
    } else {
      if ((handle as FileSystemDirectoryHandle).entries().next === undefined) {
        this.mounts[path] = filesystem;
        return constants.WASI_ESUCCESS;
      } else {
        return constants.WASI_ENOTEMPTY;
      }
    }
  }

  async removeMount(path: string): Promise<number> {
    if (this.mounts[path] == undefined) {
      return constants.WASI_EINVAL;
    } else {
      delete this.mounts[path];
      return constants.WASI_ESUCCESS;
    }
  }

  async createDir(path: string): Promise<number> {
    let { index, err, handle } = await this.getHandle(
      path.slice(0, path.lastIndexOf("/")),
      true
    );
    if (err === constants.WASI_ENOENT) {
      let mountPoint = this.mounts[path.slice(0, index)];
      if (mountPoint === undefined) {
        return err;
      } else {
        return mountPoint.createDir(path.slice(index + 1));
      }
    } else if (err !== constants.WASI_ESUCCESS) {
      return err;
    } else {
      let __path = path.slice(index + 1);
      let { err: e } = await this.getHandle(
        __path,
        true,
        handle as FileSystemDirectoryHandle
      );
      switch (e) {
        case constants.WASI_ENOENT:
          try {
            await (handle as FileSystemDirectoryHandle).getDirectoryHandle(
              __path,
              { create: true }
            );
            return constants.WASI_ESUCCESS;
          } catch (_) {
            return constants.WASI_EACCES;
          }
        case constants.WASI_ESUCCESS:
        case constants.WASI_ENOTDIR:
          return constants.WASI_EEXIST;
        default:
          return e;
      }
    }
  }
}
