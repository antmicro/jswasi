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
}
