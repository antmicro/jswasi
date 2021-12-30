/* eslint-disable camelcase */
import * as constants from "./constants.js";
import * as utils from "./utils.js";
import { FdFlags, LookupFlags, OpenFlags, Rights } from "./filesystem/enums";

type ptr = number;

// TODO: set the proper types for each callback
type WASICallbacks = {
  // helper
  setModuleInstance: any;

  // custom syscalls
  isatty: (fd: number) => number;

  // official syscalls
  environ_sizes_get: any;
  args_sizes_get: any;
  fd_prestat_get: any;
  fd_fdstat_get: any;
  fd_filestat_get: any;
  fd_read: any;
  fd_write: any;
  fd_prestat_dir_name: any;
  environ_get: any;
  args_get: any;
  poll_oneoff: any;
  proc_exit: any;
  fd_close: any;
  fd_seek: any;
  random_get: any;
  clock_time_get: any;
  fd_readdir: any;
  path_create_directory: any;
  path_filestat_get: any;
  path_link: any;
  path_open: any;
  path_readlink: any;
  path_remove_directory: any;
  path_rename: any;
  path_unlink_file: any;
  sched_yield: any;
  fd_datasync: any;
  fd_filestat_set_size: any;
  fd_sync: any;
  path_symlink: any;
  clock_res_get: any;
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
  proc_raise: any;
  sock_recv: any;
  sock_send: any;
  sock_shutdown: any;
};

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
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
    env.DEBUG &&
    !(env.DEBUG === "0" || env.DEBUG === "false" || env.DEBUG === "")
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

  function setModuleInstance(instance: WebAssembly.Instance) {
    moduleInstanceExports = instance.exports;
  }

  function isatty(fd: number): number {
    workerConsoleLog(`isatty(${fd}`);

    const sharedBuffer = new SharedArrayBuffer(4 + 4); // lock, isatty
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const isAttyPtr = new Int32Array(sharedBuffer, 4, 1);

    sendToKernel(["isatty", { sharedBuffer, fd }]);
    Atomics.wait(lck, 0, -1);

    // const err = Atomics.load(lck, 0);
    return isAttyPtr[0];
  }

  function environ_sizes_get(environCountPtr: ptr, environSizePtr: ptr) {
    workerConsoleLog(
      `environ_sizes_get(0x${environCountPtr.toString(
        16
      )}, 0x${environSizePtr.toString(16)})`
    );

    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const environCount = Object.keys(env).length;
    view.setUint32(environCountPtr, environCount, true);

    const environSize = Object.entries(env).reduce(
      (sum, [key, val]) => sum + ENCODER.encode(`${key}=${val}\0`).byteLength,
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    Object.entries(env).forEach(([key, val], i) => {
      // set pointer address to beginning of next key value pair
      view.setUint32(environ + i * 4, environBuf, true);
      // write string describing the variable to WASM memory
      const variable = ENCODER.encode(`${key}=${val}\0`);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    view.setUint32(argc, programArgs.length, true);
    view.setUint32(
      argvBufSize,
      ENCODER.encode(programArgs.join("")).byteLength + programArgs.length,
      true
    );

    return constants.WASI_ESUCCESS;
  }

  function args_get(argv: ptr, argvBuf: ptr) {
    workerConsoleLog(`args_get(${argv}, 0x${argvBuf.toString(16)})`);

    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    programArgs.forEach((arg, i) => {
      // set pointer address to beginning of next key value pair
      view.setUint32(argv + i * 4, argvBuf, true);
      // write string describing the argument to WASM memory
      const variable = ENCODER.encode(`${arg}\0`);
      view8.set(variable, argvBuf);
      // calculate pointer to next variable
      argvBuf += variable.byteLength;
    });

    return constants.WASI_ESUCCESS;
  }

  function fd_fdstat_get(fd: number, buf: ptr) {
    workerConsoleLog(`fd_fdstat_get(${fd}, 0x${buf.toString(16)})`);

    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 20); // lock, filetype, rights base, rights inheriting
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const fileType = new Uint8Array(sharedBuffer, 4, 1);
    const rights_base = new BigUint64Array(sharedBuffer, 8, 1);
    const rights_inheriting = new BigUint64Array(sharedBuffer, 16, 1);

    sendToKernel(["fd_fdstat_get", { sharedBuffer, fd }]);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    let written = 0;
    const bufferBytes: number[] = [];

    const buffers = Array.from({ length: iovsLen }, (_, i) => {
      const ptr_pos = iovs + i * 8;
      const buf = view.getUint32(ptr_pos, true);
      const bufLen = view.getUint32(ptr_pos + 4, true);

      return new Uint8Array(
        (moduleInstanceExports.memory as WebAssembly.Memory).buffer,
        buf,
        bufLen
      );
    });
    buffers.forEach((iov: Uint8Array) => {
      for (let b = 0; b < iov.byteLength; b += 1) {
        bufferBytes.push(iov[b]);
      }
      written += iov.byteLength;
    });

    // TODO: this might potentially cause stack overflow if bufferBytes is large, we should definitely write in chunks
    const content = new SharedArrayBuffer(written);
    const content_view = new Uint8Array(content);
    for (let i = 0; i < written; i += 1) content_view[i] = bufferBytes[i]; // TODO
    const sharedBuffer = new SharedArrayBuffer(4);
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    sendToKernel(["fd_write", { sharedBuffer, fd, content }]);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    view.setBigUint64(time, utils.now(clockId, CPUTIME_START), true);
    return constants.WASI_ESUCCESS;
  }

  function fd_close(fd: number) {
    workerConsoleLog(`fd_close(${fd})`);

    const sharedBuffer = new SharedArrayBuffer(4);
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    sendToKernel(["fd_close", { sharedBuffer, fd }]);
    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  function fd_filestat_get(fd: number, buf: ptr) {
    workerConsoleLog(`fd_filestat_get(${fd}, 0x${buf.toString(16)})`);

    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 64); // lock, stat buffer
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const statBuf = new DataView(sharedBuffer, 4);

    sendToKernel(["fd_filestat_get", { sharedBuffer, fd }]);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
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

      sendToKernel(["fd_read", { sharedBuffer, fd, len }]);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 4 + bufLen); // lock, buf_used, buf
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const bufUsed = new Uint32Array(sharedBuffer, 4, 1);
    const dataBuffer = new Uint8Array(sharedBuffer, 8);

    sendToKernel(["fd_readdir", { sharedBuffer, fd, cookie, bufLen }]);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 4 + 8); // lock, _padding, file_pos
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const file_pos = new BigUint64Array(sharedBuffer, 8, 1);

    sendToKernel(["fd_seek", { sharedBuffer, fd, offset, whence }]);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const path = DECODER.decode(view8.slice(pathPtr, pathPtr + pathLen));

    workerConsoleLog(
      `path_create_directory(${fd}, ${path}, ${pathLen}) [path=${path}]`
    );

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel(["path_create_directory", { sharedBuffer, fd, path }]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    return err;
  }

  function path_filestat_get(
    fd: number,
    lookupFlags: LookupFlags,
    pathPtr: ptr,
    pathLen: number,
    buf: ptr
  ) {
    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const path = DECODER.decode(view8.slice(pathPtr, pathPtr + pathLen));

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
      { sharedBuffer, fd, path, lookupFlags },
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
    workerConsoleLog(
      `path_open(${dirFd}, ${lookupFlags}, 0x${pathPtr.toString(
        16
      )}, ${pathLen}, ${openFlags}, ${fsRightsBase}, ${fsRightsInheriting}, ${fdFlags}, 0x${openedFdPtr.toString(
        16
      )})`
    );
    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );
    const view8 = new Uint8Array(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const path = DECODER.decode(view8.slice(pathPtr, pathPtr + pathLen));
    workerConsoleLog(`path_open: path = ${path}`);

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
      },
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
    const { command, args, extended_env, background, redirects } =
      JSON.parse(syscallDataJson);
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
          },
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
        sendToKernel(["chdir", { dir, sharedBuffer }]);
        Atomics.wait(lck, 0, -1);
        const err = Atomics.load(lck, 0);

        return `${err}\x1b${dir}`;
      }
      case "set_env": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        sendToKernel(["set_env", { args, sharedBuffer }]);
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
      case "set_echo": {
        const sharedBuffer = new SharedArrayBuffer(4);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;

        sendToKernel(["set_echo", { shouldEcho: args[0], sharedBuffer }]);
        Atomics.wait(lck, 0, -1);

        return `${constants.EXIT_SUCCESS}\x1b`;
      }
      case "isatty": {
        const sharedBuffer = new SharedArrayBuffer(8);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;
        const isattyPtr = new Int32Array(sharedBuffer, 4, 1);
        const fd = parseInt(args[0], 10);

        sendToKernel(["isatty", { sharedBuffer, fd }]);
        Atomics.wait(lck, 0, -1);

        return `${constants.EXIT_SUCCESS}\x1b${isattyPtr[0]}`;
      }
      case "getpid": {
        const sharedBuffer = new SharedArrayBuffer(8);
        const lck = new Int32Array(sharedBuffer, 0, 1);
        lck[0] = -1;
        const pidPtr = new Int32Array(sharedBuffer, 4, 1);

        sendToKernel(["getpid", { sharedBuffer }]);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );
    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );
    const path = DECODER.decode(view8.slice(pathPtr, pathPtr + pathLen));
    workerConsoleLog(`path is ${path}, buffer_len = ${bufferLen}, fd = ${fd}`);
    // special case, path_readlink is used for spawning subprocesses
    if (path[0] === "!") {
      if (bufferLen < 1024) {
        // we need enough buffer to execute the function only once
        view.setUint32(bufferUsedPtr, bufferLen, true);
        return constants.WASI_ESUCCESS;
      }
      const result = ENCODER.encode(specialParse(path.slice(1)));
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
      },
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const path = DECODER.decode(view8.slice(pathPtr, pathPtr + pathLen));

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel(["path_remove_directory", { sharedBuffer, fd, path }]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    return err;
  }

  function path_rename() {
    return placeholder();
  }

  function path_unlink_file(fd: number, pathPtr: ptr, pathLen: number) {
    workerConsoleLog(`path_unlink_file(${fd}, ${pathPtr}, ${pathLen})`);

    const view8 = new Uint8Array(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const path = DECODER.decode(view8.slice(pathPtr, pathPtr + pathLen));

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel(["path_unlink_file", { sharedBuffer, fd, path }]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    return err;
  }

  function sched_yield() {
    return placeholder();
  }

  function fd_prestat_get(fd: number, buf: ptr) {
    workerConsoleLog(`fd_prestat_get(${fd}, 0x${buf.toString(16)})`);
    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + 4 + 1); // lock, name length, preopen_type
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const nameLen = new Int32Array(sharedBuffer, 4, 1);
    const fileType = new Uint8Array(sharedBuffer, 8, 1);

    sendToKernel(["fd_prestat_get", { sharedBuffer, fd }]);
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const sharedBuffer = new SharedArrayBuffer(4 + pathLen); // lock, path
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;
    const path = new Uint8Array(sharedBuffer, 4, pathLen);

    sendToKernel(["fd_prestat_dir_name", { sharedBuffer, fd, pathLen }]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === constants.WASI_ESUCCESS) {
      view8.set(path, pathPtr);
    }
    const pathStr = DECODER.decode(view8.slice(pathPtr, pathPtr + pathLen));
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const oldPath = DECODER.decode(
      view8.slice(oldPathPtr, oldPathPtr + oldPathLen)
    );
    const newPath = DECODER.decode(
      view8.slice(newPathPtr, newPathPtr + newPathLen)
    );
    workerConsoleLog(`path_symlink: ${newPath} --> ${oldPath}`);

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel(["path_symlink", { sharedBuffer, oldPath, newFd, newPath }]);

    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);

    return err;
  }

  function path_link(
    oldFd: number,
    oldFlags: number,
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
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    const oldPath = DECODER.decode(
      view8.slice(oldPathPtr, oldPathPtr + oldPathLen)
    );
    const newPath = DECODER.decode(
      view8.slice(newPathPtr, newPathPtr + newPathLen)
    );

    workerConsoleLog(`path_link: ${newPath} -> ${oldPath}`);

    const sharedBuffer = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sharedBuffer, 0, 1);
    lck[0] = -1;

    sendToKernel([
      "path_link",
      { sharedBuffer, oldFd, oldFlags, oldPath, newFd, newPath },
    ]);

    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  // TODO: it doesn't work for now
  function poll_oneoff(
    sin: ptr,
    sout: ptr,
    nsubscriptions: number,
    nevents: ptr
  ) {
    workerConsoleLog(
      `poll_oneoff(${sin}, ${sout}, ${nsubscriptions}, ${nevents})`
    );
    const view = new DataView(
      (moduleInstanceExports.memory as WebAssembly.Memory).buffer
    );

    let eventc = 0;
    let waitEnd = 0n;
    for (let i = 0; i < nsubscriptions; i += 1) {
      const userdata = view.getBigUint64(sin, true);
      sin += 8;
      const eventType = view.getUint8(sin);
      sin += 1;
      switch (eventType) {
        case constants.WASI_EVENTTYPE_CLOCK: {
          sin += 7;
          const identifier = view.getBigUint64(sin, true);
          sin += 8;
          const clockid = view.getUint32(sin, true);
          sin += 8;
          const timestamp = view.getBigUint64(sin, true);
          sin += 8;
          const precision = view.getBigUint64(sin, true);
          sin += 8;
          const subclockflags = view.getUint16(sin, true);
          sin += 8;

          const absolute = subclockflags === 1;

          workerConsoleLog(
            `identifier = ${identifier}, clockid = ${clockid}, timestamp = ${timestamp}, precision = ${precision}, absolute = ${absolute}`
          );

          const n = utils.now(clockid, CPUTIME_START);
          const end = absolute ? timestamp : n + timestamp;
          waitEnd = end > waitEnd ? end : waitEnd;

          view.setBigUint64(sout, userdata, true);
          sout += 8;
          view.setUint16(sout, constants.WASI_ESUCCESS, true); // error
          sout += 2; // pad offset 2
          view.setUint8(sout, constants.WASI_EVENTTYPE_CLOCK);
          sout += 6; // pad offset 3

          eventc += 1;

          break;
        }
        case constants.WASI_EVENTTYPE_FD_READ:
        case constants.WASI_EVENTTYPE_FD_WRITE: {
          sin += 3; // padding
          view.getUint32(sin, true);
          sin += 4;

          view.setBigUint64(sout, userdata, true);
          sout += 8;
          view.setUint16(sout, constants.WASI_ENOSYS, true); // error
          sout += 2; // pad offset 2
          view.setUint8(sout, eventType);
          sout += 1; // pad offset 3
          sout += 5; // padding to 8

          eventc += 1;

          break;
        }
        default:
          return constants.WASI_EINVAL;
      }
    }

    view.setUint32(nevents, eventc, true);

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

    isatty,

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
    } catch (e) {
      workerConsoleLog(`error: ${e}`);
      sendToKernel(["stderr", `${e.stack}\n`]);
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
