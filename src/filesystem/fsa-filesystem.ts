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
}
