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

export interface Descriptor {
  getFdstat(): Promise<Fdstat>;
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

  read(len: number, buffer: DataView): Promise<number>;
  pread(len: number, pos: bigint, buffer: DataView): Promise<number>;

  write(buffer: DataView, len: number): Promise<number>;
  pwrite(buffer: Uint8Array, len: number, pos: bigint): Promise<number>;

  seek(
    offset: number,
    whence: Whence
  ): Promise<{
    err: number;
    offset: number;
  }>;

  truncate(size: number): Promise<number>;

  readdir(
    buffer: DataView,
    len: number,
    cookie: number
  ): Promise<{ err: number; size: number }>;
}

export interface Filesystem {
  getMounts(): Record<string, Filesystem>;
  addMount(path: string, mountedFs: Filesystem): Promise<number>;
  removeMount(absolutePath: string): Promise<number>;

  createDir(path: string): Promise<number>;
  getFilestat(path: string): Promise<{ err: number; filestat: Filestat }>;
  setFilestatTimes(
    path: string,
    lookupFlags: LookupFlags,
    fstflags: Fstflags,
    atim: Timestamp,
    mtim: Timestamp
  ): Promise<number>;
  // missing path_link
  open(
    path: string,
    dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags
  ): Promise<Descriptor>;
  readlink(path: string, buffer: DataView, len: number): Promise<number>;
  removeDirectory(path: string): Promise<number>;
  rename(oldPath: string, newPath: string): Promise<number>;
  addSymlink(source: string, target: string): Promise<number>;
  unlinkFile(path: string): Promise<number>;
}
