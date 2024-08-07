/* eslint-disable camelcase */
import * as constants from "./constants.js";
import * as utils from "./utils.js";
import { LookupFlags } from "./filesystem/filesystem.js";
import {
  ChdirArgs,
  GetCwdArgs,
  FdCloseArgs,
  FdFdstatGetArgs,
  FdPrestatDirNameArgs,
  FdPrestatGetArgs,
  FdReadArgs,
  FdReaddirArgs,
  FdSeekArgs,
  FdTellArgs,
  FdWriteArgs,
  GetPidArgs,
  IsAttyArgs,
  PathCreateDirectoryArgs,
  FilestatGetArgs,
  PathLinkArgs,
  PathOpenArgs,
  PathReadlinkArgs,
  PathRemoveEntryArgs,
  PathSymlinkArgs,
  Redirect,
  SetEchoArgs,
  SetEnvArgs,
  SpawnArgs,
  PathRenameArgs,
  FilestatSetTimesArgs,
  ClockSub,
  FdReadWriteSub,
  FdEventSub,
  PollOneoffArgs,
  EventSourceArgs,
  CleanInodesArgs,
  AttachSigIntArgs,
  MountArgs,
  KillArgs,
  IoctlArgs,
  FdRenumberArgs,
  EventType,
  POLL_EVENT_BUFSIZE,
  FdFdstatSetFlagsArgs,
  UmountArgs,
  MknodArgs,
} from "./types.js";

type ptr = number;

type WASICallbacks = {
  // helper
  setModuleInstance: (instance: WebAssembly.Instance) => void;

  // official syscalls
  environ_sizes_get: (environCountPtr: ptr, environSizePtr: ptr) => number;
  environ_get: (environ: ptr, environBuf: ptr) => number;
  args_sizes_get: (argc: ptr, argvBufSize: ptr) => number;
  args_get: (argv: ptr, argvBuf: ptr) => number;

  fd_prestat_get: (fd: number, buf: ptr) => number;
  fd_fdstat_get: (fd: number, buf: ptr) => number;
  fd_prestat_dir_name: (fd: number, pathPtr: ptr, pathLen: number) => number;
  fd_readdir: (
    fd: number,
    buf: ptr,
    bufLen: number,
    cookie: bigint,
    bufUsedPtr: ptr
  ) => number;
  fd_filestat_get: (fd: number, buf: ptr) => number;
  fd_read: (fd: number, iovs: ptr, iovsLen: number, nRead: ptr) => number;
  fd_write: (fd: number, iovs: ptr, iovsLen: number, nWritten: ptr) => number;
  fd_seek: (
    fd: number,
    offset: BigInt,
    whence: number,
    newOffset: ptr
  ) => number;
  fd_close: (fd: number) => number;
  fd_datasync: any;
  fd_filestat_set_size: any;
  fd_sync: any;
  fd_advise: any;
  fd_allocate: any;
  fd_fdstat_set_flags: any;
  fd_fdstat_set_rights: any;
  fd_tell: (fd: number, pos: ptr) => number;
  fd_pread: (
    fd: number,
    iovs: ptr,
    iovsLen: number,
    offset: bigint,
    nRead: ptr
  ) => number;
  fd_filestat_set_times: (
    fd: number,
    st_atim: bigint,
    st_mtim: bigint,
    fst_flags: number
  ) => number;
  fd_advice: any;
  fd_pwrite: any;
  fd_renumber: any;

  path_filestat_set_times: (
    fd: number,
    flags: LookupFlags,
    path: ptr,
    path_len: number,
    st_atim: bigint,
    st_mtim: bigint,
    fst_flags: number
  ) => number;
  path_filestat_get: (
    fd: number,
    lookupFlags: LookupFlags,
    pathPtr: ptr,
    pathLen: number,
    buf: ptr
  ) => number;
  path_open: (
    dirFd: number,
    lookupFlags: number,
    pathPtr: ptr,
    pathLen: number,
    openFlags: number,
    fsRightsBase: bigint,
    fsRightsInheriting: bigint,
    fdFlags: number,
    openedFdPtr: ptr
  ) => number;
  path_rename: (
    oldFd: number,
    oldPathPtr: ptr,
    oldPathLen: number,
    newFd: number,
    newPathPtr: ptr,
    newPathLen: number
  ) => number;
  path_create_directory: (fd: number, pathPtr: ptr, pathLen: number) => number;
  path_remove_directory: (fd: number, pathPtr: ptr, pathLen: number) => number;
  path_link: (
    oldFd: number,
    oldFlags: number,
    oldPathPtr: ptr,
    oldPathLen: number,
    newFd: number,
    newPathPtr: ptr,
    newPathLen: number
  ) => number;
  path_symlink: (
    oldPathPtr: ptr,
    oldPathLen: number,
    newFd: number,
    newPathPtr: ptr,
    newPathLen: number
  ) => number;
  path_readlink: (
    fd: number,
    pathPtr: ptr,
    pathLen: number,
    bufferPtr: ptr,
    bufferLen: number,
    bufferUsedPtr: ptr
  ) => number;
  path_unlink_file: (fd: number, pathPtr: ptr, pathLen: number) => number;

  sock_accept: any;
  sock_recv: any;
  sock_send: any;
  sock_shutdown: any;

  proc_raise: any;
  sched_yield: any;
  poll_oneoff: any;
  random_get: (bufPtr: ptr, bufLen: number) => number;
  clock_time_get: (clockId: number, precision: number, time: ptr) => number;
  clock_res_get: (clock_id: number) => number;
  proc_exit: (exitCode: number) => void;
};

const CPUTIME_START = utils.msToNs(performance.now());

let started: boolean;
let mod: string;
let myself: number;
let programArgs: string[];
let env: Record<string, string>;

onmessage = async (e) => {
  if (!started) {
    if (e.data[0] === "start") {
      started = true;
      [, mod, myself, programArgs, env] = e.data;

      try {
        await start_wasm();
      } catch (err) {
        sendToKernel(["console", `Worker failed: ${err}`]);
      }
    }
  }
};

// TODO: add class for msg sent to kernel
function sendToKernel(msg: any) {
  // @ts-ignore
  postMessage([myself, ...msg]);
}

function workerConsoleLog(msg: any) {
  // you can control debug logs dynamically based on DEBUG env variable
  if (
    env["DEBUG"] &&
    !(env["DEBUG"] === "0" || env["DEBUG"] === "false" || env["DEBUG"] === "")
  ) {
    sendToKernel(["console", msg]);
  }
}

function doExit(exitCode: number) {
  workerConsoleLog("calling close()");
  sendToKernel(["proc_exit", exitCode]);
  // eslint-disable-next-line no-restricted-globals
  self.close();
}

const whenceMap: Record<number, number> = {
  0: constants.WASI_WHENCE_CUR,
  1: constants.WASI_WHENCE_END,
  2: constants.WASI_WHENCE_SET,
};

function WASI(snapshot0: boolean = false): WASICallbacks {
  let moduleInstanceExports: WebAssembly.Exports;

  function setModuleInstance(instance: WebAssembly.Instance): void {
    moduleInstanceExports = instance.exports;
  }

  function environ_sizes_get(environCountPtr: ptr, environSizePtr: ptr) {
    workerConsoleLog(
      `environ_sizes_get(0x${environCountPtr.toString(
        16
      )}, 0x${environSizePtr.toString(16)})`
    );

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const environCount = Object.keys(env).length;
    view.setUint32(environCountPtr, environCount, true);

    const environSize = Object.entries(env).reduce(
      (sum, [key, val]) =>
        sum + new TextEncoder().encode(`${key}=${val}\0`).byteLength,
      0
    );
    view.setUint32(environSizePtr, environSize, true);

    return constants.WASI_ESUCCESS;
  }

  function environ_get(environ: ptr, environBuf: ptr) {
    workerConsoleLog(
      `environ_get(${environ.toString(16)}, ${environBuf.toString(16)})`
    );

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    Object.entries(env).forEach(([key, val], i) => {
      // set pointer address to beginning of next key value pair
      view.setUint32(environ + i * 4, environBuf, true);
      // write string describing the variable to WASM memory
      const variable = new TextEncoder().encode(`${key}=${val}\0`);
      view8.set(variable, environBuf);
      // calculate pointer to next variable
      environBuf += variable.byteLength;
    });

    return constants.WASI_ESUCCESS;
  }

  function args_sizes_get(argc: ptr, argvBufSize: ptr) {
    workerConsoleLog(
      `args_sizes_get(${argc.toString(16)}, ${argvBufSize.toString(16)})`
    );

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    view.setUint32(argc, programArgs.length, true);
    view.setUint32(
      argvBufSize,
      new TextEncoder().encode(programArgs.join("")).byteLength +
        programArgs.length,
      true
    );

    return constants.WASI_ESUCCESS;
  }

  function args_get(argv: ptr, argvBuf: ptr) {
    workerConsoleLog(`args_get(${argv}, 0x${argvBuf.toString(16)})`);

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    programArgs.forEach((arg, i) => {
      // set pointer address to beginning of next key value pair
      view.setUint32(argv + i * 4, argvBuf, true);
      // write string describing the argument to WASM memory
      const variable = new TextEncoder().encode(`${arg}\0`);
      view8.set(variable, argvBuf);
      // calculate pointer to next variable
      argvBuf += variable.byteLength;
    });

    return constants.WASI_ESUCCESS;
  }

  function fd_fdstat_get(fd: number, buf: ptr) {
    workerConsoleLog(`fd_fdstat_get(${fd}, 0x${buf.toString(16)})`);

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    // lock, filetype, rights base, rights inheriting, fd flags
    const sharedBuffer = new SharedArrayBuffer(4 + 24);
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const fileType = new Uint8Array(sharedBuffer, 4, 1);
    const rights_base = new BigUint64Array(sharedBuffer, 8, 1);
    const rights_inheriting = new BigUint64Array(sharedBuffer, 16, 1);
    const fd_flags = new Uint8Array(sharedBuffer, 24, 1);

    sendToKernel(["fd_fdstat_get", { sharedBuffer, fd } as FdFdstatGetArgs]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      workerConsoleLog(`fd_fdstat_get returned ${err}`);
      return err;
    }

    view.setUint8(buf, fileType[0]);
    view.setUint32(buf + 2, fd_flags[0], true);
    view.setBigUint64(buf + 8, rights_base[0], true);
    view.setBigUint64(buf + 16, rights_inheriting[0], true);

    workerConsoleLog(
      `fd_fdstat_get returned ${err} {file_type: ${fileType[0]} file_flags: 0 rights_base: ${rights_base[0]} rights_inheriting: ${rights_inheriting}}`
    );
    return constants.WASI_ESUCCESS;
  }

  function fd_write(fd: number, iovs: ptr, iovsLen: number, nWritten: ptr) {
    workerConsoleLog(`fd_write(${fd}, ${iovs}, ${iovsLen}, ${nWritten})`);
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    let writeLen = 0;
    const bufferBytes: number[] = [];
    for (let i = 0; i < iovsLen; i += 1) {
      const ptr_pos = iovs + i * 8;
      const buf = view.getUint32(ptr_pos, true);
      const bufLen = view.getUint32(ptr_pos + 4, true);

      const iov = new Uint8Array(
        (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer,
        buf,
        bufLen
      );

      for (let b = 0; b < iov.byteLength; b += 1) {
        bufferBytes.push(iov[b]);
      }
      writeLen += iov.byteLength;
    }

    const sharedBuffer = new SharedArrayBuffer(4 + 4 + writeLen); // lock + written + content
    const lck = new Int32Array(sharedBuffer, 0, 1);
    const written = new Int32Array(sharedBuffer, 4, 1);
    lck[0] = -1;
    let content = Uint8Array.from(bufferBytes);
    sendToKernel(["fd_write", { sharedBuffer, fd, content } as FdWriteArgs]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === 0) {
      workerConsoleLog(`fd_write written ${written} bytes.`);
      view.setUint32(nWritten, written[0], true);
    } else {
      workerConsoleLog(`fd_write returned ${err}.`);
    }
    return err;
  }

  function proc_exit(exitCode: number) {
    workerConsoleLog(`proc_exit(${exitCode})`);
    doExit(exitCode);
  }

  function random_get(bufPtr: ptr, bufLen: number) {
    workerConsoleLog(`random_get(${bufPtr}, ${bufLen})`);
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const numbers = new Uint8Array(bufLen);
    crypto.getRandomValues(numbers);
    view8.set(numbers, bufPtr);
    return constants.WASI_ESUCCESS;
  }

  function clock_res_get(_clock_id: number) {
    return placeholder();
  }

  function clock_time_get(clockId: number, precision: number, time: ptr) {
    workerConsoleLog(`clock_time_get(${clockId}, ${precision}, ${time})`);
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    view.setBigUint64(time, utils.now(clockId, CPUTIME_START), true);
    return constants.WASI_ESUCCESS;
  }

  function fd_close(fd: number) {
    workerConsoleLog(`fd_close(${fd})`);

    const sharedBuffer = new SharedArrayBuffer(4);
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    sendToKernel(["fd_close", { sharedBuffer, fd } as FdCloseArgs]);
    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  function fd_filestat_get(fd: number, buf: ptr) {
    workerConsoleLog(`fd_filestat_get(${fd}, 0x${buf.toString(16)})`);

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 64); // lock, stat buffer
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const statBuf = new DataView(sharedBuffer, 4);

    sendToKernel(["fd_filestat_get", { sharedBuffer, fd } as FilestatGetArgs]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      workerConsoleLog(`fd_filestat_get returned ${err}`);
      return err;
    }

    const dev = statBuf.getBigUint64(0, true);
    const ino = statBuf.getBigUint64(8, true);
    const fileType = statBuf.getUint8(16);
    const nlink = statBuf.getBigUint64(24, true);
    const size = statBuf.getBigUint64(32, true);
    const atim = statBuf.getBigUint64(40, true);
    const mtim = statBuf.getBigUint64(48, true);
    const ctim = statBuf.getBigUint64(56, true);
    if (snapshot0) {
      // in snapshot0, filetype padding is 3 bytes and nlink is u32 instead of u64
      view.setBigUint64(buf, dev, true);
      view.setBigUint64(buf + 8, ino, true);
      view.setUint8(buf + 16, fileType);
      view.setUint32(buf + 20, Number(nlink), true);
      view.setBigUint64(buf + 24, size, true);
      view.setBigUint64(buf + 32, atim, true);
      view.setBigUint64(buf + 40, mtim, true);
      view.setBigUint64(buf + 48, ctim, true);
    } else {
      view.setBigUint64(buf, dev, true);
      view.setBigUint64(buf + 8, ino, true);
      view.setUint8(buf + 16, fileType);
      view.setBigUint64(buf + 24, nlink, true);
      view.setBigUint64(buf + 32, size, true);
      view.setBigUint64(buf + 40, atim, true);
      view.setBigUint64(buf + 48, mtim, true);
      view.setBigUint64(buf + 56, ctim, true);
    }
    workerConsoleLog(
      `fd_filestat_get returned ${err} {dev: ${dev} ino: ${ino} fileType: ${fileType} nlink: ${nlink} size: ${size} atim: ${atim} mtim: ${mtim} ctim: ${ctim}}`
    );

    return constants.WASI_ESUCCESS;
  }

  function fd_read(fd: number, iovs: ptr, iovsLen: number, nRead: ptr) {
    workerConsoleLog(`fd_read(${fd}, ${iovs}, ${iovsLen}, ${nRead})`);

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    let read = 0;
    for (let i = 0; i < iovsLen; i += 1) {
      const addr = view.getUint32(iovs + 8 * i, true);
      const len = view.getUint32(iovs + 8 * i + 4, true);

      // TODO: ripe for optimization, addr and len could be put inside a vector and requested all at once
      const sharedBuffer = new SharedArrayBuffer(4 + 4 + len); // lock, read length, read buffer
      const lck = new Int32Array(sharedBuffer, 0, 1);
      lck[0] = -1;
      const readLen = new Int32Array(sharedBuffer, 4, 1);
      const readBuf = new Uint8Array(sharedBuffer, 8, len);

      sendToKernel([
        "fd_read",
        { sharedBuffer, fd, len, offset: undefined } as FdReadArgs,
      ]);
      Atomics.wait(lck, 0, -1);

      const err = Atomics.load(lck, 0);
      if (err !== constants.WASI_ESUCCESS) {
        return err;
      }

      view8.set(readBuf, addr);
      read += readLen[0];
    }
    if (fd > 2) workerConsoleLog(`fd_read read ${read} bytes.`);
    view.setUint32(nRead, read, true);

    return constants.WASI_ESUCCESS;
  }
  function fd_pread(
    fd: number,
    iovs: ptr,
    iovsLen: number,
    offset: bigint,
    nRead: ptr
  ) {
    if (fd > 2)
      workerConsoleLog(`fd_pread(${fd}, ${iovs}, ${iovsLen}, ${nRead})`);

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    let read = 0;
    for (let i = 0; i < iovsLen; i += 1) {
      const addr = view.getUint32(iovs + 8 * i, true);
      const len = view.getUint32(iovs + 8 * i + 4, true);

      const sharedBuffer = new SharedArrayBuffer(4 + 4 + len); // lock, read length, read buffer
      const lck = new Int32Array(sharedBuffer, 0, 1);
      lck[0] = -1;
      const readLen = new Int32Array(sharedBuffer, 4, 1);
      const readBuf = new Uint8Array(sharedBuffer, 8, len);
      sendToKernel([
        "fd_pread",
        { sharedBuffer, fd, len, offset } as FdReadArgs,
      ]);
      Atomics.wait(lck, 0, -1);

      const err = Atomics.load(lck, 0);
      if (err !== constants.WASI_ESUCCESS) {
        return err;
      }

      view8.set(readBuf, addr);
      read += readLen[0];
    }
    if (fd > 2) workerConsoleLog(`fd_pread read ${read} bytes.`);
    view.setUint32(nRead, read, true);

    return constants.WASI_ESUCCESS;
  }

  function fd_readdir(
    fd: number,
    buf: ptr,
    bufLen: number,
    cookie: bigint,
    bufUsedPtr: ptr
  ) {
    workerConsoleLog(
      `fd_readdir(${fd}, ${buf}, ${bufLen}, ${cookie}, ${bufUsedPtr})`
    );

    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 4 + bufLen); // lock, buf_used, buf
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const bufUsed = new Uint32Array(sharedBuffer, 4, 1);
    const dataBuffer = new Uint8Array(sharedBuffer, 8);

    sendToKernel([
      "fd_readdir",
      { sharedBuffer, fd, cookie, bufLen } as FdReaddirArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    view8.set(dataBuffer, buf);
    view.setUint32(bufUsedPtr, bufUsed[0], true);

    return constants.WASI_ESUCCESS;
  }

  function fd_seek(fd: number, offset: BigInt, whence: number, newOffset: ptr) {
    workerConsoleLog(`fd_seek(${fd}, ${offset}, ${whence}, ${newOffset})`);
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 4 + 8); // lock, _padding, file_pos
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const file_pos = new BigUint64Array(sharedBuffer, 8, 1);
    const whence_ = snapshot0 ? whenceMap[whence] : whence;

    sendToKernel([
      "fd_seek",
      { sharedBuffer, fd, offset, whence: whence_ } as FdSeekArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    workerConsoleLog(`fd_seek returned ${err}, file_pos = ${file_pos[0]}`);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    view.setBigUint64(newOffset, file_pos[0], true);
    return constants.WASI_ESUCCESS;
  }

  function path_create_directory(fd: number, pathPtr: ptr, pathLen: number) {
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const path = new TextDecoder().decode(
      view8.slice(pathPtr, pathPtr + pathLen)
    );

    workerConsoleLog(
      `path_create_directory(${fd}, ${path}, ${pathLen}) [path=${path}]`
    );

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "path_create_directory",
      { sharedBuffer, fd, path } as PathCreateDirectoryArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  function path_filestat_get(
    fd: number,
    lookupFlags: LookupFlags,
    pathPtr: ptr,
    pathLen: number,
    buf: ptr
  ) {
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const path = new TextDecoder().decode(
      view8.slice(pathPtr, pathPtr + pathLen)
    );

    workerConsoleLog(
      `path_filestat_get(${fd}, ${lookupFlags}, ${path}, ${pathLen}, 0x${buf.toString(
        16
      )}) [path=${path}]`
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 64); // lock, stat buffer
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const statBuf = new DataView(sharedBuffer, 4);

    sendToKernel([
      "path_filestat_get",
      { sharedBuffer, fd, path, lookupFlags } as FilestatGetArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    workerConsoleLog(`path_filestat_get returned ${err}`);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    const dev = statBuf.getBigUint64(0, true);
    const ino = statBuf.getBigUint64(8, true);
    const fileType = statBuf.getUint8(16);
    const nlink = statBuf.getBigUint64(24, true);
    const size = statBuf.getBigUint64(32, true);
    const atim = statBuf.getBigUint64(40, true);
    const mtim = statBuf.getBigUint64(48, true);
    const ctim = statBuf.getBigUint64(56, true);

    if (snapshot0) {
      view.setBigUint64(buf, dev, true);
      view.setBigUint64(buf + 8, ino, true);
      view.setUint8(buf + 16, fileType);
      view.setUint32(buf + 20, Number(nlink), true);
      view.setBigUint64(buf + 24, size, true);
      view.setBigUint64(buf + 32, atim, true);
      view.setBigUint64(buf + 40, mtim, true);
      view.setBigUint64(buf + 48, ctim, true);
    } else {
      view.setBigUint64(buf, dev, true);
      view.setBigUint64(buf + 8, ino, true);
      view.setUint8(buf + 16, fileType);
      view.setBigUint64(buf + 24, nlink, true);
      view.setBigUint64(buf + 32, size, true);
      view.setBigUint64(buf + 40, atim, true);
      view.setBigUint64(buf + 48, mtim, true);
      view.setBigUint64(buf + 56, ctim, true);
    }
    return constants.WASI_ESUCCESS;
  }

  function path_open(
    dirFd: number,
    lookupFlags: number,
    pathPtr: ptr,
    pathLen: number,
    openFlags: number,
    fsRightsBase: bigint,
    fsRightsInheriting: bigint,
    fdFlags: number,
    openedFdPtr: ptr
  ) {
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const path = new TextDecoder().decode(
      view8.slice(pathPtr, pathPtr + pathLen)
    );

    workerConsoleLog(
      `path_open(dirFd=${dirFd}, lookupFlags=${lookupFlags}, pathPtr=0x${pathPtr.toString(
        16
      )}, pathLen=${pathLen}, openFlags=${openFlags}, fsRightsBase=${fsRightsBase}, fsRightsInheriting=${fsRightsInheriting}, fdFlags=${fdFlags}, openedFdPtr=0x${openedFdPtr.toString(
        16
      )}) [path=${path}]`
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 4); // lock, opened fd
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const opened_fd = new Int32Array(sharedBuffer, 4, 1);
    sendToKernel([
      "path_open",
      {
        sharedBuffer,
        dirFd,
        path,
        lookupFlags,
        openFlags,
        fsRightsBase,
        fsRightsInheriting,
        fdFlags,
      } as PathOpenArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    view.setUint32(openedFdPtr, opened_fd[0], true);
    return constants.WASI_ESUCCESS;
  }

  // used solely in path_readlink
  function specialParse(
    syscallDataJson: string,
    outputBuffer: Uint8Array
  ): {
    exitStatus: number;
    outputSize: number;
  } {
    const {
      command,
      buf_len,
      buf_ptr,
    }: {
      command: string;
      buf_len: number;
      buf_ptr: number;
    } = JSON.parse(syscallDataJson);
    const json = new TextDecoder().decode(
      new Uint8Array(
        (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer,
        buf_ptr,
        buf_len
      )
    );
    switch (command) {
      case "spawn": {
        // wasi_ext_lib::spawn needs: int process_exit_status, int child_pid
        if (outputBuffer.byteLength < 8) {
          return {
            exitStatus: constants.WASI_ENOBUFS,
            outputSize: 0,
          };
        }

        // lock + child PID
        const sharedBuffer = new SharedArrayBuffer(4 + 4);

        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;
        const {
          path,
          args,
          extended_env,
          redirects_ptr,
          n_redirects,
          background,
        }: {
          path: string;
          args: string[];
          extended_env: Record<string, string>;
          background: boolean;
          redirects_ptr: number;
          n_redirects: number;
        } = JSON.parse(json);
        workerConsoleLog(
          `${path} ${args} ${extended_env} ${background} ${redirects_ptr}, ${n_redirects}`
        );

        const view = new DataView(
          (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
        );
        let redirects: Redirect[] = [];
        let redirectsPtr = redirects_ptr;

        for (let i = 0; i < n_redirects; i++) {
          const data_ptr = redirectsPtr;
          const fd_dst = view.getUint32(redirectsPtr + 8, true);
          const type = view.getUint32(redirectsPtr + 8 + 4, true);

          // 8 data bytes, 4 fd_dst bytes, 4 type bytes, 0 bytes of padding
          redirectsPtr += 8 + 4 + 4;

          let redirect = {
            type,
            fd_dst,
            path: undefined,
            fd_src: undefined,
          } as Redirect;

          switch (type) {
            case constants.WASI_EXT_REDIRECT_TYPE_READ:
            case constants.WASI_EXT_REDIRECT_TYPE_WRITE:
            case constants.WASI_EXT_REDIRECT_TYPE_APPEND:
            case constants.WASI_EXT_REDIRECT_TYPE_READWRITE: {
              let path_ptr = view.getUint32(data_ptr, true);
              let path_len = view.getUint32(data_ptr + 4, true);
              let path = new TextDecoder().decode(
                view.buffer.slice(path_ptr, path_ptr + path_len)
              );

              redirect.path = path;
              break;
            }
            case constants.WASI_EXT_REDIRECT_TYPE_PIPEIN:
            case constants.WASI_EXT_REDIRECT_TYPE_PIPEOUT:
            case constants.WASI_EXT_REDIRECT_TYPE_DUPLICATE: {
              let fd_src = view.getUint32(data_ptr, true);

              redirect.fd_src = fd_src;
              break;
            }
            case constants.WASI_EXT_REDIRECT_TYPE_CLOSE: {
              // just skip
              break;
            }
            default: {
              workerConsoleLog(`Spawn: redirect type ${type} not found.`);
              return {
                exitStatus: constants.WASI_EINVAL,
                outputSize: 0,
              };
            }
          }
          redirects.push(redirect);
          workerConsoleLog(
            `Redirect[${i}] = type: ${redirect.type}, fd_dst: ${redirect.fd_dst}, path: ${redirect.path}, fd_src: ${redirect.fd_src}`
          );
        }

        sendToKernel([
          "spawn",
          {
            path,
            args,
            env: { ...env, ...extended_env },
            sharedBuffer,
            background,
            redirects: redirects,
          } as SpawnArgs,
        ]);

        // wait for child process to finish
        Atomics.wait(lck, 0, -1);
        const err = Atomics.load(lck, 0);
        const childPID = new Int32Array(sharedBuffer, 4, 1);
        const userBuffer = new Uint32Array(2);

        let exitStatus = constants.EXIT_SUCCESS;
        userBuffer[0] = constants.EXIT_SUCCESS;
        userBuffer[1] = Atomics.load(childPID, 0);

        if (err !== constants.WASI_ESUCCESS) {
          workerConsoleLog(`error: spawned process returned ${err}`);
          if (err === constants.WASI_ENOEXEC) {
            // If the program can't be executed, return additional output message
            userBuffer[0] = constants.WASI_ENOEXEC;
            exitStatus = constants.EXIT_FAILURE;
          } else {
            exitStatus = err;
          }
        }

        let byteResult = new Uint8Array(userBuffer.buffer, 0, 8);
        outputBuffer.set(byteResult, 0);

        return {
          exitStatus: exitStatus,
          outputSize: 8,
        };
      }

      case "chdir": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        const { dir }: { dir: string } = JSON.parse(json);
        workerConsoleLog(`chdir(${dir})`);
        const dir_ = utils.realpath(dir);

        sendToKernel(["chdir", { dir: dir_, sharedBuffer } as ChdirArgs]);

        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        workerConsoleLog(`chdir returned ${err}`);

        return {
          exitStatus: err,
          outputSize: 0,
        };
      }

      case "getcwd": {
        const { buf_len }: { buf_len: number } = JSON.parse(json);
        workerConsoleLog(`getcwd(${buf_len})`);

        const sharedBuffer = new SharedArrayBuffer(4 + 4 + buf_len);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        const cwd_len = new Uint32Array(sharedBuffer, 4, 1);
        const cwd_buf = new Uint8Array(sharedBuffer, 8, buf_len);
        lck[0] = -1;

        sendToKernel([
          "getcwd",
          { bufLen: buf_len, sharedBuffer } as GetCwdArgs,
        ]);
        Atomics.wait(lck, 0, -1);
        const err = Atomics.load(lck, 0);

        const output =
          err === constants.EXIT_SUCCESS
            ? new TextDecoder().decode(cwd_buf.slice(0, cwd_len[0]))
            : undefined;
        workerConsoleLog(`getcwd returned ${output}`);

        // Check user buffer size is enough
        if (outputBuffer.byteLength <= cwd_len[0]) {
          return {
            exitStatus: constants.WASI_ENOBUFS,
            outputSize: 0,
          };
        }

        outputBuffer.set(cwd_buf.slice(0, cwd_len[0]), 0);
        outputBuffer.set([0], cwd_len[0]);

        return {
          exitStatus: err,
          outputSize: cwd_len[0],
        };
      }

      case "set_env": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        const { key, value }: { key: string; value: string } = JSON.parse(json);
        workerConsoleLog(`set_env(${key}, ${value})`);
        sendToKernel(["set_env", { key, value, sharedBuffer } as SetEnvArgs]);
        Atomics.wait(lck, 0, -1);
        const err = Atomics.load(lck, 0);

        if (err === constants.WASI_ESUCCESS) {
          if (value === undefined) {
            delete env[key];
          } else {
            env[key] = value;
          }
        }

        return {
          exitStatus: constants.EXIT_SUCCESS,
          outputSize: 0,
        };
      }
      // TODO: rework this, linux uses "stty -echo"/"stty echo"
      //  (https://www.thegeeksearch.com/how-to-disable-enable-echo-of-keys-commands-typed-in-linux-shell/)
      case "set_echo": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        const { echo }: { echo: string } = JSON.parse(json);

        workerConsoleLog(`set_echo(${echo})`);

        sendToKernel([
          "set_echo",
          { shouldEcho: echo, sharedBuffer } as SetEchoArgs,
        ]);
        Atomics.wait(lck, 0, -1);

        return {
          exitStatus: constants.EXIT_SUCCESS,
          outputSize: 0,
        };
      }
      case "isatty": {
        // wasi_ext_lib::isatty needs: int
        if (outputBuffer.byteLength < 4) {
          return {
            exitStatus: constants.WASI_ENOBUFS,
            outputSize: 0,
          };
        }

        const sharedBuffer = new SharedArrayBuffer(8);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        const { fd }: { fd: number } = JSON.parse(json);

        workerConsoleLog(`isatty(${fd})`);

        sendToKernel(["isatty", { sharedBuffer, fd } as IsAttyArgs]);
        Atomics.wait(lck, 0, -1);

        let err = Atomics.load(lck, 0);
        const isattyPtr = new Uint8Array(sharedBuffer, 4, 4);
        outputBuffer.set(isattyPtr.slice(0, 4), 0);

        return {
          exitStatus: err,
          outputSize: 4,
        };
      }
      case "getpid": {
        // wasi_ext_lib::getpid needs: int pid
        if (outputBuffer.byteLength < 4) {
          return {
            exitStatus: constants.WASI_ENOBUFS,
            outputSize: 0,
          };
        }

        const sharedBuffer = new SharedArrayBuffer(8);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        const pidPtr = new Int32Array(sharedBuffer, 4, 1);

        lck[0] = -1;
        pidPtr[0] = -1;

        workerConsoleLog(`getpid()`);

        sendToKernel(["getpid", { sharedBuffer } as GetPidArgs]);
        Atomics.wait(lck, 0, -1);

        const pidArray = new Uint8Array(sharedBuffer, 4, 4);
        outputBuffer.set(pidArray, 0);

        return {
          exitStatus: constants.EXIT_SUCCESS,
          outputSize: 4,
        };
      }
      case "event_source_fd": {
        // wasi_ext_lib::event_source_fd needs: int fd
        if (outputBuffer.byteLength < 4) {
          return {
            exitStatus: constants.WASI_ENOBUFS,
            outputSize: 0,
          };
        }

        const { event_mask: eventMask }: { event_mask: EventType } =
          JSON.parse(json);
        const sharedBuffer = new SharedArrayBuffer(4 + 4);
        const lck = new Int32Array(sharedBuffer, 0, 1);

        workerConsoleLog(`event_source_fd(${eventMask})`);

        if (
          eventMask === constants.WASI_EXT_NO_EVENT ||
          eventMask >= 1 << constants.WASI_EXT_EVENTS_NUM
        ) {
          return {
            exitStatus: constants.WASI_EINVAL,
            outputSize: 0,
          };
        }

        lck[0] = -1;

        sendToKernel([
          "event_source_fd",
          { sharedBuffer, eventMask } as EventSourceArgs,
        ]);
        Atomics.wait(lck, 0, -1);

        let returnCode = Atomics.load(lck, 0);
        const fileDescriptor = new Uint8Array(sharedBuffer, 4, 4);
        outputBuffer.set(fileDescriptor, 0);

        return {
          exitStatus: returnCode,
          outputSize: 4,
        };
      }
      case "attach_sigint": {
        const { event_source_fd: fd }: { event_source_fd: number } =
          JSON.parse(json);

        // lock + event source file descriptor
        const sharedBuffer = new SharedArrayBuffer(4 + 4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        workerConsoleLog(`attach_sigint(${fd})`);

        sendToKernel([
          "attach_sigint",
          { sharedBuffer, fd } as AttachSigIntArgs,
        ]);
        Atomics.wait(lck, 0, -1);

        let returnCode = Atomics.load(lck, 0);
        return {
          exitStatus: returnCode,
          outputSize: 0,
        };
      }
      case "clean_inodes": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        workerConsoleLog("clean_inodes()");
        lck[0] = -1;
        sendToKernel(["clean_inodes", { sharedBuffer } as CleanInodesArgs]);
        Atomics.wait(lck, 0, -1);
        return {
          exitStatus: Atomics.load(lck, 0),
          outputSize: 0,
        };
      }
      case "kill": {
        const {
          process_id: processId,
          signal: signalNumber,
        }: { process_id: number; signal: number } = JSON.parse(json);

        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        workerConsoleLog(`kill(${processId}, ${signalNumber})`);

        sendToKernel([
          "kill",
          { sharedBuffer, processId, signalNumber } as KillArgs,
        ]);
        Atomics.wait(lck, 0, -1);

        return {
          exitStatus: Atomics.load(lck, 0),
          outputSize: 0,
        };
      }
      case "ioctl": {
        const {
          fd,
          cmd,
        }: {
          fd: number;
          cmd: number;
        } = JSON.parse(json);
        const { size, rw, func } = utils.decodeIoctlRequest(BigInt(cmd));

        // lock + arg buffer size used + arg buffer
        const sharedBuffer = new SharedArrayBuffer(4 + size);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        const sharedArgBuffer = new Uint8Array(sharedBuffer, 4, size);

        workerConsoleLog(`ioctl(${fd}, ${cmd})`);

        lck[0] = -1;
        if (rw === utils.ioc.IOWR || rw === utils.ioc.IOW)
          sharedArgBuffer.set(outputBuffer); // in this case it is either input or output buffer

        sendToKernel([
          "ioctl",
          { sharedBuffer, fd, command: func } as IoctlArgs,
        ]);

        Atomics.wait(lck, 0, -1);
        let len = 0;
        if (rw === utils.ioc.IOWR || rw === utils.ioc.IOR) {
          outputBuffer.set(sharedArgBuffer);
          len = size;
        }

        return {
          exitStatus: Atomics.load(lck, 0),
          outputSize: len,
        };
      }
      case "mount": {
        const {
          source_fd,
          source,
          source_len,
          target_fd,
          target,
          target_len,
          filesystemtype,
          filesystemtype_len,
          mountflags,
          data,
          data_len,
        }: {
          source_fd: number;
          source: ptr;
          source_len: number;
          target_fd: number;
          target: ptr;
          target_len: number;
          filesystemtype: ptr;
          filesystemtype_len: number;
          mountflags: bigint;
          data: ptr;
          data_len: number;
        } = JSON.parse(json);

        const view8 = new Uint8Array(
          (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
        );

        const sourcePath = new TextDecoder().decode(
          view8.slice(source, source + source_len)
        );
        const targetPath = new TextDecoder().decode(
          view8.slice(target, target + target_len)
        );
        const filesystemType = new TextDecoder().decode(
          view8.slice(filesystemtype, filesystemtype + filesystemtype_len)
        );
        const data_ = new TextDecoder().decode(
          view8.slice(data, data + data_len)
        );

        workerConsoleLog(
          `mount(${source_fd}, "${sourcePath}", ${source_len}, ${target_fd}, "${targetPath}", ${target_len}, "${filesystemType}", ${filesystemtype_len}, ${mountflags}, "${data_}", ${data_len})`
        );

        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;
        sendToKernel([
          "mount",
          {
            sharedBuffer,
            sourceFd: source_fd,
            sourcePath,
            targetFd: target_fd,
            targetPath,
            filesystemType,
            mountFlags: mountflags,
            data: data_,
          } as MountArgs,
        ]);

        Atomics.wait(lck, 0, -1);
        const exitStatus = Atomics.load(lck, 0);

        workerConsoleLog(`mount returned ${exitStatus}`);

        return {
          exitStatus,
          outputSize: 0,
        };
      }
      case "umount": {
        const {
          path,
          path_len,
        }: {
          path: ptr;
          path_len: number;
        } = JSON.parse(json);

        const view8 = new Uint8Array(
          (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
        );

        const path_ = new TextDecoder().decode(
          view8.slice(path, path + path_len)
        );

        workerConsoleLog(`umount("${path_}", ${path_len}`);

        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        sendToKernel([
          "umount",
          {
            path: path_,
            sharedBuffer,
          } as UmountArgs,
        ]);

        Atomics.wait(lck, 0, -1);
        const exitStatus = Atomics.load(lck, 0);

        workerConsoleLog(`umount returned ${exitStatus}`);

        return {
          exitStatus,
          outputSize: 0,
        };
      }
      case "mknod": {
        const { path, dev } : {
          path: string,
          dev: number
        } = JSON.parse(json);

        workerConsoleLog(`mknod("${path}", ${dev})`);

        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        sendToKernel([
          "mknod",
          {
            sharedBuffer,
            path,
            dev
          } as MknodArgs,
        ]);

        Atomics.wait(lck, 0, -1);
        const exitStatus = Atomics.load(lck, 0);

        workerConsoleLog(`mknod returned ${exitStatus}`);
        return {
          exitStatus,
          outputSize: 0
        };
      }
      default: {
        workerConsoleLog(`Special command ${command} not found.`);
        throw Error(`Special command '${command} not found.`);
      }
    }
  }

  function path_readlink(
    fd: number,
    pathPtr: ptr,
    pathLen: number,
    bufferPtr: ptr,
    bufferLen: number,
    bufferUsedPtr: ptr
  ) {
    workerConsoleLog(
      `path_readlink(${fd}, ${pathPtr}, ${pathLen}, ${bufferPtr}, ${bufferLen}, ${bufferUsedPtr})`
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const path = new TextDecoder().decode(
      view8.slice(pathPtr, pathPtr + pathLen)
    );
    workerConsoleLog(`path is ${path}, buffer_len = ${bufferLen}, fd = ${fd}`);
    // special case, path_readlink is used for spawning subprocesses
    if (path[0] === "!") {
      const outputBuffer =
        bufferPtr !== 0
          ? new Uint8Array(
              (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer,
              bufferPtr,
              bufferLen
            )
          : new Uint8Array();

      const { exitStatus, outputSize } = specialParse(
        path.slice(1),
        outputBuffer
      );

      // ensure that syscall output doesn't exceed buffer size and the buffer pointer is not NULL
      if (exitStatus !== constants.WASI_ENOBUFS && bufferPtr !== 0) {
        view.setUint32(bufferUsedPtr, outputSize, true);
      }
      return exitStatus;
    }

    const sharedBuffer = new SharedArrayBuffer(4 + bufferLen + 4); // lock, path buffer, buffer used
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const bufferUsed = new Int32Array(sharedBuffer, 4, 1);
    const buffer = new Uint8Array(sharedBuffer, 8, bufferLen);
    sendToKernel([
      "path_readlink",
      {
        sharedBuffer,
        fd,
        path,
        bufferLen,
      } as PathReadlinkArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    view8.set(buffer, bufferPtr);
    view.setUint32(bufferUsedPtr, bufferUsed[0], true);

    return constants.WASI_ESUCCESS;
  }

  function path_remove_directory(fd: number, pathPtr: ptr, pathLen: number) {
    workerConsoleLog(`path_remove_directory(${fd}, ${pathPtr}, ${pathLen})`);

    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const path = new TextDecoder().decode(
      view8.slice(pathPtr, pathPtr + pathLen)
    );

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "path_remove_directory",
      { sharedBuffer, fd, path } as PathRemoveEntryArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  function path_rename(
    oldFd: number,
    oldPathPtr: ptr,
    oldPathLen: number,
    newFd: number,
    newPathPtr: ptr,
    newPathLen: number
  ) {
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    const oldPath = new TextDecoder().decode(
      view8.slice(oldPathPtr, oldPathPtr + oldPathLen)
    );
    const newPath = new TextDecoder().decode(
      view8.slice(newPathPtr, newPathPtr + newPathLen)
    );

    workerConsoleLog(
      `path_rename(${oldFd}, ${oldPath}, ${oldPathLen}, ${newFd}, ${newPath}, ${newPathLen})`
    );

    const sharedBuffer = new SharedArrayBuffer(4);
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "path_rename",
      { sharedBuffer, oldFd, oldPath, newFd, newPath } as PathRenameArgs,
    ]);
    Atomics.wait(lck, 0, -1);
    return Atomics.load(lck, 0);
  }

  function path_unlink_file(fd: number, pathPtr: ptr, pathLen: number) {
    workerConsoleLog(`path_unlink_file(${fd}, ${pathPtr}, ${pathLen})`);

    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const path = new TextDecoder().decode(
      view8.slice(pathPtr, pathPtr + pathLen)
    );

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "path_unlink_file",
      { sharedBuffer, fd, path } as PathRemoveEntryArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  function sched_yield() {
    return placeholder();
  }

  function fd_prestat_get(fd: number, buf: ptr) {
    workerConsoleLog(`fd_prestat_get(${fd}, 0x${buf.toString(16)})`);
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 4 + 1); // lock, name length, preopen_type
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const nameLen = new Int32Array(sharedBuffer, 4, 1);
    const fileType = new Uint8Array(sharedBuffer, 8, 1);

    sendToKernel(["fd_prestat_get", { sharedBuffer, fd } as FdPrestatGetArgs]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === constants.WASI_ESUCCESS) {
      view.setUint8(buf, fileType[0]);
      view.setUint32(buf + 4, nameLen[0], true);
      workerConsoleLog(
        `fd_prestat_get returned filetype type ${fileType[0]} of size ${nameLen[0]}`
      );
    } else {
      workerConsoleLog(`fd_prestat_get returned ${err}`);
    }
    return err;
  }

  function fd_prestat_dir_name(fd: number, pathPtr: ptr, pathLen: number) {
    workerConsoleLog(
      `fd_prestat_dir_name(${fd}, 0x${pathPtr.toString(16)}, ${pathLen})`
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + pathLen); // lock, path
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const path = new Uint8Array(sharedBuffer, 4, pathLen);

    sendToKernel([
      "fd_prestat_dir_name",
      { sharedBuffer, fd, pathLen } as FdPrestatDirNameArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === constants.WASI_ESUCCESS) {
      view8.set(path, pathPtr);
    }
    const pathStr = new TextDecoder().decode(
      view8.slice(pathPtr, pathPtr + pathLen)
    );
    workerConsoleLog(
      `prestat returned ${err}, "${pathStr}" of size ${pathLen}`
    );
    return err;
  }

  function fd_datasync() {
    return placeholder();
  }

  function fd_filestat_set_size() {
    return placeholder();
  }

  function fd_sync() {
    return placeholder();
  }

  function path_symlink(
    oldPathPtr: ptr,
    oldPathLen: number,
    newFd: number,
    newPathPtr: ptr,
    newPathLen: number
  ) {
    workerConsoleLog(
      `path_symlink(0x${oldPathPtr.toString(
        16
      )}, ${oldPathLen}, ${newFd}, 0x${newPathPtr.toString(16)}, ${newPathLen})`
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const oldPath = new TextDecoder().decode(
      view8.slice(oldPathPtr, oldPathPtr + oldPathLen)
    );
    const newPath = new TextDecoder().decode(
      view8.slice(newPathPtr, newPathPtr + newPathLen)
    );
    workerConsoleLog(`path_symlink: ${newPath} --> ${oldPath}`);

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "path_symlink",
      {
        sharedBuffer,
        targetPath: oldPath,
        linkFd: newFd,
        linkPath: newPath,
      } as PathSymlinkArgs,
    ]);

    Atomics.wait(lck, 0, -1);

    let err = Atomics.load(lck, 0);
    workerConsoleLog(`path_symlink returned ${err}`);
    return err;
  }

  function path_link(
    oldFd: number,
    oldFlags: LookupFlags,
    oldPathPtr: ptr,
    oldPathLen: number,
    newFd: number,
    newPathPtr: ptr,
    newPathLen: number
  ) {
    workerConsoleLog(
      `path_link(${oldFd}, ${oldFlags}, ${oldPathPtr}, ${oldPathLen}, ${newFd}, ${newPathPtr}, ${newPathLen})`
    );

    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const oldPath = new TextDecoder().decode(
      view8.slice(oldPathPtr, oldPathPtr + oldPathLen)
    );
    const newPath = new TextDecoder().decode(
      view8.slice(newPathPtr, newPathPtr + newPathLen)
    );

    workerConsoleLog(`path_link: ${newPath} -> ${oldPath}`);

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "path_link",
      {
        sharedBuffer,
        oldFd,
        oldFlags,
        oldPath,
        newFd,
        newPath,
      } as PathLinkArgs,
    ]);

    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  function poll_oneoff(
    subscriptionsPtr: ptr,
    eventsPtr: ptr,
    nSubscriptions: number,
    nEvents: ptr
  ) {
    workerConsoleLog(
      `poll_oneoff(${subscriptionsPtr}, ${eventsPtr}, ${nSubscriptions}, ${nEvents})`
    );
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );
    // Buffer for sending occured events from kernel back to the process
    // it can hold up to nSubscriptions events
    const eventBuf = new SharedArrayBuffer(POLL_EVENT_BUFSIZE * nSubscriptions);

    var minWaitEnd = BigInt(Number.MAX_SAFE_INTEGER);

    const fdSubs = new Array<FdEventSub>();

    let lastClockUserdata: bigint;
    let lastClock: ClockSub = undefined;

    for (let i = 0; i < nSubscriptions; i += 1) {
      const userdata = view.getBigUint64(subscriptionsPtr, true);
      subscriptionsPtr += 8; // userdata offset
      const eventType = view.getUint8(subscriptionsPtr);
      subscriptionsPtr += 1; // tag offset

      let fdSub;
      switch (eventType) {
        case constants.WASI_EVENTTYPE_CLOCK: {
          subscriptionsPtr += 7; // padding to 8
          const clockId = view.getUint32(subscriptionsPtr, true);
          subscriptionsPtr += 8; // clockId offset
          const timeout = view.getBigUint64(subscriptionsPtr, true);
          subscriptionsPtr += 8; // timeout offset
          const precision = view.getBigUint64(subscriptionsPtr, true);
          subscriptionsPtr += 8; // precision offset
          const subClockFlags = view.getUint16(subscriptionsPtr, true);
          subscriptionsPtr += 8; // flags offset + padding to 8

          const absolute = subClockFlags === 1;

          workerConsoleLog(
            `clockId = ${clockId}, timeout = ${timeout}, precision = ${precision}, absolute = ${absolute}`
          );

          const n = utils.now(clockId, CPUTIME_START);
          const end = absolute ? timeout : n + timeout;

          if (minWaitEnd > end) {
            minWaitEnd = end;
            lastClock = {
              clockId,
              timeout,
              precision,
              flags: subClockFlags,
            } as ClockSub;
            lastClockUserdata = userdata;
          }
          continue;
        }
        case constants.WASI_EVENTTYPE_FD_WRITE:
        case constants.WASI_EVENTTYPE_FD_READ: {
          subscriptionsPtr += 7; // padding to 8
          const fd = view.getUint32(subscriptionsPtr, true);
          subscriptionsPtr += 32; // file descriptor offset + subscription padding

          workerConsoleLog(`read data from fd = ${fd}`);

          fdSub = { fd } as FdReadWriteSub;

          break;
        }
        default:
          // There is no more event types
          return constants.WASI_EINVAL;
      }

      if (fdSub) fdSubs.push({ userdata, eventType, event: fdSub });
    }

    if (lastClock) {
      fdSubs.push({
        userdata: lastClockUserdata,
        eventType: constants.WASI_EVENTTYPE_CLOCK,
        event: lastClock,
      });
    }

    // lock + number of events that occured
    const sharedBuffer = new SharedArrayBuffer(4 + 4);
    const lock = new Int32Array(sharedBuffer, 0, 2);
    lock[0] = -1;
    lock[1] = 0;

    if (fdSubs.length > 0) {
      sendToKernel([
        "poll_oneoff",
        {
          sharedBuffer,
          subs: fdSubs,
          eventBuf,
          timeout: minWaitEnd,
        } as PollOneoffArgs,
      ]);
      Atomics.wait(lock, 0, -1);
    }

    const nOccured = lock[1];
    new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer,
      eventsPtr,
      nOccured * POLL_EVENT_BUFSIZE
    ).set(new Uint8Array(eventBuf, 0, nOccured * POLL_EVENT_BUFSIZE));

    view.setInt32(nEvents, nOccured, true);
    return constants.WASI_ESUCCESS;
  }

  const placeholder = () => {
    workerConsoleLog(
      `> Entering stub ${new Error().stack.split("\n")[2].trim().split(" ")[1]}`
    );
    return constants.WASI_ESUCCESS;
  };

  function fd_advice() {
    return placeholder();
  }

  function fd_allocate() {
    return placeholder();
  }

  function fd_fdstat_set_rights() {
    return placeholder();
  }

  function fd_fdstat_set_flags(fd: number, flags: number) {
    workerConsoleLog(`fd_fdstat_set_flags(${fd}, ${flags})`);

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "fd_fdstat_set_flags",
      { sharedBuffer, fd, flags } as FdFdstatSetFlagsArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    workerConsoleLog(`fd_fdstat_set_flags returned error: ${err}`);

    return err;
  }

  function fd_pwrite() {
    return placeholder();
  }

  function fd_renumber(fd: number, newFd: number) {
    // We ignore WASI spec, fd_renumber behaves like dup2 in unix
    workerConsoleLog(`fd_renumber(${fd}, ${newFd})`);

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "fd_renumber",
      { sharedBuffer, fd, newFd } as FdRenumberArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    workerConsoleLog(`fd_renumber returned error: ${err}`);
    return err;
  }

  function fd_tell(fd: number, pos: ptr) {
    workerConsoleLog(`fd_tell(${fd}, 0x${pos.toString(16)})`);
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(8 + 4); // offset, lock
    const offset = new BigInt64Array(sharedBuffer, 0, 1);
    const lck = new Int32Array(sharedBuffer, 8, 1);
    lck[0] = -1;

    sendToKernel(["fd_tell", { sharedBuffer, fd } as FdTellArgs]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === constants.WASI_ESUCCESS) {
      view.setBigUint64(pos, offset[0], true);
      workerConsoleLog(`fd_tell returned offset: ${offset[0]}`);
    } else {
      workerConsoleLog(`fd_tell returned error: ${err}`);
    }
    return err;
  }

  function path_filestat_set_times(
    fd: number,
    flags: LookupFlags,
    path: ptr,
    path_len: number,
    st_atim: bigint,
    st_mtim: bigint,
    fst_flags: number
  ) {
    workerConsoleLog(
      `path_filestat_set_times(${fd}, ${flags}, ${path}, ${path_len}, ${st_atim}, ${st_mtim}, ${fst_flags})`
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    const path_ = new TextDecoder().decode(view8.slice(path, path + path_len));
    const sharedBuffer = new SharedArrayBuffer(4);
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    sendToKernel([
      "path_filestat_set_times",
      {
        sharedBuffer,
        fd,
        flags,
        path: path_,
        st_atim,
        st_mtim,
        fst_flags,
      } as FilestatSetTimesArgs,
    ]);
    Atomics.wait(lck, 0, -1);
    const err = Atomics.load(lck, 0);
    workerConsoleLog(`path_filestat_set_times returned ${err}`);
    return err;
  }

  function proc_raise() {
    return placeholder();
  }

  function sock_accept() {
    return placeholder();
  }

  function sock_recv() {
    return placeholder();
  }

  function sock_send() {
    return placeholder();
  }

  function sock_shutdown() {
    return placeholder();
  }

  function fd_advise() {
    return placeholder();
  }

  function fd_filestat_set_times(
    fd: number,
    st_atim: bigint,
    st_mtim: bigint,
    fst_flags: number
  ) {
    workerConsoleLog(
      `fd_filestat_set_times(${fd}, ${st_atim}, ${st_mtim}, ${fst_flags})`
    );
    const sharedBuffer = new SharedArrayBuffer(4);
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    sendToKernel([
      "fd_filestat_set_times",
      {
        sharedBuffer,
        fd,
        st_atim,
        st_mtim,
        fst_flags,
      } as FilestatSetTimesArgs,
    ]);
    Atomics.wait(lck, 0, -1);
    const err = Atomics.load(lck, 0);
    workerConsoleLog(`fd_filestat_set_times returned ${err}`);
    return err;
  }

  return {
    setModuleInstance,

    environ_sizes_get,
    args_sizes_get,
    fd_prestat_get,
    fd_fdstat_get,
    fd_filestat_get,
    fd_read,
    fd_write,
    fd_prestat_dir_name,
    environ_get,
    args_get,
    poll_oneoff,
    proc_exit,
    fd_close,
    fd_seek,
    random_get,
    clock_time_get,
    fd_readdir,
    path_create_directory,
    path_filestat_get,
    path_link,
    path_open,
    path_readlink,
    path_remove_directory,
    path_rename,
    path_unlink_file,
    sched_yield,
    fd_datasync,
    fd_filestat_set_size,
    fd_sync,
    path_symlink,
    clock_res_get,
    fd_advise,
    fd_allocate,
    fd_fdstat_set_flags,
    fd_fdstat_set_rights,
    fd_tell,
    fd_filestat_set_times,
    fd_pread,
    fd_advice,
    fd_pwrite,
    fd_renumber,
    path_filestat_set_times,
    proc_raise,
    sock_accept,
    sock_recv,
    sock_send,
    sock_shutdown,
  };
}

async function importWasmModule(
  module: WebAssembly.Module,
  wasiCallbacksConstructor: (snapshot0: boolean) => WASICallbacks
) {
  let imps = WebAssembly.Module.imports(module);
  let wasiCallbacks;
  if (imps[0].module === "wasi_unstable") {
    wasiCallbacks = wasiCallbacksConstructor(true);
  } else if (imps[0].module === "wasi_snapshot_preview1") {
    wasiCallbacks = wasiCallbacksConstructor(false);
  } else {
    throw Error("Unsupported wasm format");
  }
  const moduleImports = {
    wasi_snapshot_preview1: wasiCallbacks,
    wasi_unstable: wasiCallbacks,
  };

  if (WebAssembly.instantiate) {
    workerConsoleLog("WebAssembly.instantiate");

    const instance = await WebAssembly.instantiate(module, moduleImports);

    wasiCallbacks.setModuleInstance(instance);
    try {
      // @ts-ignore
      // eslint-disable-next-line no-underscore-dangle
      instance.exports._start();
      doExit(0);
    } catch (error: any) {
      workerConsoleLog(`error: ${error}`);
      doExit(255);
    }
  } else {
    workerConsoleLog("WebAssembly.instantiate is not supported");
  }
}

async function start_wasm() {
  if (started && mod) {
    workerConsoleLog("Loading a module");
    try {
      await importWasmModule(mod, WASI);
    } catch (err) {
      workerConsoleLog(`Failed instantiating WASM module: ${err}`);
      doExit(255);
    }
    workerConsoleLog("done.");
  } else {
    setTimeout(() => {
      start_wasm();
    }, 0);
  }
}
