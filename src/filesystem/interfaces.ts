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

  getParent(
    dir: Directory,
    path: string
  ): Promise<{ err: number; name: string; parent: Directory }>;

  getDirectory(
    dir: OpenDirectory,
    name: string,
    options: { create: boolean },
    lookupFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: Directory }>;

  getFile(
    dir: OpenDirectory,
    name: string,
    options: { create: boolean },
    lookupFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: File }>;

  dirEntries(dir: OpenDirectory): Promise<DirEntry[]>;

  resolveAbsolute(
    path: string
  ): Promise<{ err: number; name: string; dir: Directory }>;

  pathExists(absolutePath: string, mode: FileOrDir): Promise<boolean>;

  getMounts(): Mount[];

  addMount(
    absolutePath: string,
    mountedHandle: FileSystemDirectoryHandle
  ): Promise<number>;

  isMounted(absolutePath: string): boolean;

  removeMount(absolutePath: string): void;
}

export interface Entry {
  parent(): Directory;

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
  getEntry(
    path: string,
    mode: FileOrDir.File,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: File }>;

  getEntry(
    path: string,
    mode: FileOrDir.Directory,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: Directory }>;

  getEntry(
    path: string,
    mode: FileOrDir,
    dirFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: File | Directory }>;

  getEntry(
    path: string,
    mode: FileOrDir,
    dirFlags: LookupFlags,
    openFlags: OpenFlags,
    fsRightsBase: Rights,
    fsRightsInheriting: Rights,
    fdFlags: FdFlags
  ): Promise<{ err: number; entry: File | Directory }>;

  entries(): Promise<DirEntry[]>;

  deleteEntry(
    path: string,
    options: { recursive: boolean }
  ): Promise<{ err: number }>;

  addSymlink(source: string, destination: string): Promise<number>;

  readlink(path: string): Promise<{ err: number; linkedPath: string | null }>;

  close(): Promise<void>;

  setAsCwd(): void;
}

export interface File extends Entry {
  open(): Promise<OpenFile>;
}

export interface OpenFile extends Entry {
  isatty(): boolean;

  read(len: number): Promise<[Uint8Array, number]>;

  scheduleRead(
    workerId: number,
    requestedLen: number,
    sbuf: SharedArrayBuffer
  ): Promise<void>;

  write(buffer: Uint8Array): Promise<number>;

  close(): Promise<void>;

  seek(offset: number, whence: number): Promise<number>;

  truncate(size: number): Promise<void>;

  arrayBuffer(): Promise<ArrayBufferView | ArrayBuffer>;

  readableStream(): Promise<NodeJS.ReadableStream>;

  writableStream(): Promise<WritableStream>;
}
