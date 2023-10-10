import {
  AbstractDirectoryDescriptor,
  AbstractFileDescriptor,
  Dirent,
  Timestamp,
  Whence,
  Fdflags,
  Rights,
  Filestat,
} from "../filesystem.js";
import { UserData, PollEvent, EventType } from "../../types.js";
import * as proc from "./proc-tree.js";
import * as constants from "../../constants.js";

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
