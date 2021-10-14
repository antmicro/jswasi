// NODE// import * as fs from "fs";
// NODE// import { parentPort } from "worker_threads";
import * as constants from './constants.js';
import { realpath } from './utils.js';

type ptr = number;

const IS_NODE = typeof self === 'undefined';
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

let started: boolean;
let mod: string;
let myself: number;
let args: string[];
let env: {key: string, val: string};

const onmessage_ = function (e) {
  //worker_console_log('got a message!');
  if (!started) {
    if (e.data[0] === 'start') {
      started = true;
      mod = e.data[1];
      myself = e.data[2];
      args = e.data[3];
      env = e.data[4];
    }
  }
};

if (IS_NODE) {
  // @ts-ignore
  parentPort.once('message', (message) => {
    const msg = { data: message };
    onmessage_(msg);
  });
} else {
  onmessage = onmessage_;
}

function worker_send(msg) {
  if (IS_NODE) {
    const msg_ = { data: [myself, ...msg] };
    // @ts-ignore
    parentPort.postMessage(msg_);
  } else {
    const msg_ = [myself, ...msg];
    // @ts-ignore
    postMessage(msg_);
  }
}

function worker_console_log(msg) {
  // you can control debug logs dynamically based on DEBUG env variable
  if (env['DEBUG'] && !(env['DEBUG'] === '0' || env['DEBUG'] === 'false' || env['DEBUG'] === '')) {
    worker_send(['console', msg]);
  }
}

function do_exit(exit_code: number) {
  if (IS_NODE) {
    const buf = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(buf, 0, 1);
	    lck[0] = -1;
    worker_send(['exit', exit_code]); // never return
    Atomics.wait(lck, 0, -1);
  } else {
    worker_console_log('calling close()');
    worker_send(['exit', exit_code]);
    close();
  }
}

function WASI() {
  let moduleInstanceExports = null;

  function setModuleInstance(instance) {
    moduleInstanceExports = instance.exports;
  }

  function environ_sizes_get(environ_count: ptr, environ_size: ptr) {
    worker_console_log(`environ_sizes_get(0x${environ_count.toString(16)}, 0x${environ_size.toString(16)})`);

    const view = new DataView(moduleInstanceExports.memory.buffer);

    const environ_count_ = Object.keys(env).length;
    view.setUint32(environ_count, environ_count_, true);

    const environ_size_ = Object.entries(env).reduce((sum, [key, val]) => sum + ENCODER.encode(`${key}=${val}\0`).byteLength, 0);
    view.setUint32(environ_size, environ_size_, true);

    return constants.WASI_ESUCCESS;
  }

  function environ_get(environ: ptr, environ_buf: ptr) {
    worker_console_log(`environ_get(${environ.toString(16)}, ${environ_buf.toString(16)})`);

    const view = new DataView(moduleInstanceExports.memory.buffer);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    Object.entries(env).forEach(([key, val], i) => {
      // set pointer address to beginning of next key value pair
      view.setUint32(environ + i * 4, environ_buf, true);
      // write string describing the variable to WASM memory
      const variable = ENCODER.encode(`${key}=${val}\0`);
      view8.set(variable, environ_buf);
      // calculate pointer to next variable
      environ_buf += variable.byteLength;
    });

    return constants.WASI_ESUCCESS;
  }

  function args_sizes_get(argc: ptr, argvBufSize: ptr) {
    worker_console_log(`args_sizes_get(${argc.toString(16)}, ${argvBufSize.toString(16)})`);

    const view = new DataView(moduleInstanceExports.memory.buffer);

    view.setUint32(argc, args.length, true);
    view.setUint32(argvBufSize, ENCODER.encode(args.join('')).byteLength + args.length, true);

    return constants.WASI_ESUCCESS;
  }

  function args_get(argv: ptr, argv_buf: ptr) {
    worker_console_log(`args_get(${argv}, 0x${argv_buf.toString(16)})`);

    const view = new DataView(moduleInstanceExports.memory.buffer);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    args.forEach((arg, i) => {
      // set pointer address to beginning of next key value pair
      view.setUint32(argv + i * 4, argv_buf, true);
      // write string describing the argument to WASM memory
      const variable = ENCODER.encode(`${arg}\0`);
      view8.set(variable, argv_buf);
      // calculate pointer to next variable
      argv_buf += variable.byteLength;
    });

    return constants.WASI_ESUCCESS;
  }

  function fd_fdstat_get(fd: number, buf: ptr) {
    worker_console_log(`fd_fdstat_get(${fd}, 0x${buf.toString(16)})`);

    const view = new DataView(moduleInstanceExports.memory.buffer);

    const sbuf = new SharedArrayBuffer(4 + 20); // lock, filetype, rights base, rights inheriting
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;
    const file_type = new Uint8Array(sbuf, 4, 1);
    const rights_base = new BigUint64Array(sbuf, 8, 1);
    const rights_inheriting = new BigUint64Array(sbuf, 16, 1);

    worker_send(['fd_fdstat_get', [sbuf, fd]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      worker_console_log(`fd_fdstat_get returned ${err}`);
      return err;
    }

    view.setUint8(buf, file_type[0]);
    if (fd <= 2) {
        view.setUint32(buf + 2, constants.WASI_FDFLAG_APPEND, true);
    } else {
        view.setUint32(buf + 2, 0, true);
    }
    view.setBigUint64(buf + 8, rights_base[0], true);
    view.setBigUint64(buf + 16, rights_inheriting[0], true);

    worker_console_log(`fd_fdstat_get returned ${err}`);
    return constants.WASI_ESUCCESS;
  }

  function fd_write(fd: number, iovs: ptr, iovs_len: number, nwritten: ptr) {
    worker_console_log(`fd_write(${fd}, ${iovs}, ${iovs_len}, ${nwritten})`);
    const view = new DataView(moduleInstanceExports.memory.buffer);

    let written = 0;
    const bufferBytes = [];

    const buffers = Array.from({ length: iovs_len }, (_, i) => {
      const ptr = iovs + i * 8;
      const buf = view.getUint32(ptr, true);
      const bufLen = view.getUint32(ptr + 4, true);

      return new Uint8Array(moduleInstanceExports.memory.buffer, buf, bufLen);
    });
    buffers.forEach((iov: Uint8Array) => {
      for (let b = 0; b < iov.byteLength; b++) {
        bufferBytes.push(iov[b]);
      }
      written += iov.byteLength;
    });

	// TODO: this might potentially cause stack overflow if bufferBytes is large, we should definitely write in chunks
    // const content = String.fromCharCode(...bufferBytes);
    const content = new SharedArrayBuffer(written);
	const content_view = new Uint8Array(content);
	for (let i = 0; i < written; i++) content_view[i] = bufferBytes[i]; // TODO
    const sbuf = new SharedArrayBuffer(4);
    const lck = new Int32Array(sbuf, 0, 1);
	lck[0] = -1;
    worker_send(['fd_write', [sbuf, fd, content]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === 0) {
      worker_console_log(`fd_write written ${written} bytes.`);
      view.setUint32(nwritten, written, true);
    } else {
	  worker_console_log('fd_write ERROR!.');
	}
    return err;
  }

  function proc_exit(exit_code: number) {
    worker_console_log(`proc_exit(${exit_code})`);
    do_exit(exit_code);
  }

  function random_get(buf_addr, buf_len) {
    worker_console_log(`random_get(${buf_addr}, ${buf_len})`);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);
    const numbers = new Uint8Array(buf_len);
    if (IS_NODE) {
      // TODO
    } else {
      self.crypto.getRandomValues(numbers);
    }
    view8.set(numbers, buf_addr);
    return constants.WASI_ESUCCESS;
  }

  function clock_res_get(clock_id: number) {
    worker_console_log(`clock_res_get(${clock_id})`);
    return 1; // TODO!!!!
  }

  function clock_time_get(id, precision, time) {
    worker_console_log(`clock_time_get(${id}, ${precision}, ${time})`);
    const buffer = new DataView(moduleInstanceExports.memory.buffer);
    buffer.setBigUint64(time, BigInt(new Date().getTime()), true);
    return constants.WASI_ESUCCESS;
  }

  function fd_close(fd: number) {
    worker_console_log(`fd_close(${fd})`);

    const sbuf = new SharedArrayBuffer(4);
    const lck = new Int32Array(sbuf, 0, 1);
	    lck[0] = -1;
    worker_send(['fd_close', [sbuf, fd]]);
    Atomics.wait(lck, 0, -1);

    return Atomics.load(lck, 0);
  }

  function fd_advice(a, b, c, d) {
    worker_console_log('fd_advice');
    return 1; // TODO!!!!
  }

  function fd_allocate(a, b, c) {
    worker_console_log('fd_allocate');
    return 1; // TODO!!!!
  }

  function fd_fdstat_set_rights(a, b, c) {
    worker_console_log('fd_fdstat_set_rights');
    return 1; // TODO!!!!
  }

  function fd_filestat_get(fd, buf) {
    worker_console_log(`fd_filestat_get(${fd}, 0x${buf.toString(16)})`);

    const view = new DataView(moduleInstanceExports.memory.buffer);

    const sbuf = new SharedArrayBuffer(4 + 64); // lock, stat buffer
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;
    const statbuf = new DataView(sbuf, 4);

    worker_send(['fd_filestat_get', [sbuf, fd]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    worker_console_log(`fd_filestat_get returned ${err}`);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    const dev = statbuf.getBigUint64(0, true);
    const ino = statbuf.getBigUint64(8, true);
    const file_type = statbuf.getUint8(16);
    const nlink = statbuf.getBigUint64(24, true);
    const size = statbuf.getBigUint64(32, true);
    const atim = statbuf.getBigUint64(38, true);
    const mtim = statbuf.getBigUint64(46, true);
    const ctim = statbuf.getBigUint64(52, true);

    view.setBigUint64(buf, dev, true);
    view.setBigUint64(buf + 8, ino, true);
    view.setUint8(buf + 16, file_type);
    view.setBigUint64(buf + 24, nlink, true);
    view.setBigUint64(buf + 32, size, true);
    view.setBigUint64(buf + 38, atim, true);
    view.setBigUint64(buf + 46, mtim, true);
    view.setBigUint64(buf + 52, ctim, true);

    return constants.WASI_ESUCCESS;
  }

  function fd_read(fd: number, iovs: ptr, iovs_len: number, nread: ptr) {
    if (fd > 2) worker_console_log(`fd_read(${fd}, ${iovs}, ${iovs_len}, ${nread})`);
    const view = new DataView(moduleInstanceExports.memory.buffer);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    let read = 0;
    for (let i = 0; i < iovs_len; i++) {
      const addr = view.getUint32(iovs + 8 * i, true);
      const len = view.getUint32(iovs + 8 * i + 4, true);

      // TODO: ripe for optimisation, addr and len could be put inside a vector and requested all at once
      const sbuf = new SharedArrayBuffer(4 + 4 + len); // lock, read length, read buffer
      const lck = new Int32Array(sbuf, 0, 1);
      lck[0] = -1;
      const readlen = new Int32Array(sbuf, 4, 1);
      const readbuf = new Uint8Array(sbuf, 8, len);

      worker_send(['fd_read', [sbuf, fd, len]]);
      Atomics.wait(lck, 0, -1);

      const err = Atomics.load(lck, 0);
      if (err !== constants.WASI_ESUCCESS) {
        return err;
      }

      view8.set(readbuf, addr);
      read += readlen[0];
    }
    if (fd > 2) worker_console_log(`fd_read read ${read} bytes.`);
    view.setUint32(nread, read, true);

    return constants.WASI_ESUCCESS;
  }

  function fd_readdir(fd: number, buf: ptr, buf_len: number, cookie: number, bufused: ptr) {
    worker_console_log(`fd_readdir(${fd}, ${buf}, ${buf_len}, ${cookie}, ${bufused})`);

    const view = new DataView(moduleInstanceExports.memory.buffer);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    const sbuf = new SharedArrayBuffer(4 + 4 + buf_len); // lock, buf_used, buf
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;
    const buf_used = new Uint32Array(sbuf, 4, 1);
    const databuf = new Uint8Array(sbuf, 8);

    worker_send(['fd_readdir', [sbuf, fd, cookie, buf_len]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    view8.set(databuf, buf);
    view.setUint32(bufused, buf_used[0], true);

    return constants.WASI_ESUCCESS;
  }

  function fd_seek(fd: number, offset: BigInt, whence: number, new_offset: ptr) {
    worker_console_log(`fd_seek(${fd}, ${offset}, ${whence}, ${new_offset})`);
    const view = new DataView(moduleInstanceExports.memory.buffer);

    const sbuf = new SharedArrayBuffer(4 + 4 + 8); // lock, _padding, file_pos
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;
    const file_pos = new BigUint64Array(sbuf, 8, 1);

    worker_send(['fd_seek', [sbuf, fd, offset, whence]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    worker_console_log(`fd_seek returned ${err}, file_pos = ${file_pos[0]}`);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    view.setBigUint64(new_offset, file_pos[0], true);
    return constants.WASI_ESUCCESS;
  }

  function path_create_directory(fd: number, path_ptr: ptr, path_len: number) {
    const view = new DataView(moduleInstanceExports.memory.buffer);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));

    worker_console_log(`path_create_directory(${fd}, ${path}, ${path_len}) [path=${path}]`);

    const sbuf = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;

    worker_send(['path_create_directory', [sbuf, fd, path]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    return err;
  }

  function path_filestat_get(fd: number, flags: number, path_ptr: ptr, path_len: number, buf: ptr) {
    const view = new DataView(moduleInstanceExports.memory.buffer);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));

    worker_console_log(`path_filestat_get(${fd}, ${flags}, ${path}, ${path_len}, 0x${buf.toString(16)}) [path=${path}]`);

    const sbuf = new SharedArrayBuffer(4 + 64); // lock, stat buffer
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;
    const statbuf = new DataView(sbuf, 4);

    worker_send(['path_filestat_get', [sbuf, fd, path, flags]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    worker_console_log(`path_filestat_get returned ${err}`);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    const dev = statbuf.getBigUint64(0, true);
    const ino = statbuf.getBigUint64(8, true);
    const file_type = statbuf.getUint8(16);
    const nlink = statbuf.getBigUint64(24, true);
    const size = statbuf.getBigUint64(32, true);
    const atim = statbuf.getBigUint64(40, true);
    const mtim = statbuf.getBigUint64(48, true);
    const ctim = statbuf.getBigUint64(56, true);

    view.setBigUint64(buf, dev, true);
    view.setBigUint64(buf + 8, ino, true);
    view.setUint8(buf + 16, file_type);
    view.setBigUint64(buf + 24, nlink, true);
    view.setBigUint64(buf + 32, size, true);
    view.setBigUint64(buf + 40, atim, true);
    view.setBigUint64(buf + 48, mtim, true);
    view.setBigUint64(buf + 56, ctim, true);

    return constants.WASI_ESUCCESS;
  }

  function path_open(dir_fd: number, dirflags: number, path_ptr: ptr, path_len: number, oflags: number, fs_rights_base: number, fs_rights_inheriting: number, fdflags: number, opened_fd_ptr: ptr) {
    worker_console_log(`path_open(${dir_fd}, ${dirflags}, 0x${path_ptr.toString(16)}, ${path_len}, ${oflags}, ${fs_rights_base}, ${fs_rights_inheriting}, ${fdflags}, 0x${opened_fd_ptr.toString(16)})`);
    const view = new DataView(moduleInstanceExports.memory.buffer);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));
    worker_console_log(`path_open: path = ${path}`);

    const sbuf = new SharedArrayBuffer(4 + 4); // lock, opened fd
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;
    const opened_fd = new Int32Array(sbuf, 4, 1);
    worker_send(['path_open', [sbuf, dir_fd, path, dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err !== constants.WASI_ESUCCESS) {
      return err;
    }

    view.setUint32(opened_fd_ptr, opened_fd[0], true);
    return constants.WASI_ESUCCESS;
  }

  // used solely in path_readlink
  function special_parse(fullcmd: string) {
    const [cmd, args_string, env_string] = fullcmd.split('\x1b\x1b');
    if (cmd == 'spawn') {
      // reparse args
      const args = args_string.split('\x1b');
      const new_env = Object.fromEntries(env_string.split('\x1b').map((kv) => kv.split('=')));
      const extended_env = {...env, ...new_env};
      const sbuf = new SharedArrayBuffer(4);
      const lck = new Int32Array(sbuf, 0, 1);
      lck[0] = -1;
      worker_send(['spawn', [args[0], args.slice(1), extended_env, sbuf]]);
      worker_console_log('sent.');
      // wait for child process to finish
      Atomics.wait(lck, 0, -1);
      const err = Atomics.load(lck, 0);
      if (err != constants.WASI_ESUCCESS) {
        worker_console_log(`error: spawned process returned ${err}`);
      }
      return '';
    }
    else if (cmd == 'set_env') {
      const args = args_string.split('\x1b');
      if (args.length == 1) {
        delete env[args[0]];
	    return '';
      } else {
          env[args[0]] = args[1];
          if (args[0] == 'PWD') {
            env[args[0]] = realpath(env[args[0]]);
            const sbuf = new SharedArrayBuffer(4);
            const lck = new Int32Array(sbuf, 0, 1);
            lck[0] = -1;
            worker_send(['chdir', [realpath(env[args[0]]), sbuf]]);
            Atomics.wait(lck, 0, -1);
          }
          worker_console_log(`set ${args[0]} to ${env[args[0]]}`);
          return env[args[0]];
        }
    }
    else if (cmd === 'set_echo') {
        worker_send(['set_echo', args_string]);
        return '';
    }

    worker_console_log(`Special command ${cmd} not found.`);
    return '';
  }

  function path_readlink(fd: number, path_ptr: ptr, path_len: number, buffer_ptr: ptr, buffer_len: number, buffer_used_ptr: ptr) {
    worker_console_log(`path_readlink(${fd}, ${path_ptr}, ${path_len}, ${buffer_ptr}, ${buffer_len}, ${buffer_used_ptr})`);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);
    const view = new DataView(moduleInstanceExports.memory.buffer);
    const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));
    worker_console_log(`path is ${path}, buffer_len = ${buffer_len}, fd = ${fd}`);
    if (path[0] == '!') {
      if (buffer_len < 1024) {
        // we need enough buffer to execute the function only once
        view.setUint32(buffer_used_ptr, buffer_len, true);
        return constants.WASI_ESUCCESS;
      }
      const result_s = special_parse(path.slice(1));
      const result = ENCODER.encode(`${result_s}\0`);
      let count = result.byteLength;
      if (count > 1024) count = 1024;
      view8.set(result.slice(0, count), buffer_ptr);
      view.setUint32(buffer_used_ptr, count, true);
      worker_console_log(`wrote ${count} bytes for now, full result is '${result_s}'`);
      return constants.WASI_ESUCCESS;
    }
    return constants.WASI_EBADF;
  }

  function path_remove_directory(fd: number, path_ptr: ptr, path_len: number) {
    worker_console_log(`path_remove_directory(${fd}, ${path_ptr}, ${path_len})`);

    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));

    const sbuf = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;

    worker_send(['path_remove_directory', [sbuf, fd, path]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    return err;
  }

  function path_rename() {
    worker_console_log('path_rename');
    return 1;
  }

  function path_unlink_file(fd: number, path_ptr: ptr, path_len: number) {
    worker_console_log(`path_unlink_file(${fd}, ${path_ptr}, ${path_len})`);

    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));

    const sbuf = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;

    worker_send(['path_unlink_file', [sbuf, fd, path]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    return err;
  }

  function sched_yield() {
    worker_console_log('sched_yield');
    return 1;
  }

  function fd_prestat_get(fd: number, buf: ptr) {
    worker_console_log(`fd_prestat_get(${fd}, 0x${buf.toString(16)})`);
    const view = new DataView(moduleInstanceExports.memory.buffer);

    const sbuf = new SharedArrayBuffer(4 + 4 + 1); // lock, name length, preopen_type
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;
    const name_len = new Int32Array(sbuf, 4, 1);
    const preopen_type = new Uint8Array(sbuf, 8, 1);

    worker_send(['fd_prestat_get', [sbuf, fd]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === constants.WASI_ESUCCESS) {
      view.setUint8(buf, preopen_type[0]);
      view.setUint32(buf + 4, name_len[0], true);
      worker_console_log(`fd_prestat_get returned preonepend type ${preopen_type[0]} of size ${name_len[0]}`);
    } else {
      worker_console_log(`fd_prestat_get returned ${err}`);
    }
    return err;
  }

  function fd_prestat_dir_name(fd: number, path_ptr, path_len: number) {
    worker_console_log(`fd_prestat_dir_name(${fd}, 0x${path_ptr.toString(16)}, ${path_len})`);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    const sbuf = new SharedArrayBuffer(4 + path_len); // lock, path
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;
    const path = new Uint8Array(sbuf, 4, path_len);

    worker_send(['fd_prestat_dir_name', [sbuf, fd, path_len]]);
    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);
    if (err === constants.WASI_ESUCCESS) {
      view8.set(path, path_ptr);
    }
    const path_str = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));
    worker_console_log(`prestat returned ${err}, "${path_str}" of size ${path_len}`);
    return err;
  }

  function fd_datasync() {
    worker_console_log('fd_datasync');
    return constants.WASI_ESUCCESS;
  }

  function fd_filestat_set_size() {
    worker_console_log('fd_filestat_set_size');
    return constants.WASI_ESUCCESS;
  }

  function fd_sync() {
    worker_console_log('fd_sync');
    return constants.WASI_ESUCCESS;
  }

  function path_symlink(path_ptr: ptr, path_len: number, fd: number, newpath_ptr: ptr, newpath_len: number) {
    worker_console_log(`path_symlink(0x${path_ptr.toString(16)}, ${path_len}, ${fd}, 0x${newpath_ptr.toString(16)}, ${newpath_len})`);
    const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

    const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));
    const newpath = DECODER.decode(view8.slice(newpath_ptr, newpath_ptr + newpath_len));
    worker_console_log(`path_symlink: ${newpath} --> ${path}`);

    const sbuf = new SharedArrayBuffer(4); // lock
    const lck = new Int32Array(sbuf, 0, 1);
    lck[0] = -1;

    worker_send(['path_symlink', [sbuf, path, fd, newpath]]);

    Atomics.wait(lck, 0, -1);

    const err = Atomics.load(lck, 0);

    return err;
  }

  function fd_fdstat_set_flags(a, b) {
    worker_console_log(`fd_fdstat_set_flags(${a}, ${b})`);
    return constants.WASI_ESUCCESS;
  }

  function fd_pwrite(a, b, c, d, e) {
    worker_console_log(`fd_pwrite(${a}, ${b}, ${c}, ${d}, ${e})`);
    return constants.WASI_ESUCCESS;
  }

  function fd_renumber(a, b) {
    worker_console_log(`fd_renumber(${a}, ${b})`);
    return constants.WASI_ESUCCESS;
  }

  function fd_tell(a, b) {
    worker_console_log(`fd_tell(${a}, ${b})`);
    return constants.WASI_ESUCCESS;
  }

  function path_filestat_set_times(a, b, c, d, e, f, g) {
    worker_console_log(`fd_pwrite(${a}, ${b}, ${c}, ${d}, ${e}, ${f}, ${g})`);
    return constants.WASI_ESUCCESS;
  }

  function proc_raise(a) {
    worker_console_log(`proc_raise(${a})`);
    return constants.WASI_ESUCCESS;
  }

  function sock_recv(a, b, c, d, e, f) {
    worker_console_log('sock_recv');
    return 1; // TODO
  }

  function sock_send(a, b, c, d, e) {
    worker_console_log('sock_send');
    return 1; // TODO
  }

  function sock_shutdown(a, b) {
    worker_console_log('sock_shutdown');
    return 1; // TODO
  }

  const placeholder = function () {
    worker_console_log(`> Entering stub ${(new Error()).stack.split('\n')[2].trim().split(' ')[1]}`);
    return constants.WASI_ESUCCESS;
  };

  function poll_oneoff() {
    placeholder();
  }

  function path_link() {
    placeholder();
  }

  function fd_advise() {
    placeholder();
  }

  function fd_filestat_set_times() {
    placeholder();
  }

  function fd_pread() {
    placeholder();
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

async function importWasmModule(moduleName, wasiCallbacksConstructor) {

  const wasiCallbacks = wasiCallbacksConstructor();
  const moduleImports = {
    wasi_snapshot_preview1: wasiCallbacks,
    wasi_unstable: wasiCallbacks,
  };

  if (WebAssembly.instantiate) {
    worker_console_log('WebAssembly.instantiate');

    const instance = await WebAssembly.instantiate(mod, moduleImports);

    wasiCallbacks.setModuleInstance(instance);
    try {
      // @ts-ignore
      instance.exports._start();
      do_exit(0);
    } catch (e) {
      worker_console_log(`error: ${e}`);
      worker_send(['stderr', `${e.stack}\n`]);
      do_exit(255);
    }
  } else if (IS_NODE) {
    // @ts-ignore
    const buffer = fs.readFileSync(moduleName, null);
    const module = await WebAssembly.compile(buffer);

    let instance = null;
    try {
      instance = await WebAssembly.instantiate(module, moduleImports);
    } catch (e) {
      worker_console_log(`error: ${e}`);
      worker_send(['stderr', `${e.stack}\n`]);
      do_exit(255);
      return;
    }

    wasiCallbacks.setModuleInstance(instance);
    try {
      instance.exports._start();
      do_exit(0);
    } catch (e) {
      worker_console_log(`error: ${e}`);
      worker_send(['stderr', `${e.stack}\n`]);
      do_exit(255);
    }
  } else {
    worker_console_log('WebAssembly.instantiate is not supported');
  }
}

async function start_wasm() {
  if (started && mod != '') {
    worker_console_log(`Loading ${mod}`);
    try {
      if (IS_NODE) {
        // @ts-ignore
        if (!fs.existsSync(mod)) {
          worker_console_log(`File ${mod} not found!`);
          worker_send(['stderr', `File ${mod} not found!`]);
          started = false;
          mod = '';
          do_exit(255);
          return;
        }
      }
      await importWasmModule(mod, WASI);
    } catch (err) {
      worker_console_log(`Failed instantiating WASM module: ${err}`);
      worker_send(['stderr', `Failed instantiating WASM module: ${err}`]);
      do_exit(255);
    }
    worker_console_log('done.');
  } else {
    setTimeout(() => {
      start_wasm();
    }, 0);
  }
}

(async () => await start_wasm())();
