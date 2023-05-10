import * as constants from "../constants.js";

export type LookupFlags = number;
export type OpenFlags = number;
export type Fdflags = number;
export type Rights = bigint;

export type Device = bigint;
export type Inode = bigint;
export type Filetype = number;
export type Linkcount = bigint;
export type Filesize = bigint;
export type Timestamp = bigint;

export type Whence = number;

export type Fstflags = number;

export type Dircookie = bigint;

export type Filestat = {
  dev: Device;
  ino: Inode;
  filetype: Filetype;
  nlink: Linkcount;
  size: Filesize;
  mtim: Timestamp;
  atim: Timestamp;
  ctim: Timestamp;
};

export type Fdstat = {
  fs_filetype: Filetype;
  fs_flags: Fdflags;
  fs_rights_base: Rights;
  fs_rights_inheriting: Rights;
};

// This is not exactly a Dirent struct defined in wasi.
// d_namlen is replaced with name for convenience
export type Dirent = {
  d_next: Dircookie;
  d_ino: Inode;
  name: string;
  d_type: Filetype;
};

export interface Descriptor {
  /*
   * Returns descriptor fdstat structutre
   */
  getFdstat(): Promise<Fdstat>;

  /*
   * Returns descriptor filestat structutre
   */
  getFilestat(): Promise<Filestat>;

  /*
   * Initializes the descriptor using async functions that cannot be executed in the constructor
   * @param path - path of a file associated with the descriptor
   */
  initialize(path: string): Promise<void>;

  /*
   * Getter for descriptor path
   */
  getPath(): string;

  /*
   * Sets times associated with the file
   *
   * @param atim - access time
   * @param mtim - modification time
   *
   * @returns status code
   *
   * @see https://github.com/WebAssembly/WASI/blob/main/phases/snapshot/docs.md#-fstflags-record
   */
  setFilestatTimes(atim: Timestamp, mtim: Timestamp): Promise<number>;

  /*
   * Sets fdflags for the descriptor
   * @param flags - flags to set
   *
   * @returns status code
   *
   * @see https://github.com/WebAssembly/WASI/blob/main/phases/snapshot/docs.md#-fdflags-record
   */
  setFdstatFlags(flags: Fdflags): Promise<number>;

  /*
   * Sets rights for the descriptor
   * @param rightsBase - base rights
   * @param rightsInheriting - inheriting rights
   *
   * @returns status code
   *
   * @see https://github.com/WebAssembly/WASI/blob/main/phases/snapshot/docs.md#-rights-record
   */
  setFdstatRights(
    rightsBase: Rights,
    rightsInheriting: Rights
  ): Promise<number>;

  /*
   * closes the descriptor
   */
  close(): Promise<number>;

  /*
   * Reads contents of the underlying file
   *
   * @param len - number of bytes to read
   *
   * @returns an object holding
   * err - error code
   * buffer - ArrayBuffer with read data
   */
  // original: read(len: number): Promise<{ err: number; buffer: ArrayBuffer }>;
  read(
    len: number,
    sharedBuff?: ArrayBuffer,
    workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }>;

  /*
   * Auxiliary function for internal purposes when we
   * are certain that content of the file is utf-8 text and
   * is relatively short
   */
  read_str(): Promise<{ err: number; content: string }>;

  /*
   * Read contents of the underlying file at a given position, ignoring the file cursor
   *
   * @param len - number of bytes to read
   * @param pos - position from where to start reading
   *
   * @returns an object holding:
   * err - status code
   * buffer - ArrayBuffer with read data
   */
  pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }>;

  /*
   * returns the whole ArrayBuffer of the underlying file
   *
   * @returns an object holding:
   * err - status code
   * buffer - a buffer of the underlying file
   */
  arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }>;

  /*
   * Writes data to the underlying file
   *
   * @param buffer - data to write
   *
   * @returns an object holding:
   * err - error code
   * written - number of succesfully written bytes
   */
  write(buffer: ArrayBuffer): Promise<{ err: number; written: bigint }>;

  /*
   * Writes data to the underlying file at a given position, ignoring the file cursor
   *
   * @param buffer - data to write
   * @param offset - position from where to start writing
   *
   * @returns an object holding:
   * err - error code
   * written - number of succesfully written bytes
   */
  pwrite(
    buffer: ArrayBuffer,
    offset: bigint
  ): Promise<{ err: number; written: bigint }>;

  /*
   * Moves the file cursor to the demanded position
   *
   * @param offset - number of bytes to move the cursor
   * @param whence - a position from where to move the cursor
   *
   * @returns an object holding:
   * err - status code
   * offset - number of bytes succesfully moved
   */
  seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }>;

  /*
   * Lists the contents of the underlying directory
   *
   * @param refresh - boolean, if set, it refreshes the underlying list of entries
   *
   * @returns an object holding:
   * err - status code
   * dirents - an array holding dirent structures for the directory contents
   */
  readdir(refresh: boolean): Promise<{ err: number; dirents: Dirent[] }>;

  /*
   * Get writable stream of the underlying file
   *
   * @returns an object holding:
   * err - status code
   * stream - writable stream
   */
  writableStream(): Promise<{ err: number; stream: WritableStream }>;

  /*
   * Tells if the descriptor is a terminal
   */
  isatty(): boolean;

  /*
   * Truncates the underlying file to a given size
   *
   * @param size - the size of the file to truncate to
   *
   * @returns status code
   */
  truncate(size: bigint): Promise<number>;
}

export abstract class AbstractDescriptor implements Descriptor {
  fdstat: Fdstat;
  path: string;

  async getFdstat(): Promise<Fdstat> {
    return this.fdstat;
  }

  async initialize(path: string): Promise<void> {
    this.path = path;
  }

  getPath(): string {
    return this.path;
  }

  async setFdstatFlags(flags: Fdflags): Promise<number> {
    this.fdstat.fs_flags = flags;
    return constants.WASI_ESUCCESS;
  }

  async setFdstatRights(
    rightsBase: Rights,
    rightsInheriting: Rights
  ): Promise<number> {
    this.fdstat.fs_rights_base = rightsBase;
    this.fdstat.fs_rights_inheriting = rightsInheriting;
    return constants.WASI_ESUCCESS;
  }

  abstract getFilestat(): Promise<Filestat>;
  abstract setFilestatTimes(atim: Timestamp, mtim: Timestamp): Promise<number>;
  abstract close(): Promise<number>;
  abstract read(
    len: number,
    sharedBuff?: ArrayBuffer,
    workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract read_str(): Promise<{ err: number; content: string }>;
  abstract pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }>;
  abstract write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }>;
  abstract pwrite(
    buffer: ArrayBuffer,
    offset: bigint
  ): Promise<{ err: number; written: bigint }>;
  abstract seek(
    offset: bigint,
    whence: Whence
  ): Promise<{ err: number; offset: bigint }>;
  abstract readdir(
    refresh: boolean
  ): Promise<{ err: number; dirents: Dirent[] }>;
  abstract writableStream(): Promise<{ err: number; stream: WritableStream }>;
  abstract isatty(): boolean;
  abstract truncate(size: bigint): Promise<number>;
}

export abstract class AbstractFileDescriptor extends AbstractDescriptor {
  isatty(): boolean {
    return false;
  }
  async readdir(
    _refresh: boolean
  ): Promise<{ err: number; dirents: Dirent[] }> {
    return {
      err: constants.WASI_ENOTDIR,
      dirents: undefined,
    };
  }
}

export abstract class AbstractDirectoryDescriptor extends AbstractDescriptor {
  async close(): Promise<number> {
    return constants.WASI_EISDIR;
  }

  async read(
    _len: number,
    _sharedBuff?: ArrayBuffer,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EISDIR, buffer: undefined };
  }

  async read_str(): Promise<{ err: number; content: string }> {
    return { err: constants.WASI_EISDIR, content: undefined };
  }

  async pread(
    _len: number,
    _pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EISDIR, buffer: undefined };
  }

  async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EISDIR, buffer: undefined };
  }

  async write(_buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_EISDIR, written: -1n };
  }

  async pwrite(
    _buffer: ArrayBuffer,
    _offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_EISDIR, written: -1n };
  }

  async seek(
    _offset: bigint,
    _whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    return { err: constants.WASI_EISDIR, offset: -1n };
  }

  async writableStream(): Promise<{ err: number; stream: WritableStream }> {
    return { err: constants.WASI_EISDIR, stream: undefined };
  }

  isatty(): boolean {
    return false;
  }

  async truncate(_size: bigint): Promise<number> {
    return constants.WASI_EISDIR;
  }
}

export abstract class AbstractDeviceDescriptor extends AbstractDescriptor {
  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights
  ) {
    super();
    this.fdstat = {
      fs_flags,
      fs_rights_base,
      fs_rights_inheriting,
      fs_filetype: constants.WASI_FILETYPE_CHARACTER_DEVICE,
    };
  }
  async getFilestat(): Promise<Filestat> {
    return undefined;
  }

  async setFilestatTimes(_atim: Timestamp, _mtim: Timestamp): Promise<number> {
    return constants.WASI_EBADF;
  }

  async close(): Promise<number> {
    return constants.WASI_EBADF;
  }

  async read(
    _len: number,
    _sharedBuff?: ArrayBuffer,
    _workerId?: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EBADF, buffer: undefined };
  }

  async read_str(): Promise<{ err: number; content: string }> {
    return { err: constants.WASI_EBADF, content: undefined };
  }

  async pread(
    _len: number,
    _pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EBADF, buffer: undefined };
  }

  async arrayBuffer(): Promise<{ err: number; buffer: ArrayBuffer }> {
    return { err: constants.WASI_EBADF, buffer: undefined };
  }

  async write(_buffer: ArrayBuffer): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_EBADF, written: -1n };
  }

  async pwrite(
    _buffer: ArrayBuffer,
    _offset: bigint
  ): Promise<{ err: number; written: bigint }> {
    return { err: constants.WASI_EBADF, written: -1n };
  }

  async seek(
    _offset: bigint,
    _whence: Whence
  ): Promise<{ err: number; offset: bigint }> {
    return { err: constants.WASI_EBADF, offset: -1n };
  }

  async readdir(
    _refresh: boolean
  ): Promise<{ err: number; dirents: Dirent[] }> {
    return { err: constants.WASI_EBADF, dirents: undefined };
  }

  async writableStream(): Promise<{ err: number; stream: WritableStream }> {
    return { err: constants.WASI_EBADF, stream: undefined };
  }

  async truncate(_size: bigint): Promise<number> {
    return constants.WASI_EBADF;
  }
}

export interface Filesystem {
  mkdirat(desc: Descriptor, path: string): Promise<number>;
  getFilestat(path: string): Promise<{ err: number; filestat: Filestat }>;
  // missing path_link
  open(
    path: string,
    dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags
  ): Promise<{ err: number; index: number; desc: Descriptor }>;
  unlinkat(desc: Descriptor, path: string, is_dir: boolean): Promise<number>;
  renameat(
    oldDesc: Descriptor,
    oldPath: string,
    newDesc: Descriptor,
    newPath: string
  ): Promise<number>;
  symlinkat(
    target: string,
    desc: Descriptor,
    linkpath: string
  ): Promise<number>;
  initialize(opts: Object): Promise<number>;
  mknodat(desc: Descriptor, path: string, dev: number): Promise<number>;
}
