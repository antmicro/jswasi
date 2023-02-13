import {
  Filesystem,
  Descriptor,
  OpenFlags,
  LookupFlags,
  Fdflags,
  Rights,
} from "./filesystem";
import * as constants from "../constants";
import { realpath } from "../utils";

export class TopLevelFs {
  private mounts: Record<string, Filesystem>;

  private async getFsAndDesc(
    path: string,
    dirflags: LookupFlags = 0,
    oflags: OpenFlags = 0,
    fs_rights_base: Rights = constants.WASI_RIGHTS_ALL,
    fs_rights_inheriting: Rights = constants.WASI_RIGHTS_ALL,
    fdflags: Fdflags = 0
  ): Promise<{ err: number; desc: Descriptor; fs: Filesystem }> {
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
      return { err, desc, fs };
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
              return { desc: undefined, err, fs };
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
            let ret = await this.open(
              __path,
              dirflags,
              oflags,
              fs_rights_base,
              fs_rights_inheriting,
              fdflags
            );
            return { err: ret.err, desc: ret.desc, fs };
          }
          if (err === constants.WASI_ESUCCESS) {
            return { desc, err, fs };
          } else {
            return { desc: undefined, err, fs };
          }
        }
        default: {
          return { desc: undefined, err, fs };
        }
      }
    } else {
      return {
        err,
        desc: err === constants.WASI_ESUCCESS ? desc : undefined,
        fs,
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
    return await this.getFsAndDesc(
      path,
      dirflags,
      oflags,
      fs_rights_base,
      fs_rights_inheriting,
      fdflags
    );
  }

  async createDir(path: string): Promise<number> {
    const { desc, fs, err } = await this.getFsAndDesc(
      path.slice(0, path.lastIndexOf("/")),
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );
    if (err !== constants.WASI_ESUCCESS) return err;
    return await fs.mkdirat(desc, path.slice(path.lastIndexOf("/") + 1));
  }

  async addSymlink(target: string, linkpath: string): Promise<number> {
    const { desc, fs, err } = await this.getFsAndDesc(
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

  async addMount(path: string, fs: Filesystem): Promise<number> {
    if (this.mounts[path] !== undefined) {
      return constants.WASI_EEXIST;
    }

    // TODO: expand symlinks in path and ensure it points to an empty directory
    this.mounts[path] = fs;
    return constants.WASI_ESUCCESS;
  }
}
