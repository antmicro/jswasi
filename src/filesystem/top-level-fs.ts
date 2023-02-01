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

  async open(
    path: string,
    dirflags: LookupFlags = 0,
    oflags: OpenFlags = 0,
    fs_rights_base: Rights = constants.WASI_RIGHTS_ALL,
    fs_rights_inheriting: Rights = constants.WASI_RIGHTS_ALL,
    fdflags: Fdflags = 0
  ): Promise<{ desc: Descriptor; err: number }> {
    let rpath = realpath(path);
    let fs = this.mounts[rpath];
    if (fs !== undefined) {
      // we assume that mount paths are always realpaths
      // a root of a filesystem cannot be anything other than a directory
      // so we don't have to try to expand any symlink here
      return fs.open(
        "/",
        dirflags,
        oflags,
        fs_rights_base,
        fs_rights_inheriting,
        fdflags
      );
    }

    let start = rpath.length;
    while (true) {
      let lastSeparator = rpath.lastIndexOf("/", start);

      if (lastSeparator !== 0) {
        fs = this.mounts[rpath.slice(0, lastSeparator)];
        start = lastSeparator - 1;
        if (fs === undefined) {
          continue;
        }
      } else {
        fs = this.mounts["/"];
        if (fs === undefined) {
          return { err: constants.WASI_ENOENT, desc: undefined };
        }
      }

      let { err, index, desc } = await fs.open(
        rpath.slice(lastSeparator),
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
                return { desc: undefined, err };
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
              return this.open(
                __path,
                dirflags,
                oflags,
                fs_rights_base,
                fs_rights_inheriting,
                fdflags
              );
            }
            if (err === constants.WASI_ESUCCESS) {
              return { desc, err };
            } else {
              return { desc: undefined, err };
            }
          }
          default: {
            return { desc: undefined, err };
          }
        }
      } else {
        return {
          err,
          desc: err === constants.WASI_ESUCCESS ? desc : undefined,
        };
      }
    }
  }
}
