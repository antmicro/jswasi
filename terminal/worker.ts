// TODO: remove any code taken from here:
// WebAssembly Tutor (https://www.wasmtutor.com/webassembly-barebones-wasi)

// TODO: remove any code taken from here:
// bjorn3 (https://github.com/bjorn3/rust/blob/compile_rustc_wasm4/rustc.html)

//NODE// import * as fs from "fs";
//NODE// import { parentPort } from "worker_threads";
import * as constants from "./constants.js";

type ptr = number;

const DEBUG = true;
const IS_NODE = typeof self === 'undefined';
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

let started = false;
let fname = "";
let myself = null;
let args = [];
let env = {};

const onmessage_ = function (e) {
    if (DEBUG) worker_console_log("got a message!");
    if (!started) {
        if (e.data[0] === "start") {
            started = true;
            fname = e.data[1];
            myself = e.data[2];
            args = e.data[3];
            env = e.data[4];
        }
    }
}

if (IS_NODE) {
    // @ts-ignore
    parentPort.once('message', (message) => {
        let msg = {data: message};
        onmessage_(msg);
    });
} else {
    onmessage = onmessage_;
}

function worker_send(msg) {
    if (IS_NODE) {
        const msg_ = {data: [myself, msg[0], msg[1]]};
        // @ts-ignore
        parentPort.postMessage(msg_);
    } else {
        const msg_ = [myself, ...msg];
        // @ts-ignore
        postMessage(msg_);
    }
}

function worker_console_log(msg) {
    worker_send(["console", msg]);
}

function do_exit(exit_code: number) {
    if (IS_NODE) {
        const buf = new SharedArrayBuffer(4); // lock
        const lck = new Int32Array(buf, 0, 1);
        worker_send(["exit", exit_code]); // never return
        Atomics.wait(lck, 0, 0);
    } else {
        if (DEBUG) worker_console_log("calling close()");
        worker_send(["exit", exit_code]);
        close();
    }
}

function WASI() {

    let moduleInstanceExports = null;

    function setModuleInstance(instance) {
        moduleInstanceExports = instance.exports;
    }

    function environ_sizes_get(environ_count: ptr, environ_size: ptr) {
        if (DEBUG) worker_console_log(`environ_sizes_get(0x${environ_count.toString(16)}, 0x${environ_size.toString(16)})`);

        const view = new DataView(moduleInstanceExports.memory.buffer);

        let environ_count_ = Object.keys(env).length;
        view.setUint32(environ_count, environ_count_, true);

        let environ_size_ = Object.entries(env).reduce((sum, [key, val]) => sum + ENCODER.encode(`${key}=${val}\0`).byteLength, 0);
        view.setUint32(environ_size, environ_size_, true);


        return constants.WASI_ESUCCESS;
    }

    function environ_get(environ, environ_buf) {
        if (DEBUG) worker_console_log(`environ_get(${environ.toString(16)}, ${environ_buf.toString(16)})`);

        const view = new DataView(moduleInstanceExports.memory.buffer);
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

        let environ_buf_offset = environ_buf;

        Object.entries(env).forEach(([key, val], i) => {
            // set pointer address to beginning of next key value pair
            view.setUint32(environ + i * 4, environ_buf_offset, true);
            // write string describing the variable to WASM memory
            let variable = ENCODER.encode(`${key}=${val}\0`);
            view8.set(variable, environ_buf_offset);
            // calculate pointer to next variable
            environ_buf_offset += variable.byteLength;
        })

        return constants.WASI_ESUCCESS;
    }

    function args_sizes_get(argc, argvBufSize) {
        if (DEBUG) worker_console_log(`args_sizes_get(${argc.toString(16)}, ${argvBufSize.toString(16)})`);

        const view = new DataView(moduleInstanceExports.memory.buffer);

        view.setUint32(argc, args.length, true);
        view.setUint32(argvBufSize, ENCODER.encode(args.join("")).byteLength + args.length, true);

        return constants.WASI_ESUCCESS;
    }

    function args_get(argv, argv_buf) {
        if (DEBUG) worker_console_log("args_get(" + argv + ", 0x" + argv_buf.toString(16) + ")");

        const view = new DataView(moduleInstanceExports.memory.buffer);
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

        let argv_buf_offset = argv_buf;

        Object.entries(args).forEach(([_, arg], i) => {
            // set pointer address to beginning of next key value pair
            view.setUint32(argv + i * 4, argv_buf_offset, true);
            // write string describing the argument to WASM memory
            let variable = ENCODER.encode(`${arg}\0`);
            view8.set(variable, argv_buf_offset);
            // calculate pointer to next variable
            argv_buf_offset += variable.byteLength;
        })

        return constants.WASI_ESUCCESS;
    }

    function fd_fdstat_get(fd: number, buf: ptr) {
        if (DEBUG) worker_console_log(`fd_fdstat_get(${fd}, 0x${buf.toString(16)})`);

        const view = new DataView(moduleInstanceExports.memory.buffer);

        const sbuf = new SharedArrayBuffer(4 + 20); // lock, filetype, rights base, rights inheriting 
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const file_type = new Uint8Array(sbuf, 4, 1);
        const rights_base = new BigUint64Array(sbuf, 8, 1);
        const rights_inheriting = new BigUint64Array(sbuf, 16, 1);

        worker_send(["fd_fdstat_get", [sbuf, fd]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err !== constants.WASI_ESUCCESS) {
            return err;
        }

        view.setUint8(buf, file_type[0]);
        view.setUint32(buf + 2, 0, true); // file descriptor flags
        view.setBigUint64(buf + 8, rights_base[0], true);
        view.setBigUint64(buf + 16, rights_inheriting[0], true);
        
        return constants.WASI_ESUCCESS;
    }

    function fd_write(fd: number, iovs_ptr, iovs_len: number, nwritten_ptr) {
        if (DEBUG) worker_console_log(`fd_write(${fd}, ${iovs_ptr}, ${iovs_len}, ${nwritten_ptr})`);
        const view = new DataView(moduleInstanceExports.memory.buffer);

        let written = 0;
        const bufferBytes = [];

        const buffers = Array.from({length: iovs_len}, function (_, i) {
            const ptr = iovs_ptr + i * 8;
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

        const content = String.fromCharCode(...bufferBytes);

        const sbuf = new SharedArrayBuffer(4);
        const lck = new Int32Array(sbuf, 0, 1);
        worker_send(["fd_write", [sbuf, fd, content]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err === 0) {
            view.setUint32(nwritten_ptr, written, true);
        }
        return err;
    }

    function proc_exit(exit_code) {
        if (DEBUG) worker_console_log(`proc_exit(${exit_code})`);
        do_exit(exit_code);
    }

    function random_get(buf_addr, buf_len) {
        if (DEBUG) worker_console_log(`random_get(${buf_addr}, ${buf_len})`);
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);
        let numbers = new Uint8Array(buf_len);
        if (IS_NODE) {
            // TODO
        } else {
            self.crypto.getRandomValues(numbers);
        }
        view8.set(numbers, buf_addr);
        return constants.WASI_ESUCCESS;
    }

    function clock_res_get(a, b) {
        if (DEBUG) worker_console_log(`clock_res_get(${a},${b})`);
        return 1; // TODO!!!!
    }


    function clock_time_get(id, precision, time) {
        if (DEBUG) worker_console_log(`clock_time_get(${id}, ${precision}, ${time})`);
        let buffer = new DataView(moduleInstanceExports.memory.buffer)
        buffer.setBigUint64(time, BigInt(new Date().getTime()), true);
        return constants.WASI_ESUCCESS;
    }

    function fd_close(fd) {
        if (DEBUG) worker_console_log(`fd_close(${fd})`);

        const sbuf = new SharedArrayBuffer(4);
        const lck = new Int32Array(sbuf, 0, 1);
        worker_send(["fd_close", [sbuf, fd]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        return err;
    }

    function fd_advice(a, b, c, d) {
        if (DEBUG) worker_console_log("fd_advice");
        return 1; // TODO!!!!
    }

    function fd_allocate(a, b, c) {
        if (DEBUG) worker_console_log("fd_allocate");
        return 1; // TODO!!!!
    }

    function fd_fdstat_set_rights(a, b, c) {
        if (DEBUG) worker_console_log("fd_fdstat_set_rights");
        return 1; // TODO!!!!
    }

    function fd_filestat_get(fd, buf) {
        if (DEBUG) worker_console_log("fd_filestat_get(" + fd + ", " + buf + ")");

        const view = new DataView(moduleInstanceExports.memory.buffer);

        const sbuf = new SharedArrayBuffer(4 + 64); // lock, stat buffer
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const statbuf = new DataView(sbuf, 4);

        worker_send(["fd_filestat_get", [sbuf, fd]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
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

    function fd_read(fd: number, iovs_ptr, iovs_len, nread_ptr) {
        if (DEBUG) worker_console_log("fd_read(" + fd + ", " + iovs_ptr + ", " + iovs_len + ", " + nread_ptr + ")");
        const view = new DataView(moduleInstanceExports.memory.buffer);
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

        let nread = 0;
        for (let i = 0; i < iovs_len; i++) {
            let addr = view.getUint32(iovs_ptr + 8 * i, true);
            let len = view.getUint32(iovs_ptr + 8 * i + 4, true);
            
            // TODO: ripe for optimisation, addr and len could be put inside a vector and requested all at once
            const sbuf = new SharedArrayBuffer(4 + 4 + len); // lock, read length, read buffer
            const lck = new Int32Array(sbuf, 0, 1);
            lck[0] = -1;
            const readlen = new Int32Array(sbuf, 4, 1);
            const readbuf = new Uint8Array(sbuf, 8, len);

            worker_send(["fd_read", [sbuf, fd, len]]);
            Atomics.wait(lck, 0, -1);

            const err = Atomics.load(lck, 0);
            if (err !== constants.WASI_ESUCCESS) {
                return err;
            }

            view8.set(readbuf, addr);
            nread += readlen[0];
        }
        view.setUint32(nread_ptr, nread, true);
        
        return constants.WASI_ESUCCESS;
    }

    function fd_readdir(fd: number, buf, buf_len: number, cookie: number, bufused) {
        if (DEBUG) worker_console_log(`fd_readdir(${fd}, ${buf}, ${buf_len}, ${cookie}, ${bufused})`);

        const view = new DataView(moduleInstanceExports.memory.buffer);
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

        const sbuf = new SharedArrayBuffer(4 + 4 + buf_len); // lock, buf_used, buf
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const buf_used = new Uint32Array(sbuf, 4, 1);
        const databuf = new Uint8Array(sbuf, 8);

        worker_send(["fd_readdir", [sbuf, fd, cookie, buf_len]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err !== constants.WASI_ESUCCESS) {
            return err;
        }

        view8.set(databuf, buf);
        view.setUint32(bufused, buf_used[0], true);

        return constants.WASI_ESUCCESS;
    }

    function fd_seek(fd: number, offset: BigInt, whence: number, new_offset) {
        if (DEBUG) worker_console_log(`fd_seek(${fd}, ${offset}, ${whence}, ${new_offset})`);
        const view = new DataView(moduleInstanceExports.memory.buffer);

        const sbuf = new SharedArrayBuffer(4 + 4 + 8); // lock, _padding, file_pos
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const file_pos = new BigUint64Array(sbuf, 8, 1);

        worker_send(["fd_seek", [sbuf, fd, offset, whence]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
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

        if (DEBUG) worker_console_log(`path_create_directory(${fd}, ${path_ptr}, ${path_len}) [path=${path}]`);

        const sbuf = new SharedArrayBuffer(4); // lock
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;

        worker_send(["path_create_directory", [sbuf, fd, path]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        return err;
    }

    function path_filestat_get(fd, flags, path_ptr, path_len, buf) {
        const view = new DataView(moduleInstanceExports.memory.buffer);
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

        let path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len))

        if (DEBUG) worker_console_log(`path_filestat_get(${fd}, ${flags}, ${path_ptr}, ${path_len}, ${buf}) [path=${path}]`);
	if (path != fix_path(path)) {
		path = fix_path(path);
		worker_console_log(`Fixing path to ${path}`);
	}

        const sbuf = new SharedArrayBuffer(4 + 64); // lock, stat buffer
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const statbuf = new DataView(sbuf, 4);

        worker_send(["path_filestat_get", [sbuf, fd, path, flags]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
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


    function fix_path(path: string) {
      // TODO: home handling should be moved to shell in the end
      if (path == "~") return env['HOME'];
      if (path == "/~") return env['HOME'];
      if (path.substr(0,2) == "~/") return env['HOME'] + path.substr(2,4096);
	   // if (path[0] == ".") if (env['PWD'] != "/") return path.replace(".", env['PWD']);
	    return path;
      let pwd = env['PWD'];
      if (pwd != "/") pwd = pwd + "/";
      if (DEBUG) worker_console_log(`trying to fix path ${path}`);
      if (path.length == 0) return path;
      if (path[0] == '!') return path;
      if (path[0] == '/') return path;
      if (path[0] != '.') return "/" + path;
      if (path.substr(0,2) == "./") return pwd + path.substr(2);
      return pwd + path;
    }

    function realpath(path) {
        let result = [];
        let result_path = "";
        let tmp_path = path;
        let part = "";
        let level = 0;
        let root_path = (path[0] == '/');
        while (tmp_path != "") {
            if (tmp_path.indexOf("/") != -1) {
                part = tmp_path.substr(0, tmp_path.indexOf("/"));
             } else part = tmp_path;
             tmp_path = tmp_path.substr(part.length+1);
             if (part == "..") {
                 if (level > 0) level -= 1;
             } else if (part == "~") {
		 // TODO: shell should always parse this in the end and provide "normal" paths
		 result[level] = env["HOME"];
		 level++;
             } else {
                 result[level] = part;
                 level++;
             }
        }
        result_path = result.slice(0, level).join("/");
        if (root_path) if (result_path == "") return "/";
        return result_path;
    }

    function special_parse(fullcmd: string) {
            let [cmd, ...args] = fullcmd.split(" ");
            if (cmd == "spawn") {
                worker_console_log("We are going to send a spawn message!");
                const sbuf = new SharedArrayBuffer(4);
                const lck = new Int32Array(sbuf, 0, 1);
                lck[0] = -1;
                worker_send(["spawn", [args[0], args.slice(1), env, sbuf]]);
                worker_console_log("sent.");
                // wait for child process to finish
                Atomics.wait(lck, 0, -1);
                return "";
            }
            if (cmd == "set_env") {
               env[args[0]] = args[1];
               if (args[0] == "PWD") {
		       env[args[0]] = realpath(args[1]);
                       const sbuf = new SharedArrayBuffer(4);
                       const lck = new Int32Array(sbuf, 0, 1);
                       lck[0] = -1;
	               worker_send(["chdir", [realpath(args[1]), sbuf]]);
                       Atomics.wait(lck, 0, -1);
	       }
               worker_console_log("set " +args[0]+ " to " + env[args[0]]);
               return env[args[0]];
            }
                
            worker_console_log(`Special command ${cmd} not found.`);
            return "";
    }

    function path_open(dir_fd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fdflags, opened_fd_ptr) {
        if (DEBUG) worker_console_log(`path_open(${dir_fd}, ${dirflags}, 0x${path_ptr.toString(16)}, ${path_len}, ${oflags}, ${fs_rights_base}, ${fs_rights_inheriting}, ${fdflags}, 0x${opened_fd_ptr.toString(16)})`);
        const view = new DataView(moduleInstanceExports.memory.buffer);
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

        let path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));
        if (DEBUG) worker_console_log(`path_open: path = ${path}`);
	if (path != fix_path(path)) {
		path = fix_path(path);
		worker_console_log(`fixing path to ${path}`);
	}
        const sbuf = new SharedArrayBuffer(4 + 4); // lock, opened fd
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const opened_fd = new Int32Array(sbuf, 4, 1);
        worker_send(["path_open", [sbuf, dir_fd, path, dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err !== constants.WASI_ESUCCESS) {
            return err;
        }

        view.setUint32(opened_fd_ptr, opened_fd[0], true);
        return constants.WASI_ESUCCESS;
    }

    let used_once = false;

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
            let result_s = special_parse(path.slice(1));
            let result = ENCODER.encode(`${result_s}\0`);
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
        if (DEBUG) worker_console_log(`path_remove_directory(${fd}, ${path_ptr}, ${path_len})`);
        
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

        const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));
	
        const sbuf = new SharedArrayBuffer(4); // lock
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;

        worker_send(["path_remove_directory", [sbuf, fd, path]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        return err;
    }

    function path_rename() {
        if (DEBUG) worker_console_log("path_rename");
        return 1;
    }

    function path_unlink_file(fd: number, path_ptr: ptr, path_len: number) {
        if (DEBUG) worker_console_log(`path_unlink_file(${fd}, ${path_ptr}, ${path_len})`);
        
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);

        const path = DECODER.decode(view8.slice(path_ptr, path_ptr + path_len));
	
        const sbuf = new SharedArrayBuffer(4); // lock
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;

        worker_send(["path_unlink_file", [sbuf, fd, path]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        return err;
    }

    function sched_yield() {
        if (DEBUG) worker_console_log("sched_yield");
        return 1;
    }

    function fd_prestat_get(fd: number, buf: ptr) {
        if (DEBUG) worker_console_log(`fd_prestat_get(${fd}, 0x${buf.toString(16)})`);
        const view = new DataView(moduleInstanceExports.memory.buffer);
	
        const sbuf = new SharedArrayBuffer(4 + 4 + 1); // lock, name length, preopen_type
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const name_len = new Int32Array(sbuf, 4, 1);
        const preopen_type = new Uint8Array(sbuf, 8, 1);

        worker_send(["fd_prestat_get", [sbuf, fd]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err === constants.WASI_ESUCCESS) {
            view.setUint8(buf, preopen_type[0]);
            view.setUint32(buf + 4, name_len[0], true);
        }
	worker_console_log(`fd_prestat_get returned preonepend type ${preopen_type[0]} of size ${name_len[0]}`);
        return err;
    }

    function fd_prestat_dir_name(fd: number, path_ptr, path_len: number) {
        if (DEBUG) worker_console_log(`fd_prestat_dir_name(${fd}, 0x${path_ptr.toString(16)}, ${path_len})`);       
        const view8 = new Uint8Array(moduleInstanceExports.memory.buffer);
	
	const sbuf = new SharedArrayBuffer(4 + path_len); // lock, path 
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const path = new Uint8Array(sbuf, 4, path_len);

        worker_send(["fd_prestat_dir_name", [sbuf, fd, path_len]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err === constants.WASI_ESUCCESS) {
            view8.set(path, path_ptr);
        }
	worker_console_log(`prestat returned ${path} of size ${path_len}`);
        return err;

    }

    function fd_datasync() {
        if (DEBUG) worker_console_log("fd_datasync");
        return constants.WASI_ESUCCESS;
    }

    function fd_filestat_set_size() {
        if (DEBUG) worker_console_log("fd_filestat_set_size");
        return constants.WASI_ESUCCESS;
    }

    function fd_sync() {
        if (DEBUG) worker_console_log("fd_sync");
        return constants.WASI_ESUCCESS;
    }

    function path_symlink() {
        if (DEBUG) worker_console_log("path_symlink");
        return constants.WASI_ESUCCESS;
    }

    function fd_fdstat_set_flags(a, b) {
        if (DEBUG) worker_console_log(`fd_fdstat_set_flags(${a}, ${b})`);
        return constants.WASI_ESUCCESS;
    }

    function fd_pwrite(a, b, c, d, e) {
        if (DEBUG) worker_console_log(`fd_pwrite(${a}, ${b}, ${c}, ${d}, ${e})`);
        return constants.WASI_ESUCCESS;
    }

    function fd_renumber(a, b) {
        if (DEBUG) worker_console_log(`fd_renumber(${a}, ${b})`);
        return constants.WASI_ESUCCESS;
    }

    function fd_tell(a, b) {
        if (DEBUG) worker_console_log(`fd_tell(${a}, ${b})`);
        return constants.WASI_ESUCCESS;
    }

    function path_filestat_set_times(a, b, c, d, e, f, g) {
        if (DEBUG) worker_console_log(`fd_pwrite(${a}, ${b}, ${c}, ${d}, ${e}, ${f}, ${g})`);
        return constants.WASI_ESUCCESS;
    }

    function proc_raise(a) {
        if (DEBUG) worker_console_log(`proc_raise(${a})`);
        return constants.WASI_ESUCCESS;
    }

    function sock_recv(a, b, c, d, e, f) {
        if (DEBUG) worker_console_log("sock_recv");
        return 1; // TODO
    }

    function sock_send(a, b, c, d, e) {
        if (DEBUG) worker_console_log("sock_send");
        return 1; // TODO
    }

    function sock_shutdown(a, b) {
        if (DEBUG) worker_console_log("sock_shutdown");
        return 1; // TODO
    }

    let placeholder = function () {
        if (DEBUG) worker_console_log("> Entering stub " + (new Error()).stack.split("\n")[2].trim().split(" ")[1]);
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
    }
}

async function importWasmModule(moduleName, wasiCallbacksConstructor) {
    // make memory shared so that main thread can write to it directly
    const memory = new WebAssembly.Memory({initial: 10, maximum: 10, shared: true});

    const wasiCallbacks = wasiCallbacksConstructor();
    const moduleImports = {
        wasi_snapshot_preview1: wasiCallbacks,
        wasi_unstable: wasiCallbacks,
        js: {mem: memory}
    };


    if (WebAssembly.instantiateStreaming) {
        if (DEBUG) worker_console_log(`WebAssembly.instantiateStreaming`);

        // TODO: rework this, so that other PATH directories work as well
        // maybe compile module in main thread and pass it on postMessage
        // or create SharedArrayBuffer and request file contents
        const root = await navigator.storage.getDirectory();
        const usr = await root.getDirectoryHandle("usr");
        const bin = await usr.getDirectoryHandle("bin");
        const binary = await bin.getFileHandle(moduleName.split("/").slice(-1));
        const file = await binary.getFile();
        const response = new Response(file);

        const {module, instance} = await WebAssembly.instantiateStreaming(response, moduleImports);

        wasiCallbacks.setModuleInstance(instance);
        try {
            // @ts-ignore
            instance.exports._start();
            do_exit(0);
        } catch (e) {
            if (DEBUG) worker_console_log("exception while running wasm");
            if (DEBUG) worker_console_log(e.stack);
            do_exit(255);
        }
    } else if (IS_NODE) {
        // @ts-ignore
        let buffer = fs.readFileSync(moduleName, null);
        let module = await WebAssembly.compile(buffer);

        let instance = null;
        try {
            instance = await WebAssembly.instantiate(module, moduleImports);
        } catch (e) {
            if (DEBUG) worker_console_log("exception while instantiating wasm");
            if (DEBUG) worker_console_log(e.stack);
            do_exit(255);
        }

        wasiCallbacks.setModuleInstance(instance);
        try {
            instance.exports._start();
            do_exit(0);
        } catch (e) {
            if (DEBUG) worker_console_log("exception while running wasm");
            if (DEBUG) worker_console_log(e.stack);
            do_exit(255);
        }
    } else {
        if (DEBUG) worker_console_log(`WebAssembly.instantiateStreaming is not supported`);
    }
}

async function start_wasm() {
    if (started && fname != "") {
        if (DEBUG) worker_console_log("Loading " + fname);
        try {
            if (IS_NODE) {
                // @ts-ignore
                if (!fs.existsSync(fname)) {
                    if (DEBUG) worker_console_log(`File ${fname} not found!`);
                    started = false;
                    fname = "";
                    do_exit(255);
                    return;
                }
            }
            await importWasmModule(fname, WASI);
        } catch(err) {
            if (DEBUG) worker_console_log(`Failed instantiating WASM module: ${err}`);
            do_exit(255);
        }
        if (DEBUG) worker_console_log("done.");
    } else {
        setTimeout(function () {
            start_wasm();
        }, 0);
    }
}

(async () => await start_wasm())();
