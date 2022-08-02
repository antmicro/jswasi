import {
  FdFlags,
  FileOrDir,
  LookupFlags,
  Metadata,
  OpenFlags,
  Rights,
  Stat,
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

  stat(): Promise<Stat>;
}

export interface DirEntry extends Entry {}

export interface Directory extends Entry {
  open(): OpenDirectory;
}

export interface OpenDirectory extends Entry {
  isPreopened: boolean;
  isatty(): boolean;
  fdRights: bigint;

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
  open(): Promise<OpenFile & StreamableFile>;
}

export interface StreamableFile {
  arrayBuffer(): Promise<ArrayBufferView | ArrayBuffer>;

  readableStream(): Promise<ReadableStream>;

  writableStream(): Promise<WritableStream>;
}

export interface OpenFile extends Entry {
  isatty(): boolean;
  isPreopened: boolean;
  fdRights: bigint;

  read(len: number): Promise<[Uint8Array, number]>;

  scheduleRead(
    workerId: number,
    requestedLen: number,
    sbuf: SharedArrayBuffer
  ): Promise<void>;

  write(buffer: Uint8Array): Promise<number>;

  close(): Promise<void>;

  copyEntry(oldFd: OpenDirectory, path: string): Promise<number>;

  seek(offset: number, whence: number): Promise<number>;

  truncate(size: number): Promise<void>;
}
