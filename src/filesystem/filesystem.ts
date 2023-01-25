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

export type Dirent = {
  d_next: Dircookie;
  d_ino: Inode;
  d_namlen: number;
  d_type: Filetype;
};

export interface Descriptor {
  getFdstat(): Promise<Fdstat>;
  getFilestat(): Promise<Filestat>;
  initialize(path: string): void;

  setFilestatTimes(
    fstflags: Fstflags,
    atim: Timestamp,
    mtim: Timestamp
  ): Promise<number>;
  setFdstatFlags(flags: Fdflags): Promise<number>;
  setFdstatRights(
    rightsBase: Rights,
    rightsInheriting: Rights
  ): Promise<number>;
  close(): Promise<number>;

  read(len: number): Promise<{ err: number; buffer: ArrayBuffer }>;
  /*
   * Auxiliary function for internal purposes when we
   * are certain that content of the file is utf-8 text and
   * is relatively short
   */
  read_str(): Promise<{ err: number; content: string }>;
  pread(
    len: number,
    pos: bigint
  ): Promise<{ err: number; buffer: ArrayBuffer }>;

  write(buffer: DataView): Promise<{ err: number; written: bigint }>;
  pwrite(
    buffer: DataView,
    offset: bigint
  ): Promise<{ err: number; written: bigint }>;

  seek(
    offset: bigint,
    whence: Whence
  ): Promise<{
    err: number;
    offset: bigint;
  }>;

  readdir(refresh: boolean): Promise<{ err: number; dirents: Dirent[] }>;
}

export interface Filesystem {
  createDir(path: string): Promise<number>;
  getFilestat(path: string): Promise<{ err: number; filestat: Filestat }>;
  // missing path_link
  open(
    path: string,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags
  ): Promise<{ err: number; index: number; desc: Descriptor }>;
  readlink(path: string, buffer: DataView, len: number): Promise<number>;
  removeDirectory(path: string): Promise<number>;
  rename(oldPath: string, newPath: string): Promise<number>;
  addSymlink(source: string, target: string): Promise<number>;
  unlinkFile(path: string): Promise<number>;
}
