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

  getMounts(): Record<string, Filesystem> {
    return this.mounts;
  }

  async addMount(path: string, filesystem: Filesystem): Promise<number> {
    const indices = pathSeparators(path);
    let handle = await this.getRootHandle();
    for (let i = 0; i < indices.length - 1; i++) {
      try {
        handle = await handle.getDirectoryHandle(
          path.slice(indices[i] + 1, indices[i + 1])
        );
      } catch (e) {
        if (e instanceof DOMException) {
          switch (e.name) {
            case "NotAllowedError":
              return constants.WASI_EACCES;
            case "TypeMismatchError":
              return constants.WASI_ENOTDIR;
            case "NotFoundError":
              const __path = path.slice(0, indices[i]);
              let mountPoint = this.mounts[__path];
              if (mountPoint === undefined) {
                return constants.WASI_ENOENT;
              } else {
                return mountPoint.addMount(path.slice(indices[i]), filesystem);
              }
          }
        } else {
          return constants.WASI_EINVAL;
        }
      }
    }
    if (handle.entries().next() !== undefined) {
      this.mounts[path] = filesystem;
      return constants.WASI_ESUCCESS;
    } else {
      return constants.WASI_ENOTEMPTY;
    }
  }

  async removeMount(path: Uint8Array): Promise<number> {
    const decoded = new TextDecoder().decode(path);
    if (this.mounts[decoded] == undefined) {
      return constants.WASI_EINVAL;
    } else {
      delete this.mounts[decoded];
      return constants.WASI_ESUCCESS;
    }
  }
}
