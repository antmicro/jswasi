import { EventSource } from "./devices.js";
import { LookupFlags } from "./filesystem/filesystem.js";

export type UserData = bigint;
export type EventType = number;

export const POLL_EVENT_BUFSIZE = 32;
export type PollEvent = {
  userdata: UserData;
  error: number;
  eventType: EventType;
  nbytes: bigint;
};

export type BufferRequest = {
  requestedLen: number;
  lck: Int32Array;
  readLen: Int32Array;
  sharedBuffer: Uint8Array;
};

export type FdFdstatGetArgs = { sharedBuffer: SharedArrayBuffer; fd: number };

export type FdWriteArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  content: Uint8Array;
};

export type FdCloseArgs = { sharedBuffer: SharedArrayBuffer; fd: number };

export type FdReadArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  len: number;
  offset: bigint;
};

export type FdReaddirArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  cookie: bigint;
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

export type FilestatGetArgs = {
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
  targetPath: string;
  linkFd: number;
  linkPath: string;
};

export type PathLinkArgs = {
  sharedBuffer: SharedArrayBuffer;
  oldFd: number;
  oldFlags: LookupFlags;
  oldPath: string;
  newFd: number;
  newPath: string;
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

export type FilestatSetTimesArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  flags: LookupFlags;
  path: string;
  st_atim: bigint;
  st_mtim: bigint;
  fst_flags: number;
};

export type ClockSub = {
  userdata: bigint;
  clockId: number;
  timeout: bigint;
  precision: bigint;
  flags: number;
};

export type FdReadWriteSub = {
  fd: number;
};

export type FdEventSub = {
  userdata: bigint;
  eventType: number;
  event: FdReadWriteSub | ClockSub;
};

export type PollOneoffArgs = {
  sharedBuffer: SharedArrayBuffer;
  subs: Array<FdEventSub>;
  eventBuf: SharedArrayBuffer;
  timeout?: bigint;
};

export type PollEntry = {
  lck: Int32Array;
  data: Int32Array;
};

export type HtermEventSub = {
  processId: number;
  eventSourceFd: EventSource;
};

export type EventSourceArgs = {
  sharedBuffer: SharedArrayBuffer;
  eventMask: EventType;
};

export type AttachSigIntArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
};

export type CleanInodesArgs = {
  sharedBuffer: SharedArrayBuffer;
};

export type KillArgs = {
  sharedBuffer: SharedArrayBuffer;
  processId: number;
  signalNumber: number;
};

export type IoctlArgs = {
  sharedBuffer: SharedArrayBuffer;
  fd: number;
  command: number;
};
