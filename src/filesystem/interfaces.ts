import {
  FdFlags,
  FileOrDir,
  LookupFlags,
  Metadata,
  OpenFlags,
  Rights,
  Stat,
} from "./enums";
import { FsaDirectory, FsaFile } from "./filesystem";

export type Mount = { parts: string[]; name: string; dir: FsaDirectory };

export interface Filesystem {
  isDebug(): boolean;

  getRootDir(): FsaDirectory;

  getMetaDir(): FsaDirectory;

  getParent(
    dir: FsaDirectory,
    path: string
  ): Promise<{ err: number; name: string; parent: FsaDirectory }>;

  getDirectory(
    dir: FsaDirectory,
    name: string,
    options: { create: boolean },
    lookupFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: FsaDirectory }>;

  getFile(
    dir: FsaDirectory,
    name: string,
    options: { create: boolean },
    lookupFlags?: LookupFlags,
    openFlags?: OpenFlags,
    fsRightsBase?: Rights,
    fsRightsInheriting?: Rights,
    fdFlags?: FdFlags
  ): Promise<{ err: number; entry: FsaFile }>;

  entries(dir: FsaDirectory): Promise<DirEntry[]>;

  resolveAbsolute(
    path: string
  ): Promise<{ err: number; name: string; dir: FsaDirectory }>;

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
  path(): string;

  name(): string;

  metadata(): Promise<Metadata>;

  stat(): Promise<Stat>;
}

export interface DirEntry extends Entry {}
