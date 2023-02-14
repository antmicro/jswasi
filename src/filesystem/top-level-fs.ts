import {
  Filesystem,
  Descriptor,
  OpenFlags,
  LookupFlags,
  Fdflags,
  Rights,
} from "./filesystem";
import * as constants from "../constants";
import { dirname, basename, realpath } from "../utils";

type DescInfo = {
  err: number;
  desc: Descriptor;
  fs: Filesystem;
  path: string;
};

export class TopLevelFs {
  private mounts: Record<string, Filesystem>;

  private async getDescInfo(
    path: string,
    dirflags: LookupFlags = 0,
    oflags: OpenFlags = 0,
    fs_rights_base: Rights = constants.WASI_RIGHTS_ALL,
    fs_rights_inheriting: Rights = constants.WASI_RIGHTS_ALL,
    fdflags: Fdflags = 0
  ): Promise<DescInfo> {
    let rpath = realpath(path);
    let fs = this.mounts[rpath];
    if (fs !== undefined) {
      // we assume that mount paths are always realpaths
      // a root of a filesystem cannot be anything other than a directory
      // so we don't have to try to expand any symlink here
      const { err, desc } = await fs.open(
        "/",
        dirflags,
        oflags,
        fs_rights_base,
        fs_rights_inheriting,
        fdflags
      );
      return { err, desc, fs, path: rpath };
    }

    let lastSeparator;
    for (
      lastSeparator = rpath.lastIndexOf("/");
      lastSeparator !== -1 && fs === undefined;
      lastSeparator = rpath.lastIndexOf("/", lastSeparator - 1)
    ) {
      let mountPoint = rpath.slice(0, lastSeparator);
      fs = this.mounts[mountPoint === "" ? "/" : mountPoint];
    }

    let { err, index, desc } = await fs.open(
      rpath.slice(lastSeparator),
      dirflags,
      oflags,
      fs_rights_base,
      fs_rights_inheriting,
      fdflags
    );

    if (dirflags & constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW) {
      switch (err) {
        case constants.WASI_ESUCCESS:
        case constants.WASI_ENOTDIR: {
          // if some component in the middle of the path is a symlink
          let fdstat = await desc.getFdstat();
          if (
            fdstat !== undefined &&
            fdstat.fs_filetype === constants.WASI_FILETYPE_SYMBOLIC_LINK
          ) {
            let { err: err_, content } = await desc.read_str();
            if (err_ !== constants.WASI_ESUCCESS) {
              return { desc: undefined, err, fs, path: undefined };
            }
            let __path: string;
            if (content.startsWith("/")) {
              __path = content;
            } else {
              // replace symlink filename with it's content
              let __index = lastSeparator + index;
              let left_path = rpath.slice(0, __index + 1);
              if (err === constants.WASI_ESUCCESS) {
                __path = left_path.concat(content);
              } else {
                let right_path = rpath.slice(
                  __index + rpath.indexOf("/", __index + 1)
                );
                __path = left_path.concat(content, right_path);
              }
            }
            return await this.getDescInfo(
              __path,
              dirflags,
              oflags,
              fs_rights_base,
              fs_rights_inheriting,
              fdflags
            );
          }
          if (err === constants.WASI_ESUCCESS) {
            return { desc, err, fs, path: rpath };
          } else {
            return { desc: undefined, err, fs, path: rpath };
          }
        }
        default: {
          return { desc: undefined, err, fs, path: undefined };
        }
      }
    } else {
      return {
        err,
        desc: err === constants.WASI_ESUCCESS ? desc : undefined,
        fs,
        path: rpath,
      };
    }
  }

  async open(
    path: string,
    dirflags: LookupFlags = 0,
    oflags: OpenFlags = 0,
    fs_rights_base: Rights = constants.WASI_RIGHTS_ALL,
    fs_rights_inheriting: Rights = constants.WASI_RIGHTS_ALL,
    fdflags: Fdflags = 0
  ): Promise<{ desc: Descriptor; err: number }> {
    return await this.getDescInfo(
      path,
      dirflags,
      oflags,
      fs_rights_base,
      fs_rights_inheriting,
      fdflags
    );
  }

  async createDir(path: string): Promise<number> {
    const { desc, fs, err } = await this.getDescInfo(
      path.slice(0, path.lastIndexOf("/")),
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );
    if (err !== constants.WASI_ESUCCESS) return err;
    return await fs.mkdirat(desc, path.slice(path.lastIndexOf("/") + 1));
  }

  async addSymlink(target: string, linkpath: string): Promise<number> {
    const { desc, fs, err } = await this.getDescInfo(
      linkpath.slice(0, linkpath.lastIndexOf("/")),
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );
    if (err !== constants.WASI_ESUCCESS) return err;
    return fs.symlinkat(
      target,
      desc,
      linkpath.slice(linkpath.lastIndexOf("/") + 1)
    );
  }

  async removeDirectory(path: string): Promise<number> {
    const { desc, fs, err } = await this.getDescInfo(
      dirname(path),
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );
    if (err !== constants.WASI_ESUCCESS) return err;
    // TODO: this could potentially remove a mount point while it is still mounted
    return await fs.unlinkat(desc, basename(path), true);
  }

  async move(source: string, target: string): Promise<number> {
    let dinfo1 = await this.getDescInfo(
      dirname(source),
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );
    let dinfo2 = await this.getDescInfo(
      dirname(target),
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );
  }

  async addMount(path: string, fs: Filesystem): Promise<number> {
    if (this.mounts[path] !== undefined) {
      return constants.WASI_EEXIST;
    }

    // TODO: expand symlinks in path and ensure it points to an empty directory
    let descInfo = await this.getDescInfo(
      path,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      constants.WASI_O_DIRECTORY
    );
    if (descInfo.err !== constants.WASI_ESUCCESS) {
      return descInfo.err;
    }
    if ((await descInfo.desc.readdir(true)).dirents.length === 0) {
      this.mounts[path] = fs;
      return constants.WASI_ESUCCESS;
    }
    return constants.WASI_ENOTEMPTY;
  }
}
