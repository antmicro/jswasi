import {
  Filesystem,
  Filestat,
  Descriptor,
  Rights,
  Fdflags,
  OpenFlags,
  LookupFlags,
} from "../filesystem.js";
import { stringToBool, basename, dirname } from "../../utils.js";
import * as constants from "../../constants.js";
import {
  listStoredKeys,
  delStoredData,
  getStoredData,
  setStoredData,
} from "./metadata.js";

import { initMetadataPath, mapErr, getTopLevelHandle } from "./utils.js";
import {
  FsaDirectoryDescriptor,
  FsaFileDescriptor,
  initializeFsaDesc
} from "./fsa-descriptors.js";


/**
 * Returns wasi error code corresponding to a given DOMException
 *
 * @param e - DOMException instance
 * @param isDir - some error variants differ depending on whether a directory or a file was requested
 *
 * @returns wasi error code
 */
type FsaFilesystemOpts = {
  name?: string;
  keepMetadata?: string;
  prompt?: string; // prompt for local directory
  create?: string; // create partition if not present
};

export class FsaFilesystem implements Filesystem {
  private rootHandle: FileSystemDirectoryHandle;
  private keepMetadata: boolean;

  fsname(): string {
    return "FsaFilesystem";
  }

  private getRootHandle(): FileSystemDirectoryHandle {
    return this.rootHandle;
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
      start_handle === undefined ? this.getRootHandle() : start_handle;
    try {
      if (path.startsWith("/")) {
        start = 1;
      } else {
        start = 0;
      }
      for (
        stop = path.indexOf("/", start);
        stop != -1;
        stop = path.indexOf("/", start)
      ) {
        handle = await handle.getDirectoryHandle(path.slice(start, stop));
        start = stop + 1;
      }
      let __handle;
      __isDir = isDir;
      let component = path.slice(start);
      if (component === "") {
        __handle = handle;
      } else if (isDir) {
        __handle = await handle.getDirectoryHandle(component);
      } else {
        __handle = await handle.getFileHandle(component);
      }
      return {
        handle: __handle,
        err: constants.WASI_ESUCCESS,
        index: -1,
      };
    } catch (e) {
      let err;
      try {
        err = mapErr(e as DOMException, __isDir);
      } catch {
        err = constants.WASI_EINVAL;
      }
      return { index: stop, err, handle };
    }
  }

  async unlinkat(
    desc: Descriptor,
    path: string,
    is_dir: boolean
  ): Promise<number> {
    let start_handle = undefined;
    if (desc !== undefined) {
      if (desc instanceof FsaDirectoryDescriptor) {
        start_handle = desc.handle;
      } else {
        return constants.WASI_EINVAL;
      }
    }
    let { err, handle } = await this.getHandle(
      dirname(path),
      true,
      start_handle
    );
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }
    let name = basename(path);
    try {
      // check if deleted entry matches given type
      // TODO: does leaving it unchecked make sense?
      let __err = (
        await this.getHandle(name, is_dir, handle as FileSystemDirectoryHandle)
      ).err;
      if (__err !== constants.WASI_ESUCCESS) {
        return __err;
      }
      (handle as FileSystemDirectoryHandle).removeEntry(name, {
        recursive: false,
      });
      await delStoredData(`${await initMetadataPath(handle)}/${path}`);
      return constants.WASI_ESUCCESS;
    } catch (e) {
      let __err = constants.WASI_EINVAL;
      if (e instanceof DOMException) {
        __err = mapErr(e, true);
      }
      return __err;
    }
  }

  async mkdirat(desc: Descriptor, path: string): Promise<number> {
    let start_handle = undefined;
    if (desc !== undefined) {
      if (desc instanceof FsaDirectoryDescriptor) {
        start_handle = desc.handle;
      } else {
        return constants.WASI_EINVAL;
      }
    }
    let { err, handle } = await this.getHandle(
      dirname(path),
      true,
      start_handle
    );
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }
    let name = basename(path);
    ({ err } = await this.getHandle(
      name,
      true,
      handle as FileSystemDirectoryHandle
    ));
    if (err === constants.WASI_ESUCCESS) {
      return constants.WASI_EEXIST;
    }
    if (err !== constants.WASI_ENOENT) {
      return err;
    }
    try {
      handle = await (handle as FileSystemDirectoryHandle).getDirectoryHandle(
        path,
        {
          create: true,
        }
      );
    } catch (e) {
      if (e instanceof DOMException) {
        const __err = mapErr(e, true);
        if (__err !== constants.WASI_ESUCCESS) return __err;
      }
    }
    if (this.keepMetadata) {
      await setStoredData(await initMetadataPath(handle), {
        dev: 0n,
        ino: 0n,
        filetype: constants.WASI_FILETYPE_DIRECTORY,
        nlink: 1n,
        size: 4096n,
        mtim: 0n,
        atim: 0n,
        ctim: 0n,
      });
    }
    return constants.WASI_ESUCCESS;
  }

  async symlinkat(
    target: string,
    desc: Descriptor,
    linkpath: string
  ): Promise<number> {
    let start_handle;
    if (desc !== undefined) {
      if (desc instanceof FsaDirectoryDescriptor) {
        start_handle = desc.handle;
      } else {
        return constants.WASI_EINVAL;
      }
    }
    let { err, handle } = await this.getHandle(
      dirname(linkpath),
      true,
      start_handle
    );
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }
    let name = basename(linkpath);
    ({ err } = await this.getHandle(
      name,
      false,
      handle as FileSystemDirectoryHandle
    ));
    if (err === constants.WASI_ESUCCESS || err === constants.WASI_EISDIR) {
      return constants.WASI_EEXIST;
    }
    if (err !== constants.WASI_ENOENT) {
      return err;
    }
    let symlink = await (handle as FileSystemDirectoryHandle).getFileHandle(
      linkpath,
      {
        create: true,
      }
    );
    // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
    // @ts-ignore
    let symlink_writable = await symlink.createWritable();
    await symlink_writable.write(target);
    await symlink_writable.close();

    if (this.keepMetadata) {
      // TODO: fill dummy data with something meaningful
      await setStoredData(await initMetadataPath(symlink), {
        dev: 0n,
        ino: 0n,
        filetype: constants.WASI_FILETYPE_SYMBOLIC_LINK,
        nlink: 1n,
        size: BigInt(target.length),
        mtim: 0n,
        atim: 0n,
        ctim: 0n,
      });
    }
    return constants.WASI_ESUCCESS;
  }

  async getFilestat(
    path: string
  ): Promise<{ err: number; filestat: Filestat }> {
    if (this.keepMetadata) {
      const metadataPath = this.getRootHandle().name + path;
      const filestat = await getStoredData(metadataPath);
      return {
        filestat,
        err: filestat ? constants.WASI_ESUCCESS : constants.WASI_ENOENT,
      };
    } else {
      const { err } = await this.getHandle(path, true, undefined);
      switch (err) {
        case constants.WASI_ENOTDIR:
          return {
            err: constants.WASI_ESUCCESS,
            filestat: FsaDirectoryDescriptor.defaultFilestat,
          };
        case constants.WASI_ESUCCESS:
          return {
            err: constants.WASI_ESUCCESS,
            filestat: FsaFileDescriptor.defaultFilestat,
          };
        default:
          return {
            err,
            filestat: undefined,
          };
      }
    }
  }

  async open(
    path: string,
    dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags,
    _workerId: number
  ): Promise<{ err: number; index: number; desc: Descriptor }> {
    let result = await this.getHandle(path, true, undefined);
    let err = result.err,
      index = result.index,
      desc = undefined;
    switch (err) {
      // The search was succesfull and a directory was found
      case constants.WASI_ESUCCESS: {
        if (oflags & constants.WASI_O_CREAT) {
          if (oflags & constants.WASI_O_EXCL) {
            err = constants.WASI_EEXIST;
          } else {
            err = constants.WASI_EISDIR;
          }
        } else {
          err = result.err;
        }
        index = result.index;
        desc = new FsaDirectoryDescriptor(
          result.handle as FileSystemDirectoryHandle,
          fdflags,
          fs_rights_base,
          fs_rights_inheriting,
          this.keepMetadata
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
            basename(path),
            false,
            result.handle as FileSystemDirectoryHandle
          );
          if (__result.err === constants.WASI_ESUCCESS) {
            if (
              oflags & constants.WASI_O_CREAT &&
              oflags & constants.WASI_O_EXCL
            ) {
              // The requested file already exists, while CREAT and EXCL are requested
              // TODO: this check should rather be a part of top level fs
              err = constants.WASI_EEXIST;
            } else if (!(oflags & constants.WASI_O_DIRECTORY)) {
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
              fs_rights_inheriting,
              this.keepMetadata
            );
          }
          break;
        } else if (dirflags & constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW) {
          // If some component in the middle of the path is not a directory, it might be
          // a symlink, if symlink follow flag is set, return a descriptor to the symlink
          const __result = await this.getHandle(
            basename(path.slice(0, index)),
            false,
            result.handle as FileSystemDirectoryHandle
          );
          if (__result.err === constants.WASI_ESUCCESS) {
            desc = new FsaFileDescriptor(
              __result.handle as FileSystemFileHandle,
              fdflags,
              fs_rights_base,
              fs_rights_inheriting,
              this.keepMetadata
            );
          }
          break;
        }
      }
      case constants.WASI_ENOENT: {
        // the last path component is the only one to fail
        // if O_CREAT is set, create the file
        if (oflags & constants.WASI_O_CREAT && index === -1) {
          try {
            const handle = await (
              result.handle as FileSystemDirectoryHandle
            ).getFileHandle(basename(path), {
              create: true,
            });
            err = constants.WASI_ESUCCESS;
            desc = new FsaFileDescriptor(
              handle,
              fdflags,
              fs_rights_base,
              fs_rights_inheriting,
              this.keepMetadata
            );
            if (this.keepMetadata) {
              desc.metadataPath = await initMetadataPath(handle);
              await setStoredData(desc.metadataPath, {
                dev: 0n,
                ino: 0n,
                filetype: constants.WASI_FILETYPE_REGULAR_FILE,
                nlink: 1n,
                size: 0n,
                mtim: 0n,
                atim: 0n,
                ctim: 0n,
              });
            }
          } catch (e) {
            if (e instanceof DOMException) {
              err = mapErr(e, false);
            } else {
              err = constants.WASI_EINVAL;
            }
          }
        }
        break;
      }
    }

    return { err, index, desc };
  }

  async renameat(
    oldDesc: Descriptor,
    oldPath: string,
    newDesc: Descriptor,
    newPath: string
  ): Promise<number> {
    // Filesystem Access API doesn't support renaming entries at this point
    // This feature is now under development, the progress can be tracked here
    // https://chromestatus.com/feature/5640802622504960
    // Once it is stabilized, this implementation should use it
    // EXDEV indicates that user attempted to move files between mount points
    // most userspace apps will handle it by copying source and then removing it
    // Since clang uses path_rename and doesn't implement a fallback, a simple,
    // temporary solution is kept that is able to move a regular file by copying
    // TODO: remove this once fsapi implements renaming or use vfs temporary mount
    // in clang wrapper to avoid moving on fsa filesystem
    const BUFSIZE = 2048;
    if (oldDesc !== undefined && !(oldDesc instanceof FsaDirectoryDescriptor))
      return constants.WASI_EINVAL;

    const { handle: srcHandle, err: errSrc } = await this.getHandle(
      oldPath,
      false,
      (oldDesc as FsaDirectoryDescriptor).handle
    );
    if (errSrc === constants.WASI_EISDIR) return constants.WASI_EXDEV;
    else if (errSrc !== constants.WASI_ESUCCESS) return errSrc;

    // Creating descriptors this way is dangerous and error-prone, this is just
    // a temporary workaround
    const srcDesc = new FsaFileDescriptor(
      srcHandle as FileSystemFileHandle,
      0,
      constants.WASI_RIGHTS_ALL,
      constants.WASI_RIGHTS_ALL,
      this.keepMetadata
    );
    await initializeFsaDesc(srcDesc);

    const srcFilestat = await srcDesc.getFilestat();
    if (srcFilestat.err !== constants.WASI_ESUCCESS) return srcFilestat.err;

    if (srcFilestat.filestat.filetype === constants.WASI_FILETYPE_SYMBOLIC_LINK)
      return constants.WASI_EXDEV;

    if (newDesc !== undefined && !(newDesc instanceof FsaDirectoryDescriptor))
      return constants.WASI_EINVAL;

    const { handle: __destHandle, err: __errDest } = await this.getHandle(
      dirname(newPath),
      true,
      (newDesc as FsaDirectoryDescriptor).handle
    );
    if (__errDest !== constants.WASI_ESUCCESS) return __errDest;

    const destHandle = await (
      __destHandle as FileSystemDirectoryHandle
    ).getFileHandle(basename(newPath), { create: true });
    const destDesc = new FsaFileDescriptor(
      destHandle as FileSystemFileHandle,
      0,
      constants.WASI_RIGHTS_ALL,
      constants.WASI_RIGHTS_ALL,
      this.keepMetadata
    );
    await initializeFsaDesc(destDesc);

    while (true) {
      const { err, buffer } = await srcDesc.read(BUFSIZE);
      if (err !== constants.WASI_ESUCCESS) return err;
      if (buffer.byteLength === 0) break;

      const write = await destDesc.write(buffer);
      if (write.err !== constants.WASI_ESUCCESS) return err;
    }

    await srcDesc.close();
    await destDesc.close();

    await setStoredData(destDesc.metadataPath, srcFilestat.filestat);

    await this.unlinkat(oldDesc, oldPath, false);

    return constants.WASI_ESUCCESS;
  }

  async initialize(opts: Record<string, string>): Promise<number> {
    const __opts = opts as FsaFilesystemOpts;

    this.keepMetadata = __opts.keepMetadata === undefined ?
      false : stringToBool(__opts.keepMetadata);
    const create = __opts.create === undefined ?
      false : stringToBool(__opts.create);
    const prompt = __opts.prompt === undefined ?
      false: stringToBool(__opts.prompt);

    if (prompt) {
      // Metadata is not yet supported for local directories
      // name and prompt options cannot be used together
      // create makes no sense with prompt
      if (this.keepMetadata || __opts.name !== undefined || create)
        return constants.WASI_EINVAL;

      try {
        // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
        // @ts-ignore
        this.rootHandle = await showDirectoryPicker();
      } catch (_) {
        // TODO: Catch error and return proper error code
        return constants.WASI_ENOENT;
      }
    } else if (__opts.name !== undefined) {
      this.rootHandle = await getTopLevelHandle(__opts.name, create);

      if (this.keepMetadata && (await getStoredData(__opts.name)) === undefined) {
        await setStoredData(
          __opts.name,
          FsaDirectoryDescriptor.defaultFilestat
        );
      }
    }

    return constants.WASI_ESUCCESS;
  }

  async mknodat(
    _desc: Descriptor,
    _path: string,
    _dev: number,
    _args: Object
  ): Promise<number> {
    return constants.WASI_EINVAL;
  }

  async cleanup(): Promise<void> {
    // TODO: this should be callable using ioctl
    if (!this.keepMetadata) return;

    const label = this.rootHandle.name;

    await Promise.all(
      (
        await listStoredKeys()
      ).map(async (key) => {
        if (key.startsWith(label)) {
          const result = await this.open(
            key.replace(label, ""),
            0,
            0,
            constants.WASI_RIGHTS_ALL,
            constants.WASI_RIGHTS_ALL,
            0,
            0
          );

          if (result.err === constants.WASI_ENOENT) await delStoredData(key);
        }
      })
    );
  }
}
