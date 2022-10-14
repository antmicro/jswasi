import { LookupFlags } from "./filesystem/enums";

export type FdFdstatGetArgs = { sharedBuffer: SharedArrayBuffer; fd: number };

export type FdWriteArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  content: Uint8Array;
};

export type FdCloseArgs = { sharedBuffer: SharedArrayBuffer; fd: number };

export type FdFilestatGetArgs = { sharedBuffer: SharedArrayBuffer; fd: number };

export type FdReadArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  len: number;
  pread: bigint;
};

export type FdReaddirArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  cookie: number;
  bufLen: number;
};

export type FdSeekArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  offset: bigint;
  whence: number;
};

export type PathCreateDirectoryArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  path: string;
};

export type PathFilestatGetArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  path: string;
  lookupFlags: LookupFlags;
};

export type PathOpenArgs = {
  sharedBuffer: SharedArrayBuffer;
  dirFd: number;
  path: string;
  lookupFlags: number;
  openFlags: number;
  fsRightsBase: bigint;
  fsRightsInheriting: bigint;
  fdFlags: number;
};

export type Redirect = { mode: string; path: string; fd: number };

export type SpawnArgs = {
  path: string;
  args: string[];
  env: Record<string, string>;
  sharedBuffer: SharedArrayBuffer;
  background: boolean;
  redirects: Redirect[];
};

export type ChdirArgs = { dir: string; sharedBuffer: SharedArrayBuffer };

export type GetCwdArgs = {
  bufLen: number;
  sharedBuffer: SharedArrayBuffer;
};

export type SetEnvArgs = {
  key: string;
  value: string;
  sharedBuffer: SharedArrayBuffer;
};

export type SetEchoArgs = {
  shouldEcho: string;
  sharedBuffer: SharedArrayBuffer;
};

export type IsAttyArgs = { sharedBuffer: SharedArrayBuffer; fd: number };

export type GetPidArgs = { sharedBuffer: SharedArrayBuffer };

export type PathReadlinkArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  path: string;
  bufferLen: number;
};

export type PathRemoveEntryArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  path: string;
};

export type FdPrestatGetArgs = { sharedBuffer: SharedArrayBuffer; fd: number };

export type FdPrestatDirNameArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  pathLen: number;
};

export type PathSymlinkArgs = {
  sharedBuffer: SharedArrayBuffer;
  oldPath: string;
  newFd: number;
  newPath: string;
};

export type PathLinkArgs = {
  sharedBuffer: SharedArrayBuffer;
  oldFd: number;
  oldFlags: LookupFlags;
  oldPath: string;
  newFd: number;
  newPath: string;
};

export type HtermConfArgs = {
  sharedBuffer: SharedArrayBuffer;
  method: string;
  attrib: string;
  val: string;
};

export type PathRenameArgs = {
  sharedBuffer: SharedArrayBuffer;
  oldFd: number;
  oldPath: string;
  newFd: number;
  newPath: string;
};

export type FdTellArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
};

export type FdFilestatSetTimesArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  st_atim: bigint;
  st_mtim: bigint;
  fst_flags: number;
};

export type PathFilestatSetTimesArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  flags: LookupFlags;
  path: string;
  st_atim: bigint;
  st_mtim: bigint;
  fst_flags: number;
};

export type ClockEvent = {
  userdata: bigint;
  clockId: number;
  timeout: bigint;
  precision: bigint;
  flags: number;
};

export type FdReadSub = {
  fd: number;
};

export type FdWriteSub = {
  fd: number;
};

export type EventSub = {
  userdata: bigint;
  eventType: number;
  event: FdReadSub | FdWriteSub;
};

export type PollOneoffArgs = {
  sharedBuffer: SharedArrayBuffer;
  subs: Array<EventSub>;
  events: Array<SharedArrayBuffer>;
};

export type PollEntry = {
  lck: Int32Array;
  data: Int32Array;
};
