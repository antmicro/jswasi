// credits
// WebAssembly Tutor (https://www.wasmtutor.com/webassembly-barebones-wasi)
// bjorn3 (https://github.com/bjorn3/rust/blob/compile_rustc_wasm4/rustc.html)

import {
    WASI_EBADF,
    WASI_ESUCCESS, WASI_FILETYPE_DIRECTORY,
    WASI_O_CREAT, WASI_O_DIRECTORY, WASI_O_EXCL, WASI_O_TRUNC,
    WASI_WHENCE_CUR,
    WASI_WHENCE_END,
    WASI_WHENCE_SET
} from "./constants.js";

let started = false;
let fname = "";
let myself = null;
let ARGS = [];
let ENV = {};

const onmessage_ = function (e) {
    if (!started) {
        if (e.data[0] === "start") {
            started = true;
            fname = e.data[1];
            myself = e.data[2];
            ARGS = e.data[3];
            ENV = e.data[4];
        }
    }
}

function is_node() {
    return (typeof self === 'undefined');
}

//NODE// import node_helpers from './node_helpers.cjs';

if (is_node()) {
        node_helpers.get_parent_port().once('message', (message) => {
        let msg = {data: message};
        onmessage_(msg);
    });
} else {
    worker_console_log("Running in a browser!");
    onmessage = onmessage_;
}

function worker_send(msg) {
    if (is_node()) {
        const msg_ = {data: [myself, msg[0], msg[1]]};
        node_helpers.get_parent_port().postMessage(msg_);
    } else {
        const msg_ = [myself, ...msg];
        postMessage(msg_);
    }
}

function worker_console_log(msg) {
    worker_send(["console", msg]);
}

function do_exit(exit_code: number) {
    if (is_node()) {
        const buf = new SharedArrayBuffer(4); // lock
        const lck = new Int32Array(buf, 0, 1);
        worker_send(["exit", exit_code]); // never return
        Atomics.wait(lck, 0, 0);
    } else {
        worker_console_log("calling close()");
        worker_send(["exit", exit_code]);
        close();
    }
}

function barebonesWASI() {

    let BUFFER = "";
    let moduleInstanceExports = null;

    function setModuleInstance(instance) {
        moduleInstanceExports = instance.exports;
    }

    function getModuleMemoryDataView() {
        return new DataView(moduleInstanceExports.memory.buffer);
    }

    function getModuleMemoryUint8Array() {
        return new Uint8Array(moduleInstanceExports.memory.buffer);
    }

    function environ_sizes_get(environ_count_ptr, environ_size_ptr) {
        worker_console_log(`environ_sizes_get(0x${environ_count_ptr.toString(16)}, 0x${environ_size_ptr.toString(16)})`);

        const view = getModuleMemoryDataView();

        let encoder = new TextEncoder();
        let environ_count = Object.keys(ENV).length;
        view.setUint32(environ_count_ptr, environ_count, true);

        let environ_size = Object.entries(ENV).reduce((sum, [key, val]) => sum + encoder.encode(`${key}=${val}\0`).byteLength, 0);
        view.setUint32(environ_size_ptr, environ_size, true);


        return WASI_ESUCCESS;
    }

    function environ_get(environ, environ_buf) {
        worker_console_log(`environ_get(${environ.toString(16)}, ${environ_buf.toString(16)})`);

        let view = getModuleMemoryDataView();
        let view8 = getModuleMemoryUint8Array();

        let encoder = new TextEncoder();
        let environ_buf_offset = environ_buf;

        Object.entries(ENV).forEach(([key, val], i) => {
            // set pointer address to beginning of next key value pair
            view.setUint32(environ + i * 4, environ_buf_offset, true);
            // write string describing the variable to WASM memory
            let variable = encoder.encode(`${key}=${val}\0`);
            view8.set(variable, environ_buf_offset);
            // calculate pointer to next variable
            environ_buf_offset += variable.byteLength;
        })

        return WASI_ESUCCESS;
    }

    function args_sizes_get(argc, argvBufSize) {
        worker_console_log(`args_sizes_get(${argc.toString(16)}, ${argvBufSize.toString(16)})`);

        const view = getModuleMemoryDataView();

        view.setUint32(argc, ARGS.length, true);
        view.setUint32(argvBufSize, new TextEncoder().encode(ARGS.join("")).byteLength + ARGS.length, true);

        return WASI_ESUCCESS;
    }

    function args_get(argv, argv_buf) {
        worker_console_log("args_get(" + argv + ", 0x" + argv_buf.toString(16) + ")");

        let view = getModuleMemoryDataView();
        let view8 = getModuleMemoryUint8Array();

        let encoder = new TextEncoder();
        let argv_buf_offset = argv_buf;

        Object.entries(ARGS).forEach(([_, arg], i) => {
            // set pointer address to beginning of next key value pair
            view.setUint32(argv + i * 4, argv_buf_offset, true);
            // write string describing the argument to WASM memory
            let variable = encoder.encode(`${arg}\0`);
            view8.set(variable, argv_buf_offset);
            // calculate pointer to next variable
            argv_buf_offset += variable.byteLength;
        })

        return WASI_ESUCCESS;
    }

    function fd_fdstat_get(fd, bufPtr) {
        worker_console_log(`fd_fdstat_get(${fd}, 0x${bufPtr.toString(16)})`);

        const view = getModuleMemoryDataView();

        // const stats = fds[fd].stats();

        if (fd <= 2) {
            view.setBigUint64(bufPtr, BigInt(2)); // chardev
        }
        view.setBigUint64(bufPtr + 8, BigInt(0));
        view.setBigUint64(bufPtr + 16, BigInt(0));

        return WASI_ESUCCESS;
    }

    function getiovs(view, iovs, iovsLen) {
        return Array.from({length: iovsLen}, function (_, i) {
            const ptr = iovs + i * 8;
            const buf = view.getUint32(ptr, true);
            const bufLen = view.getUint32(ptr + 4, true);

            return new Uint8Array(moduleInstanceExports.memory.buffer, buf, bufLen);
        });
    }

    function fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
        worker_console_log(`fd_write(${fd}, ${iovs_ptr}, ${iovs_len}, ${nwritten_ptr})`);
        const view = getModuleMemoryDataView();

        let written = 0;
        const bufferBytes = [];

        const buffers = getiovs(view, iovs_ptr, iovs_len);

        function writev(iov) {
            for (var b = 0; b < iov.byteLength; b++) {
                bufferBytes.push(iov[b]);
            }

            written += b;
        }

        buffers.forEach(writev);

        const content = String.fromCharCode.apply(null, bufferBytes);

        const sbuf = new SharedArrayBuffer(4);
        const lck = new Int32Array(sbuf, 0, 1);
        worker_send(["fd_write", [sbuf, fd, content]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err === WASI_ESUCCESS) {
            view.setUint32(nwritten_ptr, written, true);
        }
        return err;
    }

    function proc_exit(exit_code) {
        worker_console_log(`proc_exit(${exit_code})`);
        close(); // doesn't actually end here
    }

    function random_get(buf_addr, buf_len) {
        worker_console_log(`random_get(${buf_addr}, ${buf_len})`);
        let view8 = getModuleMemoryUint8Array();
        let numbers = new Uint8Array(buf_len);
        self.crypto.getRandomValues(numbers);
        view8.set(numbers, buf_addr);
        return WASI_ESUCCESS;
    }

    function clock_res_get(a, b) {
        worker_console_log(`clock_res_get(${a},${b})`);
        return 1;
    }


    function clock_time_get(id, precision, time) {
        worker_console_log(`clock_time_get(${id}, ${precision}, ${time})`);
        let buffer = getModuleMemoryDataView()
        buffer.setBigUint64(time, BigInt(new Date().getTime()), true);
        return WASI_ESUCCESS;
    }

    function fd_close(fd) {
        worker_console_log(`fd_close(${fd})`);

        const sbuf = new SharedArrayBuffer(4);
        const lck = new Int32Array(sbuf, 0, 1);
        worker_send(["fd_close", [sbuf, fd]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        return err;
    }

    function fd_advice(a, b, c, d) {
        worker_console_log("fd_advice");
        return 1;
    }

    function fd_allocate(a, b, c) {
        worker_console_log("fd_allocate");
        return 1;
    }

    function fd_fdstat_set_rights(a, b, c) {
        worker_console_log("fd_fdstat_set_rights");
        return 1;
    }

    function fd_filestat_get(fd, buf) {
        worker_console_log("fd_filestat_get(" + fd + ", " + buf + ")");

        let view = getModuleMemoryDataView();

        const sbuf = new SharedArrayBuffer(4 + 64); // lock, stat buffer
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const statbuf = new DataView(sbuf, 4);

        worker_send(["fd_filestat_get", [sbuf, fd]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err !== WASI_ESUCCESS) {
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
        return WASI_ESUCCESS;
    }

    function fd_read(fd: number, iovs_ptr, iovs_len, nread_ptr) {
        worker_console_log("fd_read(" + fd + ", " + iovs_ptr + ", " + iovs_len + ", " + nread_ptr + ")");
        let view = getModuleMemoryDataView();
        let view8 = getModuleMemoryUint8Array();

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
            if (err !== WASI_ESUCCESS) {
                return err;
            }

            view8.set(readbuf, addr);
            nread += readlen[0];
        }
        view.setUint32(nread_ptr, nread, true);
        return WASI_ESUCCESS;
    }

    function fd_readdir(fd, buf, buf_len, cookie, bufused) {
        worker_console_log(`fd_readdir(${fd}, ${buf}, ${buf_len}, ${cookie}, ${bufused})`);
        let buffer = getModuleMemoryDataView();
        let buffer8 = getModuleMemoryUint8Array();
        // 8 ,  3408816 ,  128 ,  0n ,  1032332
        if (fds[fd] != undefined && fds[fd].directory != undefined) {
            buffer.setUint32(bufused, 0, true);

            worker_console_log(cookie + " " + Object.keys(fds[fd].directory).slice(Number(cookie)));
            if (cookie >= BigInt(Object.keys(fds[fd].directory).length)) {
                worker_console_log("end of dir");
                return 0;
            }
            let next_cookie = cookie + 1n;
            for (let name of Object.keys(fds[fd].directory).slice(Number(cookie))) {
                let entry = fds[fd].directory[name];
                worker_console_log(name + " " + entry);
                let encoded_name = new TextEncoder().encode(name);

                let offset = 24 + encoded_name.length;

                if ((buf_len - buffer.getUint32(bufused, true)) < offset) {
                    worker_console_log("too small buf");
                    break;
                } else {
                    worker_console_log("next_cookie = " + next_cookie + " " + buf);
                    buffer.setBigUint64(buf, next_cookie, true);
                    next_cookie += 1n;
                    buffer.setBigUint64(buf + 8, 1n, true); // inode
                    buffer.setUint32(buf + 16, encoded_name.length, true);
                    buffer.setUint8(buf + 20, entry.file_type);
                    buffer8.set(encoded_name, buf + 24);
                    worker_console_log("buffer = " + buffer8.slice(buf, buf + offset));
                    buf += offset;
                    buffer.setUint32(bufused, buffer.getUint32(bufused, true) + offset, true);
                }
            }
            worker_console_log("used =" + buffer.getUint32(bufused, true));
            return 0;
        } else {
            return 1;
        }
    }

    function fd_seek(fd, offset, whence, new_offset) {
        worker_console_log(`fd_seek(${fd}, ${offset}, ${whence}, ${new_offset})`);
        let view = getModuleMemoryDataView();
        if (fds[fd] !== undefined) {
            let file = fds[fd];
            switch (whence) {
                case WASI_WHENCE_SET: {
                    file.file_pos = offset;
                    break;
                }
                case WASI_WHENCE_CUR: {
                    file.file_pos += offset;
                    break;
                }
                case WASI_WHENCE_END: {
                    file.file_pos = file.data.length + offset;
                }
            }
            view.setBigUint64(new_offset, file.file_pos, true);
            return WASI_ESUCCESS;
        }
        return WASI_EBADF;
    }

    function path_create_directory() {
        worker_console_log("path_create_directory");
        return 1;
    }

    function path_filestat_get(fd, flags, path_ptr, path_len, buf) {
        console.log("path_filestat_get(", fd, ", ", flags, ", ", path_ptr, ", ", path_len, ", ", buf, ")");

        let view = getModuleMemoryDataView();
        let view8 = getModuleMemoryUint8Array();

        if (fds[fd] != undefined && fds[fd].directory != undefined) {
            let path = new TextDecoder("utf-8").decode(view8.slice(path_ptr, path_ptr + path_len));
            let entry = fds[fd].get_entry_for_path(path);
            if (entry == null) {
                worker_console_log(`path_filestat_get: no entry for path '${path}'`);
                return 1;
            }
            let stat = entry.stat();
            view.setBigUint64(buf, stat.dev, true);
            view.setBigUint64(buf + 8, stat.ino, true);
            view.setUint8(buf + 16, stat.file_type);
            view.setBigUint64(buf + 24, stat.nlink, true);
            view.setBigUint64(buf + 32, stat.size, true);
            view.setBigUint64(buf + 38, stat.atim, true);
            view.setBigUint64(buf + 46, stat.mtim, true);
            view.setBigUint64(buf + 52, stat.ctim, true);
            return WASI_ESUCCESS;
        } else {
            worker_console_log(`path_filestat_get: undefined or not a directory`);
            return 1;
        }
    }

    function path_open(dir_fd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fdflags, opened_fd_ptr) {
        worker_console_log(`path_open(${dir_fd}, ${dirflags}, 0x${path_ptr.toString(16)}, ${path_len}, ${oflags}, ${fs_rights_base}, ${fs_rights_inheriting}, ${fdflags}, 0x${opened_fd_ptr.toString(16)})`);
        let view = getModuleMemoryDataView();
        let view8 = getModuleMemoryUint8Array();

        let path = new TextDecoder().decode(view8.slice(path_ptr, path_ptr + path_len));
        if (path[0] == '!') {
            worker_console_log("We are going to send a spawn message!");
            let [command, ...args] = path.split(" ");
            command = command.slice(1);
            const sbuf = new SharedArrayBuffer(4);
            const lck = new Int32Array(sbuf, 0, 1);
            lck[0] = -1;
            worker_send(["spawn", [command, args, ENV, sbuf]]);
            worker_console_log("sent.");

            // wait for child process to finish
            Atomics.wait(lck, 0, -1);

            return WASI_EBADF; // TODO, WASI_ESUCCESS throws runtime error in WASM so this is a bit better for now
        } else {
            const sbuf = new SharedArrayBuffer(4 + 4); // lock, opened fd
            const lck = new Int32Array(sbuf, 0, 1);
            lck[0] = -1;
            const opened_fd = new Int32Array(sbuf, 4, 1);

            worker_console_log(path);
            worker_send(["path_open", [sbuf, dir_fd, path, dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags]]);
            Atomics.wait(lck, 0, -1);

            const err = Atomics.load(lck, 0);
            if (err !== WASI_ESUCCESS) {
                return err;
            }

            view.setUint32(opened_fd_ptr, opened_fd[0], true);
            return WASI_ESUCCESS;
        }
    }

    function path_readlink() {
        worker_console_log("path_readlink");
        return 1;
    }

    function path_remove_directory() {
        worker_console_log("path_remove_directory");
        return 1;
    }

    function path_rename() {
        worker_console_log("path_rename");
        return 1;
    }

    function path_unlink_file() {
        worker_console_log("path_unlink_file");
        return 1;
    }

    function sched_yield() {
        worker_console_log("sched_yield");
        return 1;
    }

    function fd_prestat_get(fd: number, buf_ptr) {
        worker_console_log(`fd_prestat_get(${fd}, 0x${buf_ptr.toString(16)})`);
        let view = getModuleMemoryDataView();
	
	    const sbuf = new SharedArrayBuffer(4 + 4 + 1); // lock, name length, preopen_type
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const name_len = new Int32Array(sbuf, 4, 1);
        const preopen_type = new Uint8Array(sbuf, 8, 1);

        worker_send(["fd_prestat_get", [sbuf, fd]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err === WASI_ESUCCESS) {
            view.setUint8(buf_ptr, preopen_type[0]);
            view.setUint32(buf_ptr + 4, name_len[0]);
        }
        return err;
    }

    function fd_prestat_dir_name(fd: number, path_ptr, path_len: number) {
        worker_console_log(`fd_prestat_dir_name(${fd}, 0x${path_ptr.toString(16)}, ${path_len})`);       
        let view8 = getModuleMemoryUint8Array();
	
	    const sbuf = new SharedArrayBuffer(4 + path_len); // lock, path 
        const lck = new Int32Array(sbuf, 0, 1);
        lck[0] = -1;
        const path = new Uint8Array(sbuf, 4, path_len);

        worker_send(["fd_prestat_dir_name", [sbuf, fd, path_len]]);
        Atomics.wait(lck, 0, -1);

        const err = Atomics.load(lck, 0);
        if (err === WASI_ESUCCESS) {
            view8.set(path, path_ptr);
        }
        return err;

    }

    function fd_datasync() {
        worker_console_log("fd_datasync");
        return WASI_ESUCCESS;
    }

    function fd_filestat_set_size() {
        worker_console_log("fd_filestat_set_size");
        return WASI_ESUCCESS;
    }

    function fd_sync() {
        worker_console_log("fd_sync");
        return WASI_ESUCCESS;
    }

    function path_symlink() {
        worker_console_log("path_symlink");
        return WASI_ESUCCESS;
    }

    function fd_fdstat_set_flags(a, b) {
        worker_console_log(`fd_fdstat_set_flags(${a}, ${b})`);
        return WASI_ESUCCESS;
    }

    function fd_pwrite(a, b, c, d, e) {
        worker_console_log(`fd_pwrite(${a}, ${b}, ${c}, ${d}, ${e})`);
        return WASI_ESUCCESS;
    }

    function fd_renumber(a, b) {
        worker_console_log(`fd_renumber(${a}, ${b})`);
        return WASI_ESUCCESS;
    }

    function fd_tell(a, b) {
        worker_console_log(`fd_tell(${a}, ${b})`);
        return WASI_ESUCCESS;
    }

    function path_filestat_set_times(a, b, c, d, e, f, g) {
        worker_console_log(`fd_pwrite(${a}, ${b}, ${c}, ${d}, ${e}, ${f}, ${g})`);
        return WASI_ESUCCESS;
    }

    function proc_raise(a) {
        worker_console_log(`proc_raise(${a})`);
        return WASI_ESUCCESS;
    }

    function sock_recv(a, b, c, d, e, f) {
        worker_console_log("sock_recv");
        return 1;
    }

    function sock_send(a, b, c, d, e) {
        worker_console_log("sock_send");
        return 1;
    }

    function sock_shutdown(a, b) {
        worker_console_log("sock_shutdown");
        return 1;
    }

    let placeholder = function () {
        worker_console_log("> Entering stub " + (new Error()).stack.split("\n")[2].trim().split(" ")[1]);
        return WASI_ESUCCESS;
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

function importWasmModule(moduleName, wasiPolyfill) {

    const memory = new WebAssembly.Memory({initial: 2, maximum: 10});
    const moduleImports = {
        wasi_snapshot_preview1: wasiPolyfill,
        wasi_unstable: wasiPolyfill,
        js: {mem: memory}
    };

    (async () => {
        let module = null;

        if (WebAssembly.compileStreaming) {
            module = await WebAssembly.compileStreaming(fetch(moduleName));
        } else {
            let buffer = null;
            if (!is_node()) {
                const response = await fetch(moduleName);
                buffer = await response.arrayBuffer();
            } else {
                buffer = node_helpers.fs.readFileSync(moduleName, null);
            }
            module = await WebAssembly.compile(buffer);
        }

        let instance = null;
        try {
            instance = await WebAssembly.instantiate(module, moduleImports);
        } catch (e) {
            worker_console_log("exception while instantiating wasm");
            worker_console_log(e.stack);
            instance = null;
        }

        if (instance != null) {
            wasiPolyfill.setModuleInstance(instance);
            try {
                instance.exports._start();
                do_exit(0);
            } catch (e) {
                worker_console_log("exception while running wasm");
                worker_console_log(e.stack);
                do_exit(255);
            }
        } else {
            do_exit(255);
        }
    })();
}

function start_wasm() {
    if (started && fname != "") {
        worker_console_log("Loading " + fname);
        try {
            if (is_node()) { // TODO: add spawn for browser!
                if (!node_helpers.fs.existsSync(fname)) {
                    worker_console_log(`File ${fname} not found!`);
                    started = false;
                    fname = "";
                    setTimeout(start_wasm, 500);
                    return;
                }
            }
        } catch {
        }
        const wasiPolyfill = barebonesWASI();
        importWasmModule(fname, wasiPolyfill);
        // FIXME: returns done even if it failed
        worker_console_log("done.");
    } else {
        setTimeout(function () {
            start_wasm();
        }, 500);
    }
}

setTimeout(start_wasm, 500);
