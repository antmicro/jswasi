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
import { dirname, basename } from "../utils.js";

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

class VirtualFilesystem implements Filesystem {
  private virtualFs: vfs.VirtualFS;

  constructor() {
    const __devMgr = vfs.DeviceManager();
    const __inoMgr = vfs.InodeManager(__devMgr);
    const [_, __rootDirIno] = __inoMgr.createINode(vfs.Directory, {});
    const __fdMgr = vfs.FileDescriptorManager();
    this.virtualFs = vfs.VirtualFS(
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
    let __path = `${__desc.localPath}/${path}`;

    try {
      this.virtualFs.mkdirSync(__path);
    } catch (e: vfs.VirtualFSError) {
      // TODO: check if these errno numbers are the same as WASI ones
      return e.errno;
    }

    return constants.WASI_ESUCCESS;
  }

  async getFilestat(
    path: string
  ): Promise<{ err: number; filestat: Filestat }> {
    try {
      const __stat = this.virtualFs.statSync(path);
      return {
        err: constants.WASI_ESUCCESS,
        filestat: {
          dev: __stat.dev,
          ino: __stat.ino,
          nlink: __stat.nlink,
          filetype: wasiFiletype(__stat),
          size: __stat.size,
          atim: __stat.atime,
          mtim: __stat.mtime,
          ctim: __stat.ctime,
        },
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
    let __path = `${__desc.localPath}/${path}`;

    try {
      if (is_dir) {
        this.virtualFs.unlinkSync(__path);
      } else {
        this.virtualFs.rmdirSync(__path);
      }
      return constants.WASI_ESUCCESS;
    } catch (e: vfs.VirtualFSError) {
      return e.errno;
    }
  }

  /*
   * Map WASI oflags to POSIX ones
   */
  private static __posixOflags(oflags: OpenFlags): number {
    let __oflags = vfs.constants.O_RDWR | vfs.constants.O_NOFOLLOW;

    if (oflags & constants.WASI_O_CREAT) {
      __oflags |= vfs.constants.O_CREAT;
    }
    if (oflags & constants.WASI_O_DIRECTORY) {
      __oflags |= vfs.constants.O_DIRECTORY;
    }
    if (oflags & constants.WASI_O_EXCL) {
      __oflags |= vfs.constants.O_EXCL;
    }
    if (oflags & constants.WASI_O_TRUNC) {
      __oflags |= vfs.constants.O_TRUNC;
    } else {
      __oflags |= vfs.constants.O_APPEND;
    }
    return __oflags;
  }

  async open(
    path: string,
    dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags
  ): Promise<{ err: number; index: number; desc: Descriptor }> {
    let __oflags = VirtualFilesystem.__posixOflags(oflags);
    try {
      vfs.openSync(path, __oflags, 0o777);
    } catch (e: vfs.VirtualFSError) {
      // 51 means ELOOP, it is returned when symlink is encountered
      if (e.errno === 51) {
      }
    }
  }
}

abstract class VirtualFilesystemDescriptor implements Descriptor {
  protected abstract ino: vfs.Inode;
  protected fdstat: Fdstat;
  protected path: string;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.INode
  ) {
    this.fdstat = {
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      fs_filetype: wasiFiletype(ino.getMetadata()),
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

  async getFilestat(): Promise<Filestat> {
    return this.ino.stat();
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

  abstract setFilestatTimes(atim: Timestamp, mtim: Timestamp): Promise<number>;
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
}

class VirtualFilesystemFileDescriptor extends VirtualFilesystemDescriptor {
  private cursor: number;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    override ino: vfs.File
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
    this.cursor = 0;
  }

  override async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return {
      err: constants.WASI_ESUCCESS,
      buffer: this.ino.data,
    };
  }

  override async pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return {
      err: constants.WASI_ESUCCESS,
      buffer: this.entry.arrayBuffer.slice(len, len + Number(pos)),
    };
  }

  override async read(
    len: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    const buffer = this.entry.arrayBuffer.slice(this.cursor, this.cursor + len);
    this.cursor += buffer.byteLength;

    return {
      err: constants.WASI_ESUCCESS,
      buffer,
    };
  }

  override async read_str(): Promise<{ err: number; content: string }> {
    return {
      err: constants.WASI_ESUCCESS,
      content: new TextDecoder().decode(this.entry.arrayBuffer),
    };
  }

  override async write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }> {
    let uint8view = new Uint8Array(this.entry.arrayBuffer);
  }
}

class VirtualFilesystemDirectoryDescriptor extends VirtualFilesystemDescriptor {
  private dir: vfs.Directory;
  public localPath: string;
}
