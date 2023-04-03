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

class VirtualFilesystem implements Filesystem {
  private filesMap: Record<string, VirtualFilesystemEntry>;
}

abstract class VirtualFilesystemEntry {
  abstract open(fdflags: Fdflags): Promise<VirtualFilesystemDescriptor>;

  constructor(public filestat: Filestat) {}
}

class VirtualFilesystemFileEntry extends VirtualFilesystemEntry {
  arrayBuffer: ArrayBuffer;
  override async open(fdflags: Fdflags): Promise<VirtualFilesystemDescriptor> {
    return new VirtualFilesystemFileDescriptor(fdflags);
  }
}

class VirtualFilesystemFileEntry extends VirtualFilesystemEntry {
  entries: Record<string, VirtualFilesystemEntry>;
  override async open(fdflags: Fdflags): Promise<VirtualFilesystemDescriptor> {
    return new VirtualFilesystemDirectoryDescriptor(fdflags);
  }
}

abstract class VirtualFilesystemDescriptor implements Descriptor {
  protected abstract entry: VirtualFilesystemEntry;
  protected fdstat: Fdstat;
  protected path: string;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    entry: VirtualFilesystemEntry
  ) {
    this.fdstat = {
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      fs_filetype: entry.filestat.filetype,
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
    return this.entry.filestat;
  }

  async setFilestatTimes(atim: Timestamp, mtim: Timestamp): Promise<number> {
    if (atim !== undefined) this.entry.filestat.atim = atim;
    if (mtim !== undefined) this.entry.filestat.mtim = mtim;
    return constants.WASI_ESUCCESS;
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
}

class VirtualFilesystemFileDescriptor extends VirtualFilesystemDescriptor {
  private cursor: number;

  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    override entry: VirtualFilesystemFileEntry
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, entry);
    this.cursor = 0;
  }

  override async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return {
      err: constants.WASI_ESUCCESS,
      buffer: this.entry.arrayBuffer,
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
