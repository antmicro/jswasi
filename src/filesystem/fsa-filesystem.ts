import {
  Filesystem,
  Filestat,
  Descriptor,
  AbstractFileDescriptor,
  AbstractDirectoryDescriptor,
  Rights,
  Fdflags,
  Timestamp,
  Whence,
  Dirent,
  OpenFlags,
  LookupFlags,
  AbstractDescriptor,
} from "./filesystem.js";
import { basename, dirname } from "../utils.js";
import * as constants from "../constants.js";
import {
  listStoredKeys,
  delStoredData,
  getStoredData,
  setStoredData,
} from "./metadata.js";
import { UserData, EventType, PollEvent } from "../types.js";

async function initMetadataPath(handle: FileSystemHandle): Promise<string> {
  const components = await (
    await navigator.storage.getDirectory()
  ).resolve(handle);
  return components.join("/");
}

/**
 * Returns wasi error code corresponding to a given DOMException
 *
 * @param e - DOMException instance
 * @param isDir - some error variants differ depending on whether a directory or a file was requested
 *
 * @returns wasi error code
 */
function mapErr(e: DOMException, isDir: boolean): number {
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
    case "InvalidModificationError":
      return constants.WASI_ENOTEMPTY;
    case "QuotaExceededError":
      return constants.WASI_EDQUOT;
    default:
      return constants.WASI_EINVAL;
  }
}

type FsaFilesystemOpts = {
  name?: string;
  keepMetadata?: boolean;
  prompt?: boolean; // prompt for local directory
  create?: boolean; // create partition if not present
};

export class FsaFilesystem implements Filesystem {
  private rootHandle: FileSystemDirectoryHandle;
  private keepMetadata: boolean;

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
        // TODO: can fsa api handle .. and .?
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
    fdflags: Fdflags
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
            path.slice(index + 1),
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
            break;
          }
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

  async initialize(opts: Object): Promise<number> {
    const __opts = opts as FsaFilesystemOpts;

    if (__opts.prompt) {
      // Metadata is not yet supported for local directories
      // name and prompt options cannot be used together
      // create makes no sense with prompt
      if (__opts.keepMetadata || __opts.name || __opts.create)
        return constants.WASI_EINVAL;

      try {
        this.rootHandle = await showDirectoryPicker();
      } catch (_) {
        // TODO: Catch error and return proper error code
        return constants.WASI_ENOENT;
      }
    } else if (__opts.name) {
      if (__opts.keepMetadata === undefined) this.keepMetadata = false;
      else this.keepMetadata = __opts.keepMetadata;

      const handle = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(__opts.name, {
        create: __opts.create === undefined ? false : __opts.create,
      });
      this.rootHandle = handle;

      const rootStoredData = await getStoredData(__opts.name);
      if (__opts.keepMetadata && !rootStoredData) {
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
            0
          );

          if (result.err === constants.WASI_ENOENT) await delStoredData(key);
        }
      })
    );
  }
}

interface FsaDescriptor extends AbstractDescriptor {
  handle: FileSystemHandle;
  metadataPath: string;
  keepMetadata: boolean;
}

function initFsaDesc(
  desc: FsaDescriptor,
  fs_flags: Fdflags,
  fs_rights_base: Rights,
  fs_rights_inheriting: Rights,
  // There is no point in keeping metadata of local files mounted
  // in in the app in the indexedDB as the metadata would have to
  // be recursively applied and removed each mount/umount. Also,
  // filesystem access API doesn't provide access to all fields of
  // Filestat structure so in such cases, just return dummy metadata
  keepMetadata: boolean
) {
  desc.keepMetadata = keepMetadata;
  if (desc.keepMetadata) {
    desc.metadataPath = "";
  }
  desc.fdstat = {
    fs_flags,
    fs_rights_base,
    fs_rights_inheriting,
    fs_filetype: undefined,
  };
}

async function initializeFsaDesc(desc: FsaDescriptor): Promise<void> {
  if (desc.keepMetadata && desc.metadataPath === "") {
    desc.metadataPath = await initMetadataPath(desc.handle);
  }
}

async function setFilestatTimesFsaDesc(
  desc: FsaDescriptor,
  atim: Timestamp,
  mtim: Timestamp
): Promise<number> {
  if (desc.keepMetadata) {
    let filestat = await getStoredData(desc.metadataPath);

    if (atim !== undefined) filestat.atim = atim;
    if (mtim !== undefined) filestat.mtim = mtim;

    if (atim !== undefined || mtim !== undefined) {
      await setStoredData(desc.metadataPath, filestat);
    }
  }

  return constants.WASI_ESUCCESS;
}

class FsaFileDescriptor
  extends AbstractFileDescriptor
  implements FsaDescriptor
{
  // Filesystem access API doesn't support real symlinks so
  // assume that by default every file is a regular file
  static defaultFilestat: Filestat = {
    dev: 0n,
    ino: 0n,
    filetype: constants.WASI_FILETYPE_REGULAR_FILE,
    nlink: 1n,
    size: 0n,
    atim: 0n,
    mtim: 0n,
    ctim: 0n,
  };
  metadataPath: string;
  keepMetadata: boolean;

  private cursor: bigint;
  private writer: FileSystemWritableFileStream;
  private file: File;

  constructor(
    public handle: FileSystemFileHandle,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    keepMetadata: boolean
  ) {
    super();
    this.cursor = 0n;
    initFsaDesc(
      this,
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      keepMetadata
    );
    this.file = undefined;
  }

  override async initialize(path: string): Promise<number> {
    const err = await super.initialize(path);
    if (err !== constants.WASI_ESUCCESS) return err;

    await initializeFsaDesc(this);

    const size = BigInt((await this.__getFile()).file?.size);
    let filetype;
    if (this.keepMetadata) {
      const filestat = await getStoredData(this.metadataPath);

      if (filestat == undefined) return constants.WASI_ENOENT;

      filetype = filestat.filetype;
    } else {
      filetype = FsaFileDescriptor.defaultFilestat.filetype;
    }

    this.fdstat.fs_filetype = filetype;
    if (this.fdstat.fs_flags & constants.WASI_FDFLAG_APPEND) this.cursor = size;

    return constants.WASI_ESUCCESS;
  }

  async getWriter(): Promise<FileSystemWritableFileStream> {
    if (!this.writer) {
      this.writer = await this.handle.createWritable({
        keepExistingData: true,
      });
    }
    return this.writer;
  }

  /**
   * Auxiliary function for getting a file from a handle and handling errors
   */
  private async __getFile(): Promise<{ err: number; file: File }> {
    if (!this.file) {
      try {
        const file = await this.handle.getFile();
        this.file = file;
        return { err: constants.WASI_ESUCCESS, file };
      } catch (_) {
        return { err: constants.WASI_EACCES, file: undefined };
      }
    }
    return { err: constants.WASI_ESUCCESS, file: this.file };
  }

  async read(len: number): Promise<{ err: number; buffer: ArrayBuffer }> {
    const { err, file } = await this.__getFile();
    if (err !== constants.WASI_ESUCCESS) {
      return { err, buffer: undefined };
    }

    const end = Number(this.cursor) + len;
    const buffer = await file
      .slice(Number(this.cursor), Number(end))
      .arrayBuffer();
    this.cursor += BigInt(buffer.byteLength);
    return {
      err: constants.WASI_ESUCCESS,
      buffer,
    };
  }

  async read_str(): Promise<{ err: number; content: string }> {
    const { err, file } = await this.__getFile();
    if (err !== constants.WASI_ESUCCESS) {
      return { err, content: undefined };
    }
    return { err: constants.WASI_ESUCCESS, content: await file.text() };
  }

  async pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    const { err, file } = await this.__getFile();
    if (err !== constants.WASI_ESUCCESS) {
      return { err, buffer: undefined };
    }
    const size = BigInt((await this.__getFile()).file?.size);
    const end = size < pos + BigInt(len) ? size : this.cursor + BigInt(len);
    return {
      err: constants.WASI_ESUCCESS,
      buffer: await file.slice(Number(pos), Number(end)).arrayBuffer(),
    };
  }

  async seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    const size = BigInt((await this.__getFile()).file?.size);
    switch (whence) {
      case constants.WASI_WHENCE_CUR:
        if (this.cursor + offset < 0n) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor += offset;
        break;
      case constants.WASI_WHENCE_SET:
        if (offset < 0n) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor = offset;
        break;
      case constants.WASI_WHENCE_END:
        if (size < -offset) {
          return { offset: this.cursor, err: constants.WASI_EINVAL };
        }
        this.cursor = size + offset;
        break;
      default:
        return { offset: this.cursor, err: constants.WASI_EINVAL };
    }
    return { err: constants.WASI_ESUCCESS, offset: this.cursor };
  }

  async setFilestatTimes(atim: Timestamp, mtim: Timestamp): Promise<number> {
    return setFilestatTimesFsaDesc(this, atim, mtim);
  }

  async write(buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    await (
      await this.getWriter()
    ).write({
      type: "write",
      position: Number(this.cursor),
      data: buffer,
    });
    let written = BigInt(buffer.byteLength);
    this.cursor += written;
    return { err: constants.WASI_ESUCCESS, written };
  }

  async pwrite(
    buffer: ArrayBuffer,
    offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    await (
      await this.getWriter()
    ).write({
      type: "write",
      position: Number(offset),
      data: buffer,
    });
    let written = BigInt(buffer.byteLength);
    return { err: constants.WASI_ESUCCESS, written };
  }

  async writableStream(): Promise<{ err: number; stream: WritableStream }> {
    return { err: constants.WASI_ESUCCESS, stream: await this.getWriter() };
  }

  async truncate(size: bigint): Promise<number> {
    try {
      await (
        await this.getWriter()
      ).write({ type: "truncate", size: Number(size) });
    } catch (e) {
      if (e instanceof DOMException) {
        return mapErr(e, false);
      }
      return constants.WASI_EINVAL;
    }
    await this.flush();
    this.cursor = 0n;
    return constants.WASI_ESUCCESS;
  }

  async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    let buffer = await (await this.handle.getFile()).arrayBuffer();
    return { err: constants.WASI_ESUCCESS, buffer };
  }

  async flush(): Promise<void> {
    if (this.writer) {
      const writer = this.writer;

      this.writer = null;
      // prevent other processes from closing the same descriptor
      // TODO: is mutex necessary here?
      try {
        await writer?.close();
      } catch (_) {}
    }
  }
  async close(): Promise<number> {
    await this.flush();
    return constants.WASI_ESUCCESS;
  }

  async getFilestat(): Promise<{ err: number; filestat: Filestat }> {
    let filestat = this.keepMetadata
      ? await getStoredData(this.metadataPath)
      : FsaFileDescriptor.defaultFilestat;

    // TODO: revisit errno choice
    if (filestat === undefined)
      return { err: constants.WASI_ENOTRECOVERABLE, filestat: undefined };

    filestat.size = BigInt((await this.__getFile()).file?.size);
    return { err: constants.WASI_ESUCCESS, filestat };
  }

  // This function should not be async, in case the local file variable is not
  // present, this call might not resolve on time
  async addPollSub(
    userdata: UserData,
    eventType: EventType,
    _workerId: number
  ): Promise<PollEvent> {
    const nbytes = BigInt(
      this.file ? this.file.size : (await this.__getFile()).file.size
    );
    return {
      userdata,
      error: constants.WASI_ESUCCESS,
      eventType,
      nbytes,
    };
  }
}

class FsaDirectoryDescriptor
  extends AbstractDirectoryDescriptor
  implements FsaDescriptor
{
  metadataPath: string;
  keepMetadata: boolean;
  static defaultFilestat: Filestat = {
    dev: 0n,
    ino: 0n,
    filetype: constants.WASI_FILETYPE_DIRECTORY,
    nlink: 1n,
    size: 4096n,
    atim: 0n,
    mtim: 0n,
    ctim: 0n,
  };
  private entries: Dirent[];

  constructor(
    public handle: FileSystemDirectoryHandle,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    keepMetadata: boolean
  ) {
    super();
    initFsaDesc(
      this,
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      keepMetadata
    );
    this.fdstat.fs_filetype = constants.WASI_FILETYPE_DIRECTORY;
    this.entries = [];
  }

  override async initialize(path: string): Promise<number> {
    const err = await super.initialize(path);
    if (err !== constants.WASI_ESUCCESS) return err;

    await initializeFsaDesc(this);

    return constants.WASI_ESUCCESS;
  }

  async getFilestat(): Promise<{ err: number; filestat: Filestat }> {
    if (this.keepMetadata) {
      const filestat = await getStoredData(this.metadataPath);
      if (filestat === undefined)
        return { err: constants.WASI_ENOTRECOVERABLE, filestat: undefined };
      return { err: constants.WASI_ESUCCESS, filestat };
    } else {
      return {
        err: constants.WASI_ESUCCESS,
        filestat: FsaDirectoryDescriptor.defaultFilestat,
      };
    }
  }

  async setFilestatTimes(atim: Timestamp, mtim: Timestamp): Promise<number> {
    return setFilestatTimesFsaDesc(this, atim, mtim);
  }

  async readdir(refresh: boolean): Promise<{ err: number; dirents: Dirent[] }> {
    let err = constants.WASI_ESUCCESS;
    if (refresh || this.entries.length === 0) {
      this.entries = [];
      var i = 1n;
      for await (const name of this.handle.keys()) {
        if (name.endsWith(".crswap")) {
          continue;
        }
        let filestat = this.keepMetadata
          ? // TODO: Directory filestat should not be default here
            await getStoredData(`${this.metadataPath}/${name}`)
          : FsaDirectoryDescriptor.defaultFilestat;

        // TODO: revisit errno choice
        if (filestat === undefined) {
          err = constants.WASI_ENOTRECOVERABLE;
        } else {
          this.entries.push({
            d_next: i++,
            d_ino: filestat.ino,
            name,
            d_type: filestat.filetype,
          });
        }
      }
    }
    return { err, dirents: this.entries };
  }
}
