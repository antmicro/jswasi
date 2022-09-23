import {
  FdFlags,
  FileOrDir,
  LookupFlags,
  Metadata,
  OpenFlags,
  Rights,
  Stat,
  StoredData,
} from "./enums";

export type Mount = { parts: string[]; name: string; dir: Directory };

export interface Filesystem {
  getRootDir(): Directory;

  getMetaDir(): Directory;

  resolveAbsolute(
    path: string
  ): Promise<{ err: number; name: string; dir: Directory | null }>;

  pathExists(
    dir: Directory,
    path: string,
    mode?: FileOrDir,
    lookupFlags?: LookupFlags
  ): Promise<boolean>;

  getMounts(): Mount[];

  addMount(
    absolutePath: string,
    mountedHandle: FileSystemDirectoryHandle
  ): Promise<number>;

  isMounted(absolutePath: string): boolean;

  removeMount(absolutePath: string): void;
}

export interface Entry {
  parent(): Directory | null;

  path(): string;

  name(): string;

  metadata(): Promise<Metadata>;

  updateMetadata(metadata: StoredData): any;

  stat(): Promise<Stat>;
}

export interface DirEntry extends Entry {}

export interface Directory extends Entry {
  fileType: number;
  open(
    rightsBase?: bigint,
    rightsInheriting?: bigint,
    fdFlags?: number
  ): OpenDirectory;
}

export interface OpenDirectory extends Entry {
  fileType: number;
  isPreopened: boolean;
  isatty(): boolean;
  rightsBase: bigint;
  rightsInheriting: bigint;
  fdFlags: number;

  getEntry(
    path: string,
    mode: FileOrDir.File,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: File | null }>;

  getEntry(
    path: string,
    mode: FileOrDir.Directory,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: Directory | null }>;

  getEntry(
    path: string,
    mode: FileOrDir,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: File | Directory | null }>;

  getEntry(
    path: string,
    mode: FileOrDir,
    dirFlags: LookupFlags,
    openFlags: OpenFlags,
    fsRightsBase: Rights,
    fsRightsInheriting: Rights,
    fdFlags: FdFlags
  ): Promise<{ err: number; entry: File | Directory | null }>;

  entries(): Promise<DirEntry[]>;

  deleteEntry(
    path: string,
    options: { recursive: boolean }
  ): Promise<{ err: number }>;

  addSymlink(source: string, destination: string): Promise<number>;

  readlink(path: string): Promise<{ err: number; linkedPath: string | null }>;

  copyEntry(oldFd: OpenDirectory, path: string): Promise<number>;

  close(): Promise<void>;

  setAsCwd(): void;
}

export interface File extends Entry {
  fileType: number;
  open(
    rightsBase?: bigint,
    rightsInheriting?: bigint,
    fdFlags?: number
  ): Promise<OpenFile & StreamableFile>;
}

export interface StreamableFile {
  arrayBuffer(): Promise<ArrayBufferView | ArrayBuffer>;

  readableStream(): Promise<ReadableStream>;

  writableStream(): Promise<WritableStream>;
}

export interface OpenFile extends Entry {
  fileType: number;
  isatty(): boolean;
  isPreopened: boolean;
  rightsBase: bigint;
  rightsInheriting: bigint;
  fdFlags: number;

  read(len: number, pread?: bigint): Promise<[Uint8Array, number]>;

  scheduleRead(
    workerId: number,
    requestedLen: number,
    sbuf: SharedArrayBuffer,
    pread?: bigint
  ): Promise<void>;

  write(buffer: Uint8Array): Promise<number>;

  close(): Promise<void>;

  copyEntry(oldFd: OpenDirectory, path: string): Promise<number>;

  seek(offset: number, whence: number): Promise<{ err: number; pos: number }>;

  truncate(size: number): Promise<void>;
}
