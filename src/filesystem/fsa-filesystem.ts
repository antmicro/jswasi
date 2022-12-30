import { Filestat, Descriptor, Fdstat, Filesystem } from "./filesystem";
import * as constants from "../constants";

class FsaFilesystem implements Filesystem {
  private mounts: Record<string, Filesystem>;

  getMounts(): Record<string, Filesystem> {
    return this.mounts;
  }

  async addMount(path: string, filesystem: Filesystem): Promise<number> {
    for (let mountPoint of Object.keys(this.mounts)) {
      if (path.startsWith(mountPoint)) {
        return await this.mounts[mountPoint].addMount(
          path.slice(mountPoint.length),
          filesystem
        );
      } else {
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
