// credits
// WebAssembly Tutor (https://www.wasmtutor.com/webassembly-barebones-wasi)
// bjorn3 (https://github.com/bjorn3/rust/blob/compile_rustc_wasm4/rustc.html)

let started = false;
let fname = "";
let myself = null;

onmessage = function (e) {
    if (!started) {
        if (e.data[0] === "start") {
          fname = e.data[1];
          myself = e.data[2];
          started = true;
        }
    }
}

function get_parent_port() {
    if (is_node) {
        const { parentPort } = require('worker_threads');
        return parentPort;
    }
    return null;
}

let is_node = (typeof self === 'undefined');

if (is_node) {
    get_parent_port().once('message', (message) => { let msg = { data: message }; onmessage(msg); });
} else {
    worker_console_log("Running in a browser!");
}

function worker_send(msg) {
    if (is_node) {
        msg_ = { data: [myself, msg[0], msg[1]] };
        const { parentPort } = require('worker_threads');
        get_parent_port().postMessage(msg_);
    } else {
        msg_ = [myself, msg[0], msg[1]];
        postMessage(msg_);
    }
}

function worker_console_log(msg) {
     worker_send(["console", msg]);
}


function do_exit(exit_code) {
    if (is_node) {
       const buf = new SharedArrayBuffer(4); // lock
       const lck = new Int32Array(buf, 0, 1);
       worker_send(["exit", exit_code]); // never return
       Atomics.wait(lck, 0, 0);
    } else {
       close();
    }
}

function barebonesWASI() {

    let moduleInstanceExports = null;

    const WASI_ESUCCESS = 0;
    const WASI_EBADF = 8;
    const WASI_EINVAL = 28;
    const WASI_ENOSYS = 52;

    const WASI_STDIN_FILENO = 0;
    const WASI_STDOUT_FILENO = 1;
    const WASI_STDERR_FILENO = 2;

    const FILETYPE_UNKNOWN = 0;
    const FILETYPE_DIRECTORY = 3;
    const FILETYPE_REGULAR_FILE = 4;

    const PREOPEN_TYPE_DIR = 0;

    const OFLAGS_CREAT = 0x1;
    const OFLAGS_DIRECTORY = 0x2;
    const OFLAGS_EXCL = 0x4;
    const OFLAGS_TRUNC = 0x8;

    let args = [];
    let env = [];

    function setModuleInstance(instance) {

        moduleInstanceExports = instance.exports;
    }

    function getModuleMemoryDataView() {
        // call this any time you'll be reading or writing to a module's memory
        // the returned DataView tends to be dissociated with the module's memory buffer at the will of the WebAssembly engine
        // cache the returned DataView at your own peril!!

        return new DataView(moduleInstanceExports.memory.buffer);
    }

    function getModuleMemoryUint8Array() {
        return new Uint8Array(moduleInstanceExports.memory.buffer);
    }

    class File {
        file_type = FILETYPE_REGULAR_FILE;
        data;

        constructor(data) {
            this.data = new Uint8Array(data);
        }

        get size() {
            worker_console_log("file size");
            return this.data.byteLength;
        }

        open() {
            worker_console_log("file open");
            return new OpenFile(this);
        }

        stat() {
            worker_console_log("file stat");
            return {
                dev: 0n,
                ino: 0n,
                file_type: this.file_type,
                nlink: 0n,
                size: BigInt(this.size),
                atim: 0n,
                mtim: 0n,
                ctim: 0n,
            };
        }

        truncate() {
            worker_console_log("file truncate");
            this.data = new Uint8Array([]);
        }
    }

    class OpenFile {
        file_type = FILETYPE_REGULAR_FILE;

        constructor(file) {
            this.file = file;
            this.file_pos = 0;
        }

        get size() {
            worker_console_log("open file size");
            return this.file.size;
        }

        read(len) {
            worker_console_log("open file read");
            if (this.file_pos < this.file.data.byteLength) {
                let slice = this.file.data.slice(this.file_pos, this.file_pos + len);
                this.file_pos += slice.length;
                return [slice, 0];
            } else {
                return [[], 0];
            }
        }

        write(buffer) {
            worker_console_log("open file write: "+ this.file.data + " " + this.file_pos + " " + buffer.byteLength);
            if (this.file_pos + buffer.byteLength > this.size) {
                let old = this.file.data;
                this.file.data = new Uint8Array(this.file_pos + buffer.byteLength);
                this.file.data.set(old);
            }
            this.file.data.set(
                buffer.slice(
                    0,
                    this.size - this.file_pos,
                ), this.file_pos
            );
            this.file_pos += buffer.byteLength;
            return 0;
        }

        stat() {
            worker_console_log("open file stat");
            return this.file.stat();
        }
    }

    class Directory {
        file_type = FILETYPE_DIRECTORY;

        constructor(contents) {
            this.directory = contents;
        }

        open() {
            worker_console_log("directory open");
            return this;
        }

        get_entry_for_path(path) {
            worker_console_log("directory get entry for path");
            let entry = this;
            for (let component of path.split("/")) {
                if (component == "") break;
                if (entry.directory[component] != undefined) {
                    entry = entry.directory[component];
                } else {
                    worker_console_log(component);
                    return null;
                }
            }
            return entry;
        }

        create_entry_for_path(path) {
            worker_console_log("directory create entry for path");
            let entry = this;
            let components = path.split("/").filter((component) => component != "/");
            for (let i in components) {
                let component = components[i];
                if (entry.directory[component] != undefined) {
                    entry = entry.directory[component];
                } else {
                    worker_console_log("create "+ component);
                    if (i == components.length - 1) {
                        entry.directory[component] = new File(new ArrayBuffer(0));
                    } else {
                        entry.directory[component] = new Directory({});
                    }
                    entry = entry.directory[component];
                }
            }
            return entry;
        }
    }

    class PreopenDirectory extends Directory {
        constructor(name, contents) {
            super(contents);
            this.prestat_name = new TextEncoder("utf-8").encode(name);
        }
    }

    let buffer = "";

    class Stdin {
        read(len) {
            worker_console_log("read is happening, requested len is " + len);
            if (len === 0) return ["", 0];
            worker_console_log("Waiting...");
            while (1) {
                const buf = new SharedArrayBuffer((len * 2) + 8); // lock, len, data
                const lck = new Int32Array(buf, 0, 1);
                const request_len = new Int32Array(buf, 4, 1);
                request_len[0] = len;
                worker_send(["buffer", buf]);
                Atomics.wait(lck, 0, 0);
                const sbuf = new Uint16Array(buf, 8, request_len[0]);
                buffer = buffer + String.fromCharCode.apply(null, new Uint16Array(sbuf));
                if (buffer.length > 0) worker_console_log("buffer len is now " + buffer.length + " and contents is '" + buffer + "'");
                if (buffer.length >= len) break;
            }
            worker_console_log("Out of Waiting...");
            let data = buffer.slice(0, len).replace("\r", "\n");
            buffer = buffer.slice(len, buffer.length);
            return [new TextEncoder().encode(data), 0];
        }
    }

    class Stdout {
        write(content) {
            worker_send(["stdout", content]);
            return WASI_ESUCCESS;
        }
    }

    class Stderr {
        write(content) {
            worker_send(["stderr", content]);
            return WASI_ESUCCESS;
        }
    }

    let fds = [
        new Stdin(),
        new Stdout(),
        new Stderr(),
        new PreopenDirectory("/tmp", {
            "test.txt": new File(new TextEncoder().encode('some test content')),
        }), // 3
        new PreopenDirectory(".", {
            "hello.rs": new File(new TextEncoder().encode(`fn main() { println!("Hello World!"); }`)),
        }), // 4
    ];

    function environ_sizes_get(environCount, environBufSize) {
        worker_console_log("environ_sizes_get");

        const view = getModuleMemoryDataView();

        view.setUint32(environCount, 0, !0);
        view.setUint32(environBufSize, 0, !0);

        return WASI_ESUCCESS;
    }

    function args_sizes_get(argc, argvBufSize) {
        worker_console_log("args_sizes_get");

        const view = getModuleMemoryDataView();

        view.setUint32(argc, 0, !0);
        view.setUint32(argvBufSize, 0, !0);

        return WASI_ESUCCESS;
    }

    function fd_fdstat_get(fd, bufPtr) {
        worker_console_log("fd_fdstat_get");

        const view = getModuleMemoryDataView();

        view.setUint8(bufPtr, fd);
        view.setUint16(bufPtr + 2, 0, !0);
        view.setUint16(bufPtr + 4, 0, !0);

        function setBigUint64(byteOffset, value, littleEndian) {

            const lowWord = value;
            const highWord = 0;

            view.setUint32(littleEndian ? 0 : 4, lowWord, littleEndian);
            view.setUint32(littleEndian ? 4 : 0, highWord, littleEndian);
        }

        setBigUint64(bufPtr + 8, 0, !0);
        setBigUint64(bufPtr + 8 + 8, 0, !0);

        return WASI_ESUCCESS;
    }

    function getiovs(view, iovs, iovsLen) {
        // iovs* -> [iov, iov, ...]
        // __wasi_ciovec_t {
        //   void* buf,
        //   size_t buf_len,
        // }
        return Array.from({length: iovsLen}, function (_, i) {
            const ptr = iovs + i * 8;
            const buf = view.getUint32(ptr, !0);
            const bufLen = view.getUint32(ptr + 4, !0);

            return new Uint8Array(moduleInstanceExports.memory.buffer, buf, bufLen);
        });
    }

    function fd_write(fd, iovs, iovsLen, nwritten) {
        worker_console_log((new Error()).stack.split("\n")[1].trim().split(" ")[1]);
        const view = getModuleMemoryDataView();

        let written = 0;
        const bufferBytes = [];

        const buffers = getiovs(view, iovs, iovsLen);

        function writev(iov) {

            for (var b = 0; b < iov.byteLength; b++) {

                bufferBytes.push(iov[b]);
            }

            written += b;
        }

        buffers.forEach(writev);

        const content = String.fromCharCode.apply(null, bufferBytes);

        if (fd === WASI_STDOUT_FILENO) {
            worker_send(["stdout", content]);
        } else if (fd === WASI_STDERR_FILENO) {
            worker_send(["stderr", content]);
        } else {
            let err = fds[fd].write(content);
            worker_console_log("err on write: " + err)
        }

        view.setUint32(nwritten, written, !0);

        return WASI_ESUCCESS;
    }

    function proc_exit(exit_code) {
        worker_console_log("proc_exit, shutting down, exit_code = "+exit_code);
        do_exit(exit_code); // never returns!
    }

    // function args_sizes_get(argc, argv_buf_size) {
    //     let buffer = new DataView(inst.exports.memory.buffer);
    //     worker_console_log("args_sizes_get(", argc, ", ", argv_buf_size, ")");
    //     buffer.setUint32(argc, args.length, true);
    //     let buf_size = 0;
    //     for (let arg of args) {
    //         buf_size += arg.length + 1;
    //     }
    //     buffer.setUint32(argv_buf_size, buf_size, true);
    //     worker_console_log(buffer.getUint32(argc, true), buffer.getUint32(argv_buf_size, true));
    //     return 0;
    // }

    function args_get(argv, argv_buf) {
        worker_console_log("args_get("+ argv+ ", "+ argv_buf+ ")");
        let buffer = getModuleMemoryDataView();
        let buffer8 = getModuleMemoryUint8Array();
        let orig_argv_buf = argv_buf;
        // TODO: args variable
        for (let i = 0; i < args.length; i++) {
            buffer.setUint32(argv, argv_buf, true);
            argv += 4;
            let arg = new TextEncoder("utf-8").encode(args[i]);
            buffer8.set(arg, argv_buf);
            buffer.setUint8(argv_buf + arg.length, 0);
            argv_buf += arg.length + 1;
        }
        worker_console_log(new TextDecoder("utf-8").decode(buffer8.slice(orig_argv_buf, argv_buf)));
        return 0;
    }

    // function environ_sizes_get(environ_count, environ_size) {
    //     let buffer = new DataView(inst.exports.memory.buffer);
    //     worker_console_log("environ_sizes_get(", environ_count, ", ", environ_size, ")");
    //     buffer.setUint32(environ_count, env.length, true);
    //     let buf_size = 0;
    //     for (let environ of env) {
    //         buf_size += environ.length + 1;
    //     }
    //     buffer.setUint32(environ_size, buf_size, true);
    //     worker_console_log(buffer.getUint32(environ_count, true), buffer.getUint32(environ_size, true));
    //     return 0;
    // }

    function environ_get(environ, environ_buf) {
        worker_console_log("environ_get("+ environ + ", "+ environ_buf+ ")");
        let buffer = getModuleMemoryDataView();
        let buffer8 = getModuleMemoryUint8Array();
        let orig_environ_buf = environ_buf;
        // TODO: env
        for (let i = 0; i < env.length; i++) {
            buffer.setUint32(environ, environ_buf, true);
            environ += 4;
            let e = new TextEncoder().encode(env[i]);
            buffer8.set(e, environ_buf);
            buffer.setUint8(environ_buf + e.length, 0);
            environ_buf += e.length + 1;
        }
        return 0;
    }

    function clock_time_get(id, precision, time) {
        worker_console_log("clock_time_get("+ id+ ", "+ precision+ ", "+ time+ ")");
        let buffer = getModuleMemoryDataView()
        buffer.setBigUint64(time, 0n, true);
        return 0;
    }

    function fd_filestat_get(fd, buf) {
        worker_console_log("fd_filestat_get("+ fd+ ", "+ buf+ ")");
        let buffer = getModuleMemoryDataView();
        if (fds[fd] != undefined) {
            let stat = fds[fd].stat();
            buffer.setBigUint64(buf, stat.dev, true);
            buffer.setBigUint64(buf + 8, stat.ino, true);
            buffer.setUint8(buf + 16, stat.file_type);
            buffer.setBigUint64(buf + 24, stat.nlink, true);
            buffer.setBigUint64(buf + 32, stat.size, true);
            buffer.setBigUint64(buf + 38, stat.atim, true);
            buffer.setBigUint64(buf + 46, stat.mtim, true);
            buffer.setBigUint64(buf + 52, stat.ctim, true);
            return 0;
        } else {
            return 1;
        }
    }

    function fd_read(fd, iovs_ptr, iovs_len, nread_ptr) {
        worker_console_log("fd_read("+ fd+ ", "+ iovs_ptr+ ", "+ iovs_len+ ", "+ nread_ptr+ ")");
        let buffer = getModuleMemoryDataView();
        let buffer8 = getModuleMemoryUint8Array();
        if (fds[fd] != undefined) {
            let nread = 0;
            for (let i = 0; i < iovs_len; i++) {
                let addr = buffer.getUint32(iovs_ptr + 8 * i, true);
                let len = buffer.getUint32(iovs_ptr + 8 * i + 4, true);
                if ((i+1) === iovs_len && len === 1024) len = 1;
                if ((i+1) === iovs_len && len === 8192) len = 1;
                let [data, err] = fds[fd].read(len);
                if (err !== 0) {
                    return err;
                }
                buffer8.set(data, addr);
                nread += data.length;
            }
            buffer.setUint32(nread_ptr, buffer.getUint32(nread_ptr, true) + nread, true);
            return WASI_ESUCCESS;
        } else {
            return 1;
        }
    }

    function fd_readdir(fd, buf, buf_len, cookie, bufused) {
        worker_console_log("fd_readdir(", fd, ", ", buf, ", ", buf_len, ", ", cookie, ", ", bufused, ")");
        let buffer = getModuleMemoryDataView();
        let buffer8 = getModuleMemoryUint8Array();
        // 8 ,  3408816 ,  128 ,  0n ,  1032332
        if (fds[fd] != undefined && fds[fd].directory != undefined) {
            buffer.setUint32(bufused, 0, true);

            worker_console_log(cookie +" "+ Object.keys(fds[fd].directory).slice(Number(cookie)));
            if (cookie >= BigInt(Object.keys(fds[fd].directory).length)) {
                worker_console_log("end of dir");
                return 0;
            }
            let next_cookie = cookie + 1n;
            for (let name of Object.keys(fds[fd].directory).slice(Number(cookie))) {
                let entry = fds[fd].directory[name];
                worker_console_log(name + " "+ entry);
                let encoded_name = new TextEncoder("utf-8").encode(name);

                let offset = 24 + encoded_name.length;

                if ((buf_len - buffer.getUint32(bufused, true)) < offset) {
                    worker_console_log("too small buf");
                    break;
                } else {
                    worker_console_log("next_cookie = "+ next_cookie + " " + buf);
                    buffer.setBigUint64(buf, next_cookie, true);
                    next_cookie += 1n;
                    buffer.setBigUint64(buf + 8, 1n, true); // inode
                    buffer.setUint32(buf + 16, encoded_name.length, true);
                    buffer.setUint8(buf + 20, entry.file_type);
                    buffer8.set(encoded_name, buf + 24);
                    worker_console_log("buffer = "+ buffer8.slice(buf, buf + offset));
                    buf += offset;
                    buffer.setUint32(bufused, buffer.getUint32(bufused, true) + offset, true);
                }
            }
            worker_console_log("used ="+ buffer.getUint32(bufused, true));
            return 0;
        } else {
            return 1;
        }
    }

    function fd_seek() {
        worker_console_log("fd_seek");
    }

    function path_create_directory() {
        worker_console_log("path_create_directory");
    }

    function path_filestat_get(fd, flags, path_ptr, path_len, buf) {
        console.log("path_filestat_get(", fd, ", ", flags, ", ", path_ptr, ", ", path_len, ", ", buf, ")");

        let buffer8 = getModuleMemoryUint8Array();
        if (fds[fd] != undefined && fds[fd].directory != undefined) {
            let path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
            worker_console_log("file = "+ path);
            let entry = fds[fd].get_entry_for_path(path);
            if (entry == null) {
                return 1;
            }
            // FIXME write filestat_t
            return 0;
        } else {
            return 1;
        }
    }

    function path_open(fd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fdflags, opened_fd_ptr) {
        worker_console_log("path_open("+ dirflags+ ", "+ path_ptr+ ", "+ path_len+ ", "+ oflags, " + "+ fs_rights_base + ", " + fs_rights_inheriting + ", " + fdflags + ", " + opened_fd_ptr + ")");
        let buffer = getModuleMemoryDataView();
        let buffer8 = getModuleMemoryUint8Array();
        if (fds[fd] != undefined && fds[fd].directory != undefined) {
            let path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
            worker_console_log(path);
            let entry = fds[fd].get_entry_for_path(path);
            if (entry == null) {
                if (oflags & OFLAGS_CREAT == OFLAGS_CREAT) {
                    entry = fds[fd].create_entry_for_path(path);
                } else {
                    return 1;
                }
            } else if (oflags & OFLAGS_EXCL == OFLAGS_EXCL) {
                return 1;
            }
            if (oflags & OFLAGS_DIRECTORY == OFLAGS_DIRECTORY && fds[fd].file_type != FILETYPE_DIRECTORY) {
                return 1;
            }
            if (oflags & OFLAGS_TRUNC == OFLAGS_TRUNC) {
                entry.truncate();
            }
            fds.push(entry.open());
            let opened_fd = fds.length - 1;
            buffer.setUint32(opened_fd_ptr, opened_fd, true);
        } else {
            return 1;
        }
    }

    function fd_prestat_get(fd, buf_ptr) {
        worker_console_log("fd_prestat_get("+ fd+ ", "+ buf_ptr+ ")");
        let buffer = getModuleMemoryDataView();
        // FIXME: this fails for created files, fds[fd] is undefined
        //  what should happen when requesting with not used fd?
        if (fds[fd] != undefined && fds[fd].prestat_name != undefined) {
            worker_console_log("fd_prestat_get inner");
            const PREOPEN_TYPE_DIR = 0;
            buffer.setUint32(buf_ptr, PREOPEN_TYPE_DIR, true);
            buffer.setUint32(buf_ptr + 4, fds[fd].prestat_name.length);
            return WASI_ESUCCESS;
        } else {
            worker_console_log("fd_prestat_get returning EBADF");
            return WASI_EBADF;
        }

    }

    function fd_prestat_dir_name(fd, path_ptr, path_len) {
        worker_console_log("fd_prestat_dir_name("+ fd+ ", "+ path_ptr+ ", "+ path_len+ ")");
        if (fds[fd] != undefined && fds[fd].prestat_name != undefined) {
            worker_console_log("fd_prestat_dir_name inner");
            let buffer8 = getModuleMemoryUint8Array();
            buffer8.set(fds[fd].prestat_name, path_ptr);
            return WASI_ESUCCESS;
        } else {
            return 1;
        }
    }
  
    let placeholder = function() {
        worker_console_log("> Entering stub " + (new Error()).stack.split("\n")[2].trim().split(" ")[1]); return WASI_ESUCCESS;
    };

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
            if (!is_node) {
                const response = await fetch(moduleName);
                buffer = await response.arrayBuffer();
	    } else {
		const fs = require('fs');
		buffer = fs.readFileSync(moduleName, null);
            }
            module = await WebAssembly.compile(buffer);
        }

        let instance = null;
        try {
            instance = await WebAssembly.instantiate(module, moduleImports);
        } catch(e) {
            worker_console_log("exception while instantiating wasm");
            worker_console_log(e.stack);
            instance = null;
        }

        if (instance != null) {
            wasiPolyfill.setModuleInstance(instance);
            try {
                instance.exports._start();
                do_exit(0);
            } catch(e) {
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
        const wasiPolyfill = barebonesWASI();
        importWasmModule(fname, wasiPolyfill);
        worker_console_log("done.");
    } else {
        setTimeout(function () {
            start_wasm();
        }, 500);
    }
}

setTimeout(function () {
    start_wasm();
}, 500);
