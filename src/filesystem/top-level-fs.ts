import { FsaFilesystem } from "./fsa-filesystem.js";
import { VirtualFilesystem } from "./virtual-filesystem/virtual-filesystem.js";
import { DeviceFilesystem } from "./virtual-filesystem/device-filesystem.js";
import {
  Filesystem,
  Descriptor,
  OpenFlags,
  LookupFlags,
  Fdflags,
  Rights,
} from "./filesystem.js";
import * as constants from "../constants.js";
import { dirname, basename, realpath } from "../utils.js";

const SYMBOLIC_LINK_DEPTH_LIMIT = 40;

type DescInfo = {
  err: number;
  desc: Descriptor;
  fs: Filesystem;
  path: string;
};

const filesystemMap: Record<string, new () => Filesystem> = {
  fsa: FsaFilesystem,
  vfs: VirtualFilesystem,
  devfs: DeviceFilesystem,
};

export async function getFilesystem(
  fs: string,
  opts: Object
): Promise<{ err: number; filesystem: Filesystem }> {
  const __constructor = filesystemMap[fs];
  if (__constructor) {
    let __fs = new __constructor();
    await __fs.initialize(opts);
    return {
      err: constants.WASI_ESUCCESS,
      filesystem: __fs,
    };
  }
  return {
    err: constants.WASI_EINVAL,
    filesystem: undefined,
  };
}

export class TopLevelFs {
  private mounts: Record<string, Filesystem>;

  constructor() {
    this.mounts = {};
  }

  abspath(desc: Descriptor, path: string): string {
    if (desc !== undefined && !path.startsWith("/")) {
      const __path = desc.getPath();
      if (path.length === 0) {
        return __path;
      }
      return `${__path === "/" ? "" : __path}/${path}`;
    }
    return path;
  }

  private async getDescInfo(
    path: string,
    workerId: number,
    dirflags: LookupFlags = 0,
    oflags: OpenFlags = 0,
    fs_rights_base: Rights = constants.WASI_RIGHTS_ALL,
    fs_rights_inheriting: Rights = constants.WASI_RIGHTS_ALL,
    fdflags: Fdflags = 0,
    symlink_depth: number = SYMBOLIC_LINK_DEPTH_LIMIT
  ): Promise<DescInfo> {
    let rpath = realpath(path);
    let lastSeparator, fs;
    for (
      lastSeparator = rpath.length;
      lastSeparator > 0;
      lastSeparator = rpath.lastIndexOf("/", lastSeparator - 1)
    ) {
      let mountPoint = rpath.slice(0, lastSeparator);
      fs = this.mounts[mountPoint];
      if (fs !== undefined) {
        break;
      }
    }

    if (fs === undefined) fs = this.mounts["/"];

    if (fs === undefined) throw new Error("No filesystem mounted at root");

    let { err, index, desc } = await fs.open(
      rpath.slice(lastSeparator),
      dirflags,
      oflags,
      fs_rights_base,
      fs_rights_inheriting,
      fdflags,
      workerId
    );

    if (desc) {
      const __path = index > -1 ? rpath.slice(0, lastSeparator + index) : rpath;
      if ((await desc.initialize(__path)) !== constants.WASI_ESUCCESS)
        return {
          desc: undefined,
          err: constants.WASI_ENOTRECOVERABLE,
          fs: undefined,
          path: rpath,
        };
    }

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
            if (symlink_depth === 0) {
              // Prevent infinite symlink loops
              return { desc, err: constants.WASI_ELOOP, fs, path: rpath };
            }
            let { err: err_, content } = await desc.read_str();
            if (err_ !== constants.WASI_ESUCCESS) {
              return { desc: undefined, err, fs, path: undefined };
            }

            let __path: string;
            if (content.startsWith("/")) {
              if (index !== -1) {
                const __right = rpath.slice(lastSeparator + index);
                __path = content.concat(__right);
              } else {
                __path = content;
              }
            } else {
              // replace symlink filename with it's content
              let __index =
                index === -1
                  ? desc.getPath().lastIndexOf("/")
                  : desc.getPath().lastIndexOf("/", lastSeparator + index - 1);
              let leftPath = rpath.slice(0, __index + 1);
              if (err === constants.WASI_ESUCCESS) {
                __path = leftPath.concat(content);
              } else {
                let rightPath = rpath.slice(lastSeparator + index);
                __path = leftPath.concat(content, rightPath);
              }
            }
            return await this.getDescInfo(
              __path,
              workerId,
              dirflags,
              oflags,
              fs_rights_base,
              fs_rights_inheriting,
              fdflags,
              symlink_depth - 1
            );
          }
          break;
        }
        default: {
          return { desc: undefined, err, fs, path: undefined };
        }
      }
    }
    if (err === constants.WASI_ESUCCESS) {
      if (oflags & constants.WASI_O_TRUNC) {
        await desc.truncate(0n);
      }
      return { desc, err, fs, path: rpath };
    } else {
      return { desc: undefined, err, fs, path: rpath };
    }
  }

  // workerId = -1 means that no process called the function
  // this happens during kernel initialization before spawning init
  async open(
    path: string,
    dirflags: LookupFlags = 0,
    oflags: OpenFlags = 0,
    fdflags: Fdflags = 0,
    fs_rights_base: Rights = constants.WASI_RIGHTS_ALL,
    fs_rights_inheriting: Rights = constants.WASI_RIGHTS_ALL,
    workerId: number = -1
  ): Promise<{ desc: Descriptor; err: number }> {
    return await this.getDescInfo(
      path,
      workerId,
      dirflags,
      oflags,
      fs_rights_base,
      fs_rights_inheriting,
      fdflags
    );
  }

  async openat(
    desc: Descriptor,
    path: string,
    dirflags: LookupFlags = 0,
    oflags: OpenFlags = 0,
    fdflags: Fdflags = 0,
    fs_rights_base: Rights = constants.WASI_RIGHTS_ALL,
    fs_rights_inheriting: Rights = constants.WASI_RIGHTS_ALL,
    workerId: number = -1
  ): Promise<{ desc: Descriptor; err: number }> {
    let __path = this.abspath(desc, path);
    return await this.getDescInfo(
      __path,
      workerId,
      dirflags,
      oflags,
      fs_rights_base,
      fs_rights_inheriting,
      fdflags
    );
  }

  async createDir(
    path: string,
    desc: Descriptor = undefined,
    workerId: number = -1
  ): Promise<number> {
    let __path = this.abspath(desc, path);
    if (__path.endsWith("/")) __path = __path.slice(0, -1);

    const {
      desc: __desc,
      fs,
      err,
    } = await this.getDescInfo(
      dirname(__path),
      workerId,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );

    if (err !== constants.WASI_ESUCCESS) return err;
    return await fs.mkdirat(__desc, basename(__path));
  }

  // linkpath and linkdesc are in reverse order so that linkdesc can have default value
  async addSymlink(
    target: string,
    linkpath: string,
    linkdesc: Descriptor = undefined,
    workerId: number = -1
  ): Promise<number> {
    let path;
    if (linkdesc !== undefined && !linkpath.startsWith("/")) {
      path = `${linkdesc.getPath()}/${linkpath}`;
    } else {
      path = linkpath;
    }
    const { desc, fs, err } = await this.getDescInfo(
      dirname(path),
      workerId,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );
    if (err !== constants.WASI_ESUCCESS) return err;
    return fs.symlinkat(target, desc, basename(linkpath));
  }

  async removeEntry(
    path: string,
    is_dir: boolean,
    desc: Descriptor = undefined,
    workerId: number = -1
  ): Promise<number> {
    let __path = this.abspath(desc, path);
    const {
      desc: __desc,
      fs,
      err,
    } = await this.getDescInfo(
      dirname(__path),
      workerId,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );
    if (err !== constants.WASI_ESUCCESS) return err;
    // TODO: this could potentially remove a mount point while it is still mounted
    return await fs.unlinkat(__desc, basename(__path), is_dir);
  }

  async move(
    desc_s: Descriptor,
    source: string,
    desc_t: Descriptor,
    target: string,
    workerId: number = -1
  ): Promise<number> {
    const __source = this.abspath(desc_s, source);
    const __source_dirname = dirname(__source);
    const __target = this.abspath(desc_t, target);
    const __target_dirname = dirname(__target);

    // If any mount point starts with the source path
    // or if target path is starts with source path, return EBUSY
    if (
      Object.keys(this.mounts).some((key) => {
        key.startsWith(__source);
      }) ||
      __source.startsWith(__target)
    )
      return constants.WASI_EBUSY;

    const dinfo1 = await this.getDescInfo(
      __source_dirname,
      workerId,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      constants.WASI_O_DIRECTORY
    );

    // If parent directory descriptor of the source path cannot be found,
    // return with error
    if (dinfo1.err !== constants.WASI_ESUCCESS) return dinfo1.err;

    const __dinfo1 = await this.getDescInfo(
      __source,
      workerId,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );

    // If the source path doesn't correspond to an existing filesystem entry,
    // return with error
    if (__dinfo1.err !== constants.WASI_ESUCCESS) return __dinfo1.err;

    const __res = await __dinfo1.desc.getFilestat();
    if (__res.err !== constants.WASI_ESUCCESS) return __res.err;
    const filestat1 = __res.filestat;

    const dinfo2 = await this.getDescInfo(
      __target_dirname,
      workerId,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      constants.WASI_O_DIRECTORY
    );

    // If parent directory descriptor of the target path cannot be found,
    // return with error
    if (dinfo2.err !== constants.WASI_ESUCCESS) return dinfo2.err;

    const __dinfo2 = await this.getDescInfo(
      __target,
      workerId,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
    );

    // target path exists, additional checks need to be performed to check
    // if the rename is feasible
    if (__dinfo2.err === constants.WASI_ESUCCESS) {
      const __res = await __dinfo2.desc.getFilestat();
      if (__res.err !== constants.WASI_ESUCCESS) return __res.err;
      const filestat2 = __res.filestat;

      // if paths are on different mount points, return EXDEV
      if (filestat1.dev !== filestat2.dev) return constants.WASI_EXDEV;

      if (filestat2.filetype === constants.WASI_FILETYPE_DIRECTORY) {
        // If target is a directory and the source isn't, return with ENOTDIR
        if (filestat1.filetype !== constants.WASI_FILETYPE_DIRECTORY)
          return constants.WASI_ENOTDIR;

        const { err, dirents } = await __dinfo2.desc.readdir(false);

        // If contents of the target directory cannot be read, return with error
        if (err !== constants.WASI_ESUCCESS) return err;

        // if the target directory is not empty, return ENOTEMPTY
        if (dirents.length !== 0) return constants.WASI_ENOTEMPTY;
      }
    }
    return dinfo2.fs.renameat(
      dinfo1.desc,
      basename(__source),
      dinfo2.desc,
      basename(__target)
    );
  }

  async addMount(
    sourceDesc: Descriptor,
    sourcePath: string,
    targetDesc: Descriptor,
    targetPath: string,
    filesystemType: string,
    // mountFlags is not used but it is present in linux and might
    // be useful in the future
    _mountFlags: bigint,
    data: Record<string, string>,
    workerId: number = -1
  ): Promise<number> {
    const __targetPath = this.abspath(targetDesc, targetPath);

    let dinfoTarget;
    if (__targetPath !== "/") {
      dinfoTarget = await this.getDescInfo(
        __targetPath,
        workerId,
        constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
        constants.WASI_O_DIRECTORY
      );

      if (dinfoTarget.err !== constants.WASI_ESUCCESS) return dinfoTarget.err;

      const dirents = await dinfoTarget.desc.readdir(true);
      if (dirents.dirents.length !== 0) return constants.WASI_ENOTEMPTY;
    } else if (this.mounts["/"] !== undefined) {
      return constants.WASI_EBUSY;
    }

    const __sourcePath = this.abspath(sourceDesc, sourcePath);

    let fs;
    if (__sourcePath === "") {
      const getFilesystemErr = await getFilesystem(filesystemType, data);
      if (getFilesystemErr.err !== constants.WASI_ESUCCESS)
        return getFilesystemErr.err;

      fs = getFilesystemErr.filesystem;
    } else {
      const dinfoSource = await this.getDescInfo(
        __sourcePath,
        workerId,
        constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
        constants.WASI_O_DIRECTORY
      );

      if (dinfoSource.err !== constants.WASI_ESUCCESS) return dinfoSource.err;

      const mountResult = await dinfoSource.desc.mountFs(data);

      if (mountResult.err !== constants.WASI_ESUCCESS) return mountResult.err;

      fs = mountResult.fs;
    }

    this.mounts[__targetPath] = fs;
    return constants.WASI_ESUCCESS;
  }

  // TODO: This should be removed once we have some userspace tool
  // (or better kernelspace implementation) to manage devices
  async addMountFs(
    path: string,
    fs: Filesystem,
    workerId: number = -1
  ): Promise<number> {
    if (this.mounts[path] !== undefined) {
      return constants.WASI_EBUSY;
    } else if (path === "/") {
      // special case when we want to mount rootfs
      this.mounts[path] = fs;
      return constants.WASI_ESUCCESS;
    }

    // TODO: expand symlinks in path and ensure it points to an empty directory
    let descInfo = await this.getDescInfo(
      path,
      workerId,
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

  removeMount(path: string): number {
    // TODO: check if there are descriptors from this filesystem before unmounting
    if (
      Object.keys(this.mounts).every((mountPoint) => {
        return mountPoint === path || !mountPoint.startsWith(path);
      })
    ) {
      if (this.mounts[path]) {
        delete this.mounts[path];
        return constants.WASI_ESUCCESS;
      } else {
        return constants.WASI_ENOENT;
      }
    } else {
      return constants.WASI_EBUSY;
    }
  }

  async readLink(
    desc: Descriptor,
    path: string,
    workerId: number = -1
  ): Promise<{ err: number; path: string }> {
    let { err: __err, desc: __desc } = await this.openat(
      desc,
      path,
      0,
      0,
      0,
      constants.WASI_RIGHTS_ALL,
      constants.WASI_RIGHTS_ALL,
      workerId
    );
    if (__err !== constants.WASI_ESUCCESS) {
      return { err: __err, path: undefined };
    }

    let __fdstat = await __desc.getFdstat();
    if (__fdstat.fs_filetype !== constants.WASI_FILETYPE_SYMBOLIC_LINK) {
      return { err: constants.WASI_EINVAL, path: undefined };
    }

    const { err, content } = await __desc.read_str();
    return { err, path: content };
  }

  getMounts(): Record<string, Filesystem> {
    return this.mounts;
  }
}
