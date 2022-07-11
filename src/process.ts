/* eslint-disable camelcase */
import * as constants from "./constants.js";
import * as utils from "./utils.js";
import { FdFlags, LookupFlags, OpenFlags, Rights } from "./filesystem/enums";
import {
  ChdirArgs,
  FdCloseArgs,
  FdFdstatGetArgs,
  FdFilestatGetArgs,
  FdPrestatDirNameArgs,
  FdPrestatGetArgs,
  FdReadArgs,
  FdReaddirArgs,
  FdSeekArgs,
  FdWriteArgs,
  GetPidArgs,
  IsAttyArgs,
  PathCreateDirectoryArgs,
  PathFilestatGetArgs,
  PathLinkArgs,
  PathOpenArgs,
  PathReadlinkArgs,
  PathRemoveDirectoryArgs,
  PathSymlinkArgs,
  PathUnlinkFileArgs,
  Redirect,
  SetEchoArgs,
  SetEnvArgs,
  SpawnArgs,
} from "./types";

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
    cookie: number,
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
  fd_tell: any;
  fd_filestat_set_times: any;
  fd_pread: any;
  fd_advice: any;
  fd_pwrite: any;
  fd_renumber: any;

  path_filestat_set_times: any;
  path_filestat_get: (
    fd: number,
    lookupFlags: LookupFlags,
    pathPtr: ptr,
    pathLen: number,
    buf: ptr
  ) => number;
  path_open: (
    dirFd: number,
    lookupFlags: LookupFlags,
    pathPtr: ptr,
    pathLen: number,
    openFlags: OpenFlags,
    fsRightsBase: Rights,
    fsRightsInheriting: Rights,
    fdFlags: FdFlags,
    openedFdPtr: ptr
  ) => number;
  path_rename: any;
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

function WASI(): WASICallbacks {
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

    const sharedBuffer = new SharedArrayBuffer(4 + 20); // lock, filetype, rights base, rights inheriting
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const fileType = new Uint8Array(sharedBuffer, 4, 1);
    const rights_base = new BigUint64Array(sharedBuffer, 8, 1);
    const rights_inheriting = new BigUint64Array(sharedBuffer, 16, 1);

    sendToKernel(["fd_fdstat_get", { sharedBuffer, fd } as FdFdstatGetArgs]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      workerConsoleLog(`fd_fdstat_get returned ${err}`);
      return err;
    }

    view.setUint8(buf, fileType[0]);
    if (fd <= 2) {
      view.setUint32(buf + 2, constants.WASI_FDFLAG_APPEND, true);
    } else {
      view.setUint32(buf + 2, 0, true);
    }
    view.setBigUint64(buf + 8, rights_base[0], true);
    view.setBigUint64(buf + 16, rights_inheriting[0], true);

    workerConsoleLog(`fd_fdstat_get returned ${err}`);
    return constants.WASI_ESUCCESS;
  }

  function fd_write(fd: number, iovs: ptr, iovsLen: number, nWritten: ptr) {
    workerConsoleLog(`fd_write(${fd}, ${iovs}, ${iovsLen}, ${nWritten})`);
    const view = new DataView(
      (moduleInstanceExports["memory"] as WebAssembly.Memory).buffer
    );

    let written = 0;
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
      written += iov.byteLength;
    }

    const sharedBuffer = new SharedArrayBuffer(4 + written); // lock + content
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const content = new TextDecoder().decode(Uint8Array.from(bufferBytes));
    sendToKernel(["fd_write", { sharedBuffer, fd, content } as FdWriteArgs]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === 0) {
      workerConsoleLog(`fd_write written ${written} bytes.`);
      view.setUint32(nWritten, written, true);
    } else {
      workerConsoleLog("fd_write ERROR!.");
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

  function clock_res_get(clock_id: number) {
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

    sendToKernel([
      "fd_filestat_get",
      { sharedBuffer, fd } as FdFilestatGetArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    workerConsoleLog(`fd_filestat_get returned ${err}`);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    const dev = statBuf.getBigUint64(0, true);
    const ino = statBuf.getBigUint64(8, true);
    const fileType = statBuf.getUint8(16);
    const nlink = statBuf.getBigUint64(24, true);
    const size = statBuf.getBigUint64(32, true);
    const atim = statBuf.getBigUint64(38, true);
    const mtim = statBuf.getBigUint64(46, true);
    const ctim = statBuf.getBigUint64(52, true);

    view.setBigUint64(buf, dev, true);
    view.setBigUint64(buf + 8, ino, true);
    view.setUint8(buf + 16, fileType);
    view.setBigUint64(buf + 24, nlink, true);
    view.setBigUint64(buf + 32, size, true);
    view.setBigUint64(buf + 38, atim, true);
    view.setBigUint64(buf + 46, mtim, true);
    view.setBigUint64(buf + 52, ctim, true);

    return constants.WASI_ESUCCESS;
  }

  function fd_read(fd: number, iovs: ptr, iovsLen: number, nRead: ptr) {
    if (fd > 2)
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

      sendToKernel(["fd_read", { sharedBuffer, fd, len } as FdReadArgs]);
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

  function fd_readdir(
    fd: number,
    buf: ptr,
    bufLen: number,
    cookie: number,
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

    sendToKernel([
      "fd_seek",
      { sharedBuffer, fd, offset, whence } as FdSeekArgs,
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
      { sharedBuffer, fd, path, lookupFlags } as PathFilestatGetArgs,
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

    view.setBigUint64(buf, dev, true);
    view.setBigUint64(buf + 8, ino, true);
    view.setUint8(buf + 16, fileType);
    view.setBigUint64(buf + 24, nlink, true);
    view.setBigUint64(buf + 32, size, true);
    view.setBigUint64(buf + 40, atim, true);
    view.setBigUint64(buf + 48, mtim, true);
    view.setBigUint64(buf + 56, ctim, true);

    return constants.WASI_ESUCCESS;
  }

  function path_open(
    dirFd: number,
    lookupFlags: LookupFlags,
    pathPtr: ptr,
    pathLen: number,
    openFlags: OpenFlags,
    fsRightsBase: Rights,
    fsRightsInheriting: Rights,
    fdFlags: FdFlags,
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
  function specialParse(syscallDataJson: string): string {
    const {
      command,
      args,
      extended_env,
      background,
      redirects,
    }: {
      command: string;
      args: string[];
      extended_env: Record<string, string>;
      background: boolean;
      redirects: Redirect[];
    } = JSON.parse(syscallDataJson);
    switch (command) {
      case "spawn": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;
        sendToKernel([
          "spawn",
          {
            path: args[0],
            args: args.slice(1),
            env: { ...env, ...extended_env },
            sharedBuffer,
            background,
            redirects,
          } as SpawnArgs,
        ]);
        // wait for child process to finish
        Atomics.wait(lck, 0, -1);
        const err = Atomics.load(lck, 0);
        if (err !== constants.WASI_ESUCCESS) {
          workerConsoleLog(`error: spawned process returned ${err}`);
          return `${constants.EXIT_FAILURE}\x1b`;
        }
        return `${constants.EXIT_SUCCESS}\x1b`;
      }
      case "chdir": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;
        const dir = utils.realpath(args[0]);
        sendToKernel(["chdir", { dir, sharedBuffer } as ChdirArgs]);
        Atomics.wait(lck, 0, -1);
        const err = Atomics.load(lck, 0);

        return `${err}\x1b${dir}`;
      }
      case "set_env": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        const [key, value] = args;
        sendToKernel(["set_env", { key, value, sharedBuffer } as SetEnvArgs]);
        Atomics.wait(lck, 0, -1);
        const err = Atomics.load(lck, 0);

        if (err === constants.WASI_ESUCCESS) {
          if (args.length === 1) {
            delete env[args[0]];
          } else {
            const [key, value] = args;
            env[key] = value;
          }
        }

        return `${constants.EXIT_SUCCESS}\x1b`;
      }
      // TODO: rework this, linux uses "stty -echo"/"stty echo"
      //  (https://www.thegeeksearch.com/how-to-disable-enable-echo-of-keys-commands-typed-in-linux-shell/)
      case "set_echo": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        sendToKernel([
          "set_echo",
          { shouldEcho: args[0], sharedBuffer } as SetEchoArgs,
        ]);
        Atomics.wait(lck, 0, -1);

        return `${constants.EXIT_SUCCESS}\x1b`;
      }
      case "isatty": {
        const sharedBuffer = new SharedArrayBuffer(8);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;
        const isattyPtr = new Int32Array(sharedBuffer, 4, 1);
        const fd = parseInt(args[0], 10);

        sendToKernel(["isatty", { sharedBuffer, fd } as IsAttyArgs]);
        Atomics.wait(lck, 0, -1);

        return `${constants.EXIT_SUCCESS}\x1b${isattyPtr[0]}`;
      }
      case "getpid": {
        const sharedBuffer = new SharedArrayBuffer(8);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;
        const pidPtr = new Int32Array(sharedBuffer, 4, 1);

        sendToKernel(["getpid", { sharedBuffer } as GetPidArgs]);
        Atomics.wait(lck, 0, -1);

        return `${constants.EXIT_SUCCESS}\x1b${pidPtr[0]}`;
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
      if (bufferLen < 1024) {
        // we need enough buffer to execute the function only once
        view.setUint32(bufferUsedPtr, bufferLen, true);
        return constants.WASI_ESUCCESS;
      }
      const result = new TextEncoder().encode(specialParse(path.slice(1)));
      let count = result.byteLength;
      if (count > 1024) count = 1024;
      view8.set(result.slice(0, count), bufferPtr);
      view.setUint32(bufferUsedPtr, count, true);
      return constants.WASI_ESUCCESS;
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
      { sharedBuffer, fd, path } as PathRemoveDirectoryArgs,
    ]);
    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  function path_rename() {
    return placeholder();
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
      { sharedBuffer, fd, path } as PathUnlinkFileArgs,
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
      { sharedBuffer, oldPath, newFd, newPath } as PathSymlinkArgs,
    ]);

    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
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

  // TODO: it doesn't work for now
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

    let eventCount = 0;
    let waitEnd = 0n;
    for (let i = 0; i < nSubscriptions; i += 1) {
      const userdata = view.getBigUint64(subscriptionsPtr, true);
      subscriptionsPtr += 8;
      const eventType = view.getUint8(subscriptionsPtr);
      subscriptionsPtr += 1;
      switch (eventType) {
        case constants.WASI_EVENTTYPE_CLOCK: {
          subscriptionsPtr += 7;
          const clockid = view.getUint32(subscriptionsPtr, true);
          subscriptionsPtr += 8;
          const timeout = view.getBigUint64(subscriptionsPtr, true);
          subscriptionsPtr += 8;
          const precision = view.getBigUint64(subscriptionsPtr, true);
          subscriptionsPtr += 8;
          const subClockFlags = view.getUint16(subscriptionsPtr, true);

          const absolute = subClockFlags === 1;

          workerConsoleLog(
            `clockid = ${clockid}, timeout = ${timeout}, precision = ${precision}, absolute = ${absolute}`
          );

          const n = utils.now(clockid, CPUTIME_START);
          const end = absolute ? timeout : n + timeout;
          waitEnd = end > waitEnd ? end : waitEnd;

          view.setBigUint64(eventsPtr, userdata, true);
          eventsPtr += 8;
          view.setUint16(eventsPtr, constants.WASI_ESUCCESS, true); // error
          eventsPtr += 2; // pad offset 2
          view.setUint8(eventsPtr, constants.WASI_EVENTTYPE_CLOCK);
          eventsPtr += 6; // pad offset 3

          eventCount += 1;

          break;
        }
        case constants.WASI_EVENTTYPE_FD_READ:
        case constants.WASI_EVENTTYPE_FD_WRITE: {
          subscriptionsPtr += 3; // padding
          view.getUint32(subscriptionsPtr, true);
          subscriptionsPtr += 4;

          view.setBigUint64(eventsPtr, userdata, true);
          eventsPtr += 8;
          view.setUint16(eventsPtr, constants.WASI_ENOSYS, true); // error
          eventsPtr += 2; // pad offset 2
          view.setUint8(eventsPtr, eventType);
          eventsPtr += 1; // pad offset 3
          eventsPtr += 5; // padding to 8

          eventCount += 1;

          break;
        }
        default:
          return constants.WASI_EINVAL;
      }
    }

    view.setUint32(nEvents, eventCount, true);

    while (utils.msToNs(performance.now()) < waitEnd) {
      // nothing
    }

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

  function fd_fdstat_set_flags() {
    return placeholder();
  }

  function fd_pwrite() {
    return placeholder();
  }

  function fd_renumber() {
    return placeholder();
  }

  function fd_tell() {
    return placeholder();
  }

  function path_filestat_set_times() {
    return placeholder();
  }

  function proc_raise() {
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

  function fd_filestat_set_times() {
    return placeholder();
  }

  function fd_pread() {
    return placeholder();
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
    sock_recv,
    sock_send,
    sock_shutdown,
  };
}

async function importWasmModule(
  module: WebAssembly.Module,
  wasiCallbacksConstructor: () => WASICallbacks
) {
  const wasiCallbacks = wasiCallbacksConstructor();
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
      sendToKernel(["stderr", `${error.stack}\n`]);
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
      sendToKernel(["stderr", `Failed instantiating WASM module: ${err}`]);
      doExit(255);
    }
    workerConsoleLog("done.");
  } else {
    setTimeout(() => {
      start_wasm();
    }, 0);
  }
}
