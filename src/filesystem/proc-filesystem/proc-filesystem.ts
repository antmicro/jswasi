import * as constants from "../../constants.js";
import {
  Filestat,
  Descriptor,
  Filesystem,
  LookupFlags,
  OpenFlags,
  Rights,
  Fdflags,
  AbstractDirectoryDescriptor,
  AbstractFileDescriptor,
  Dirent,
  Timestamp,
  Whence,
} from "../filesystem.js";
import { UserData, PollEvent, EventType } from "../../types.js";
import ProcessManager from "../../process-manager.js";
import * as proc from "./proc-tree.js";

export class ProcFilesystem implements Filesystem {
  constructor(private processManager: ProcessManager) {
    proc.initialize(this.processManager);
  }

  mkdirat(_desc: Descriptor, _path: string): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  getFilestat(_path: string): Promise<{ err: number; filestat: Filestat }> {
    return Promise.resolve({
      err: constants.WASI_ENOTSUP,
      filestat: undefined,
    });
  }

  open(
    path: string,
    _dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags,
    workerId: number
  ): Promise<{ err: number; index: number; desc: Descriptor }> {
    let currentNode: proc.ProcNode = proc.getTopLevelNode(workerId);
    let err = constants.WASI_ESUCCESS,
      index = -1;

    let start = path.startsWith("/") ? 0 : -1,
      stop = path.indexOf("/", start + 1);

    do {
      const __path =
        stop === -1 ? path.slice(start + 1) : path.slice(start + 1, stop);

      if (
        currentNode.getFilestat().filetype !== constants.WASI_FILETYPE_DIRECTORY
      ) {
        err = constants.WASI_ENOTDIR;
        index = start;
        break;
      }

      const nextNode = (currentNode as proc.ProcDirectory).getNode(__path);
      if (nextNode.err !== constants.WASI_ESUCCESS) {
        err = nextNode.err;
        index = stop;
        break;
      }

      currentNode = nextNode.node;

      const __stop = path.indexOf("/", stop + 1);
      start = stop;
      stop = __stop;
    } while (start !== -1);

    if (stop === 0) {
      index = -1;
      if (err === constants.WASI_ESUCCESS) {
        if (
          oflags & constants.WASI_O_DIRECTORY &&
          currentNode.getFilestat().filetype !==
            constants.WASI_FILETYPE_DIRECTORY
        ) {
          err = constants.WASI_ENOTDIR;
        } else if (
          oflags & constants.WASI_O_CREAT &&
          oflags & constants.WASI_O_EXCL
        ) {
          err = constants.WASI_EEXIST;
        }
      } else if (
        err === constants.WASI_ENOENT &&
        oflags & constants.WASI_O_CREAT
      ) {
        err = constants.WASI_EACCES;
      }
    }

    let desc: Descriptor;
    const __ftype = currentNode.getFilestat().filetype;
    if (__ftype === constants.WASI_FILETYPE_DIRECTORY) {
      desc = new ProcDirectoryDescriptor(
        fdflags,
        fs_rights_base,
        fs_rights_inheriting,
        currentNode as proc.ProcDirectory
      );
    } else {
      const __node =
        __ftype === constants.WASI_FILETYPE_REGULAR_FILE
          ? (currentNode as proc.ProcFile)
          : (currentNode as proc.ProcSymlink);

      desc = new ProcFileDescriptor(
        fdflags,
        fs_rights_base,
        fs_rights_inheriting,
        __node
      );
    }
    return Promise.resolve({ err, index, desc });
  }

  unlinkat(
    _desc: Descriptor,
    _path: string,
    _is_dir: boolean
  ): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  renameat(
    _oldDesc: Descriptor,
    _oldPath: string,
    _newDesc: Descriptor,
    _newPath: string
  ): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  symlinkat(
    _target: string,
    _desc: Descriptor,
    _linkpath: string
  ): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  initialize(_opts: Object): Promise<number> {
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  mknodat(
    _desc: Descriptor,
    _path: string,
    _dev: number,
    _args: Object
  ): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }
}

export class ProcFileDescriptor extends AbstractFileDescriptor {
  private contents: ArrayBuffer;
  private cursor: bigint;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    private procNode: proc.ProcFile | proc.ProcSymlink
  ) {
    super();
    this.fdstat = {
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      fs_filetype: this.procNode.getFilestat().filetype,
    };

    this.contents = new TextEncoder().encode(this.procNode.read());
    this.cursor = 0n;
  }

  addPollSub(
    userdata: UserData,
    eventType: EventType,
    _workerId: number
  ): Promise<PollEvent> {
    return Promise.resolve({
      userdata,
      eventType,
      nbytes: BigInt(this.contents.byteLength),
      error: constants.WASI_ESUCCESS,
    });
  }

  arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      buffer: this.contents,
    });
  }

  close(): Promise<number> {
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  getFilestat(): Promise<{ err: number; filestat: Filestat }> {
    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      filestat: this.procNode.getFilestat(),
    });
  }

  pread(
    len: number,
    offset: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    const buffer = this.contents.slice(Number(offset), Number(offset) + len);

    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      buffer,
    });
  }

  pwrite(
    _buffer: ArrayBuffer,
    _offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    return Promise.resolve({
      err: constants.WASI_EACCES,
      written: 0n,
    });
  }

  read(
    len: number,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    const buffer = this.contents.slice(
      Number(this.cursor),
      Number(this.cursor) + len
    );
    this.cursor += BigInt(buffer.byteLength);

    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      buffer,
    });
  }

  read_str(): Promise<{ err: number; content: string }> {
    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      content: new TextDecoder().decode(this.contents),
    });
  }

  seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    // TODO: this is basically copied from virtual-filesystem
    // this method could be unified for all filesystems and included
    // in AbstractFileDescriptor
    const size = BigInt(this.contents.byteLength);

    switch (whence) {
      case constants.WASI_WHENCE_CUR:
        if (this.cursor + offset < 0n) {
          return Promise.resolve({
            offset: this.cursor,
            err: constants.WASI_EINVAL,
          });
        }
        this.cursor += offset;
        break;
      case constants.WASI_WHENCE_SET:
        if (offset < 0n) {
          return Promise.resolve({
            offset: this.cursor,
            err: constants.WASI_EINVAL,
          });
        }
        this.cursor = offset;
        break;
      case constants.WASI_WHENCE_END:
        if (size < -offset) {
          return Promise.resolve({
            offset: this.cursor,
            err: constants.WASI_EINVAL,
          });
        }
        this.cursor = size + offset;
        break;
      default:
        return Promise.resolve({
          offset: this.cursor,
          err: constants.WASI_EINVAL,
        });
    }
    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      offset: this.cursor,
    });
  }

  setFilestatTimes(_atim: Timestamp, _mtim: Timestamp): Promise<number> {
    return Promise.resolve(constants.WASI_EBADF);
  }

  truncate(_size: bigint): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  writableStream(): Promise<{ err: number; stream: WritableStream }> {
    return Promise.resolve({
      err: constants.WASI_EACCES,
      stream: undefined,
    });
  }

  write(_buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    return Promise.resolve({
      err: constants.WASI_EACCES,
      written: 0n,
    });
  }
}

export class ProcDirectoryDescriptor extends AbstractDirectoryDescriptor {
  private dirents: Dirent[];

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    private procNode: proc.ProcDirectory
  ) {
    super();
    this.fdstat = {
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      fs_filetype: constants.WASI_FILETYPE_DIRECTORY,
    };
  }

  async readdir(refresh: boolean): Promise<{ err: number; dirents: Dirent[] }> {
    if (this.dirents === undefined || refresh) {
      const nodes = this.procNode.listNodes();
      if (nodes.err !== constants.WASI_ESUCCESS)
        return { err: nodes.err, dirents: undefined };

      this.dirents = Object.entries(nodes.nodes).map(([name, entry], index) => {
        return {
          d_next: BigInt(index + 1),
          d_ino: 0n,
          name,
          d_type: entry.getFilestat().filetype,
        };
      });
    }
    return {
      err: constants.WASI_ESUCCESS,
      dirents: this.dirents,
    };
  }

  getFilestat(): Promise<{ err: number; filestat: Filestat }> {
    return Promise.resolve({
      err: constants.WASI_ESUCCESS,
      filestat: this.procNode.getFilestat(),
    });
  }

  setFilestatTimes(_atim: Timestamp, _mtim: Timestamp): Promise<number> {
    return Promise.resolve(constants.WASI_EBADF);
  }
}
