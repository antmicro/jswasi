import {
  Filestat,
  Descriptor,
  Fdstat,
  Filesystem,
  Rights,
  Fdflags,
  Timestamp,
  Whence,
  Dirent,
  OpenFlags,
  LookupFlags,
} from "./filesystem.js";
import * as constants from "../constants.js";
// @ts-ignore
import * as vfs from "../vendor/vfs.js";
import { basename } from "../utils.js";

function wasiFiletype(stat: vfs.Stat): number {
  switch (stat.mode & vfs.constants.S_IFMT) {
    case vfs.constants.S_IFREG:
      return constants.WASI_FILETYPE_REGULAR_FILE;
    case vfs.constants.S_IFDIR:
      return constants.WASI_FILETYPE_DIRECTORY;
    case vfs.constants.S_IFBLK:
      return constants.WASI_FILETYPE_BLOCK_DEVICE;
    case vfs.constants.S_IFCHR:
      return constants.WASI_FILETYPE_CHARACTER_DEVICE;
    case vfs.constants.S_IFLNK:
      return constants.WASI_FILETYPE_SYMBOLIC_LINK;
    case vfs.constants.S_IFSOCK:
      // Posix doesn't include two filetypes for datagram and stream sockets
      return constants.WASI_FILETYPE_SOCKET_STREAM;
    default:
      return constants.WASI_FILETYPE_UNKNOWN;
  }
}

function wasiFilestat(stat: vfs.Stat): Filestat {
  return {
    dev: stat.dev,
    ino: stat.ino,
    nlink: stat.nlink,
    filetype: wasiFiletype(stat),
    size: stat.size,
    atim: stat.atime,
    mtim: stat.mtime,
    ctim: stat.ctime,
  };
}

export class VirtualFilesystem implements Filesystem {
  private virtualFs: vfs.VirtualFS;

  constructor() {
    const __devMgr = new vfs.DeviceManager();
    const __inoMgr = new vfs.INodeManager(__devMgr);
    const [_, __rootDirIno] = __inoMgr.createINode(vfs.Directory, {});
    const __fdMgr = new vfs.FileDescriptorManager();
    this.virtualFs = new vfs.VirtualFS(
      0o022,
      __rootDirIno,
      __devMgr,
      __inoMgr,
      __fdMgr
    );
  }

  async mkdirat(desc: Descriptor, path: string): Promise<number> {
    if (desc instanceof VirtualFilesystemDirectoryDescriptor) {
      return constants.WASI_EINVAL;
    }

    const __desc = desc as VirtualFilesystemDirectoryDescriptor;

    const [, index] = this.virtualFs._iNodeMgr.createINode(vfs.Directory, {
      mode: vfs.DEFAILT_DIRECTORY_PERM,
      uid: 0,
      gid: 0,
      parent: __desc.dir.getEntryIndex("."),
    });
    __desc.dir.addEntry(path, index);

    return constants.WASI_ESUCCESS;
  }

  async getFilestat(
    path: string
  ): Promise<{ err: number; filestat: Filestat }> {
    try {
      const __stat = this.virtualFs.statSync(path);
      return {
        err: constants.WASI_ESUCCESS,
        filestat: wasiFilestat(__stat),
      };
    } catch (e: vfs.VirtualFSError) {
      return e.errno;
    }
  }

  async unlinkat(
    desc: Descriptor,
    path: string,
    is_dir: boolean
  ): Promise<number> {
    if (desc instanceof VirtualFilesystemDirectoryDescriptor) {
      return constants.WASI_EINVAL;
    }

    const __desc = desc as VirtualFilesystemDirectoryDescriptor;

    try {
      const navigated = this.virtualFs._navigateFrom(__desc.dir, path, false);

      if (!navigated.target) {
        return constants.WASI_ENOENT;
      }

      if (is_dir) {
        if (!(navigated.target instanceof vfs.Directory)) {
        }
      } else {
        if (navigated instanceof vfs.Directory) {
          return constants.WASI_EISDIR;
        }
      }

      navigated.dir.deleteEntry(navigated.name);
      return constants.WASI_ESUCCESS;
    } catch (e: vfs.VirtualFSError) {
      return e.errno;
    }
  }

  async open(
    path: string,
    _dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags
  ): Promise<{ err: number; index: number; desc: Descriptor }> {
    const navigated = vfs._navigate(path, false);
    if (navigated.target) {
      let err: number, index: number;
      if (navigated.remaining) {
        err = constants.WASI_ENOTDIR;
        index = path.length - navigated.remaining.length;
      } else {
        index = -1;
        if (oflags & constants.WASI_O_CREAT && oflags & constants.WASI_O_EXCL) {
          err = constants.WASI_EEXIST;
        } else {
          err = constants.WASI_ESUCCESS;
        }
      }
      return {
        err,
        index,
        desc: new VirtualFilesystemFileDescriptor(
          fdflags,
          fs_rights_base,
          fs_rights_inheriting,
          navigated.target
        ),
      };
    } else if (oflags & constants.WASI_O_CREAT) {
      let [target, index] = this.virtualFs._iNodeMgr.createINode(vfs.File, {
        mode: vfs.DEFAULT_FILE_PERM,
        uid: 0,
        gid: 0,
      });
      navigated.dir.addEntry(navigated.name, index);
      return {
        err: constants.WASI_ESUCCESS,
        index: -1,
        desc: new VirtualFilesystemFileDescriptor(
          fdflags,
          fs_rights_base,
          fs_rights_inheriting,
          target
        ),
      };
    } else {
      return {
        err: constants.WASI_ENOENT,
        index: -1,
        desc: new VirtualFilesystemDirectoryDescriptor(
          fdflags,
          fs_rights_base,
          fs_rights_inheriting,
          navigated.dir,
          this.virtualFs._iNodeMgr
        ),
      };
    }
  }

  async renameat(
    oldDesc: Descriptor,
    oldPath: string,
    newDesc: Descriptor,
    newPath: string
  ): Promise<number> {
    if (
      !(oldDesc instanceof VirtualFilesystemDirectoryDescriptor) ||
      !(newDesc instanceof VirtualFilesystemDirectoryDescriptor)
    ) {
      return constants.WASI_EINVAL;
    }

    const __oldDesc = oldDesc as VirtualFilesystemDirectoryDescriptor;
    const __newDesc = newDesc as VirtualFilesystemDirectoryDescriptor;

    const oldNavigated = this.virtualFs._navigateFrom(
      __oldDesc,
      oldPath,
      false
    );
    const newNavigated = this.virtualFs._navigateFrom(
      __newDesc,
      newPath,
      false
    );

    if (!oldNavigated.target) {
      return constants.WASI_ENOENT;
    }

    if (!newNavigated.target) {
      if (newNavigated.remaining !== basename(newPath)) {
        return constants.WASI_ENOENT;
      }
    } else {
      return constants.WASI_EEXIST;
    }

    const index = oldNavigated.dir.getEntryIndex(oldNavigated.name);
    newNavigated.dir.addEntry(newNavigated.name, index);
    oldNavigated.dir.deleteEntry(oldNavigated.name, index);
    return constants.WASI_ESUCCESS;
  }

  async symlinkat(
    target: string,
    desc: Descriptor,
    linkpath: string
  ): Promise<number> {
    if (!(desc instanceof VirtualFilesystemDirectoryDescriptor)) {
      return constants.WASI_EINVAL;
    }

    const __desc = desc as VirtualFilesystemDirectoryDescriptor;

    const navigated = this.virtualFs._navigate(__desc.dir, linkpath, false);

    if (navigated.target) {
      return constants.WASI_EEXIST;
    }

    this.virtualFs._iNodeMgr.createINode(vfs.Symlink, {
      mode: vfs.DEFAULT_SYMLINK_PERM,
      uid: 0,
      gid: 0,
      link: target,
    });
    return constants.WASI_ESUCCESS;
  }
}

abstract class VirtualFilesystemDescriptor implements Descriptor {
  protected fdstat: Fdstat;
  protected path: string;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    stat: vfs.Stat
  ) {
    this.fdstat = {
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      fs_filetype: wasiFiletype(stat),
    };
  }

  async initialize(path: string): Promise<void> {
    this.path = path;
  }

  getPath(): string {
    return this.path;
  }

  async getFdstat(): Promise<Fdstat> {
    return this.fdstat;
  }

  async setFdstatRights(rights_b: Rights, rights_i: Rights): Promise<number> {
    this.fdstat.fs_rights_base = rights_b;
    this.fdstat.fs_rights_inheriting = rights_i;
    return constants.WASI_ESUCCESS;
  }

  async setFdstatFlags(flags: Fdflags): Promise<number> {
    this.fdstat.fs_flags = flags;
    return constants.WASI_ESUCCESS;
  }

  async close(): Promise<number> {
    return constants.WASI_ESUCCESS;
  }

  isatty(): boolean {
    return false;
  }

  abstract read(len: number): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract read_str(): Promise<{ err: number; content: string }>;
  abstract arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }>;
  abstract pwrite(
    buffer: ArrayBuffer,
    pos: bigint
  ): Promise<{ err: number; written: bigint }>;
  abstract seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }>;
  abstract readdir(
    refresh: boolean
  ): Promise<{ err: number; dirents: Dirent[] }>;
  abstract writableStream(): Promise<{ err: number; stream: WritableStream }>;
  abstract truncate(size: bigint): Promise<number>;
  abstract getFilestat(): Promise<Filestat>;
  abstract setFilestatTimes(atim: Timestamp, mtim: Timestamp): Promise<number>;
}

class VirtualFilesystemFileDescriptor extends VirtualFilesystemDescriptor {
  private cursor: number;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    private desc: vfs.FileDescriptor
  ) {
    super(
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      desc.getInode().getMetadata()
    );
    this.cursor = 0;
  }

  override async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return {
      err: constants.WASI_ESUCCESS,
      buffer: this.desc.getInode().data,
    };
  }

  override async pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return {
      err: constants.WASI_ESUCCESS,
      buffer: this.desc.getInode().data.slice(Number(pos), len + Number(pos)),
    };
  }

  override async read(
    len: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    const buffer = this.desc
      .getInode()
      .arrayBuffer.slice(this.cursor, this.cursor + len);
    this.cursor += buffer.byteLength;

    return {
      err: constants.WASI_ESUCCESS,
      buffer,
    };
  }

  override async read_str(): Promise<{ err: number; content: string }> {
    return {
      err: constants.WASI_ESUCCESS,
      content: new TextDecoder().decode(this.desc.getInode().arrayBuffer),
    };
  }

  override async write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }> {
    try {
      return {
        err: constants.WASI_ESUCCESS,
        written: await this.desc.getInode().write(buffer, this.cursor),
      };
    } catch (e: vfs.VirtualFSError) {
      return e.errno;
    }
  }

  override async pwrite(
    buffer: ArrayBuffer,
    offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    try {
      return {
        err: constants.WASI_ESUCCESS,
        written: await this.desc.getInode().write(buffer, Number(offset)),
      };
    } catch (e: vfs.VirtualFSError) {
      return e.errno;
    }
  }

  override async readdir(
    _refresh: boolean
  ): Promise<{ err: number; dirents: Dirent[] }> {
    return {
      err: constants.WASI_ENOTDIR,
      dirents: undefined,
    };
  }

  override async seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    const size = BigInt((await this.desc.getInode().ino._data).length);
    switch (whence) {
      case constants.WASI_WHENCE_CUR:
        if (this.cursor + Number(offset) < 0n) {
          return { offset: BigInt(this.cursor), err: constants.WASI_EINVAL };
        }
        this.cursor += Number(offset);
        break;
      case constants.WASI_WHENCE_SET:
        if (offset < 0n) {
          return { offset: BigInt(this.cursor), err: constants.WASI_EINVAL };
        }
        this.cursor = Number(offset);
        break;
      case constants.WASI_WHENCE_END:
        if (size < -offset) {
          return { offset: BigInt(this.cursor), err: constants.WASI_EINVAL };
        }
        this.cursor = Number(size + offset);
        break;
      default:
        return { offset: BigInt(this.cursor), err: constants.WASI_EINVAL };
    }
    return { err: constants.WASI_ESUCCESS, offset: BigInt(this.cursor) };
  }

  override async truncate(size: bigint): Promise<number> {
    try {
      this.desc.getInode().truncate(Number(size));
      return constants.WASI_ESUCCESS;
    } catch (e: vfs.VirtualFSError) {
      return e.errno;
    }
  }

  override async writableStream(): Promise<{
    err: number;
    stream: WritableStream;
  }> {
    try {
      return {
        err: constants.WASI_ESUCCESS,
        stream: this.desc.getInode().createWriteStream,
      };
    } catch (e: vfs.VirtualFSError) {
      return e.errno;
    }
  }

  async getFilestat(): Promise<Filestat> {
    return wasiFilestat(this.desc.getInode().getMetadata());
  }

  async setFilestatTimes(mtim?: Timestamp, atim?: Timestamp): Promise<number> {
    let metadata = this.desc.getInode().getMetadata();
    if (mtim !== undefined) metadata.mtime = mtim;
    if (atim !== undefined) metadata.atime = atim;
    return constants.WASI_ESUCCESS;
  }
}

class VirtualFilesystemDirectoryDescriptor extends VirtualFilesystemDescriptor {
  private dirents: Dirent[];

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    public dir: vfs.Directory,
    private inodeMgr: vfs.InodeManager
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, dir.getMetadata());
    this.dirents = undefined;
  }

  override async arrayBuffer(): Promise<{
    err: number;
    buffer: ArrayBuffer;
  }> {
    return {
      err: constants.WASI_EISDIR,
      buffer: undefined,
    };
  }

  override async pread(
    _len: number,
    _pos: bigint
  ): Promise<{
    err: number;
    buffer: ArrayBuffer;
  }> {
    return {
      err: constants.WASI_EISDIR,
      buffer: undefined,
    };
  }

  override async read(_len: number): Promise<{
    err: number;
    buffer: ArrayBuffer;
  }> {
    return {
      err: constants.WASI_EISDIR,
      buffer: undefined,
    };
  }

  override async read_str(): Promise<{ err: number; content: string }> {
    return {
      err: constants.WASI_EISDIR,
      content: "",
    };
  }

  override async pwrite(
    _buffer: ArrayBuffer,
    _offset: bigint
  ): Promise<{
    err: number;
    written: bigint;
  }> {
    return {
      err: constants.WASI_EISDIR,
      written: -1n,
    };
  }

  override async write(_buffer: ArrayBuffer): Promise<{
    err: number;
    written: bigint;
  }> {
    return {
      err: constants.WASI_EISDIR,
      written: -1n,
    };
  }

  async seek(
    _offset: bigint,
    _whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    return { err: constants.WASI_EISDIR, offset: -1n };
  }

  async truncate(_size: bigint): Promise<number> {
    return constants.WASI_EISDIR;
  }

  async writableStream(): Promise<{ err: number; stream: WritableStream }> {
    return { err: constants.WASI_EISDIR, stream: undefined };
  }

  async readdir(refresh: boolean): Promise<{
    err: number;
    dirents: Dirent[];
  }> {
    try {
      if (this.dirents === undefined || refresh) {
        this.dirents = this.dir
          .getEntries()
          .enumerate(([name, inode]: [string, number], index: number) => {
            return {
              d_next: index + 1,
              d_ino: inode,
              name: name,
              d_type: wasiFiletype(this.inodeMgr.getINode(inode).getMetadata()),
            };
          });
      }
      return {
        err: constants.WASI_ESUCCESS,
        dirents: this.dirents,
      };
    } catch (e: vfs.VirtualFSError) {
      return {
        err: e.errno,
        dirents: [],
      };
    }
  }

  async getFilestat(): Promise<Filestat> {
    return wasiFilestat(this.dir.getMetadata());
  }

  async setFilestatTimes(mtim?: Timestamp, atim?: Timestamp): Promise<number> {
    let metadata = this.dir.getMetadata();
    if (mtim !== undefined) metadata.mtime = mtim;
    if (atim !== undefined) metadata.atime = atim;
    return constants.WASI_ESUCCESS;
  }
}
