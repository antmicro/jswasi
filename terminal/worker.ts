// credits
// WebAssembly Tutor (https://www.wasmtutor.com/webassembly-barebones-wasi)
// bjorn3 (https://github.com/bjorn3/rust/blob/compile_rustc_wasm4/rustc.html)

let started = false;
let fname = "";
let myself = null;
let fs = null;
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
this.onmessage = onmessage_;

function get_parent_port() {
    if (is_node) {
        const {parentPort} = require('worker_threads');
        return parentPort;
    }
    return null;
}

let is_node = (typeof self === 'undefined');

if (is_node) {
    get_parent_port().once('message', (message) => {
        let msg = {data: message};
        onmessage_(msg);
    });
    fs = require('fs');
} else {
    worker_console_log("Running in a browser!");
}

function worker_send(msg) {
    if (is_node) {
        const msg_ = {data: [myself, msg[0], msg[1]]};
        get_parent_port().postMessage(msg_);
    } else {
        const msg_ = [myself, ...msg];
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
        worker_console_log("calling close()");
        worker_send(["exit", exit_code]);
        close();
    }
}

function barebonesWASI() {

    let BUFFER = "";
    let moduleInstanceExports = null;

    const WASI_ESUCCESS = 0;
    const WASI_EBADF = 8;
    const WASI_EEXIST = 20;
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

    const WHENCE_SET = 0;
    const WHENCE_CUR = 1;
    const WHENCE_END = 2;

    function setModuleInstance(instance) {
        moduleInstanceExports = instance.exports;
    }

    function getModuleMemoryDataView() {
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
            return this.data.byteLength;
        }

        open() {
            return new OpenFile(this);
        }

        stat() {
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
            this.data = new Uint8Array([]);
        }
    }

    class OpenFile {
        file_type = FILETYPE_REGULAR_FILE;
        file;
        file_pos = 0;

        constructor(file) {
            this.file = file;
        }

        get size() {
            return this.file.size;
        }

        read(len) {
            worker_console_log(`${typeof this.file_pos}, ${typeof len}`)
            if (this.file_pos < this.file.data.byteLength) {
                let slice = this.file.data.slice(this.file_pos, this.file_pos + len);
                this.file_pos += slice.length;
                return [slice, 0];
            } else {
                return [[], 0];
            }
        }

        write(buffer) {
            // File.data is and Uint8Array, we need to resize it if necessary
            if (this.file_pos + buffer.length > this.size) {
                let old = this.file.data;
                this.file.data = new Uint8Array(this.file_pos + buffer.length);
                this.file.data.set(old);
            }
            this.file.data.set(
                new TextEncoder().encode(buffer), this.file_pos
            );
            this.file_pos += buffer.length;
            return 0;
        }

        stat() {
            return this.file.stat();
        }
    }

    class Directory {
        file_type = FILETYPE_DIRECTORY;
        directory;

        constructor(contents) {
            this.directory = contents;
        }

        open(name) {
            return new PreopenDirectory(name, this.directory);
        }

        get_entry_for_path(path) {
            let entry = this;
            for (let component of path.split("/")) {
                if (component == "") break;
                if (entry.directory[component] != undefined) {
                    entry = entry.directory[component];
                } else {
                    return null;
                }
            }
            return entry;
        }

        create_entry_for_path(path) {
            let entry = this;
            let components = path.split("/").filter((component) => component != "/");
            for (let i = 0; i < components.length; i++) {
                let component = components[i];
                if (entry.directory[component] != undefined) {
                    entry = entry.directory[component];
                } else {
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
        prestat_name;

        constructor(name, contents) {
            super(contents);
            this.prestat_name = new TextEncoder().encode(name);
        }
    }

    class Stdin {
        read(len) {
            if (len === 0) return [new Uint8Array([]), 0];
            const buf = new SharedArrayBuffer((len * 2) + 8); // lock, len, data
            const lck = new Int32Array(buf, 0, 1);
            const request_len = new Int32Array(buf, 4, 1);
            request_len[0] = len;
            // send buffer read request to main thread
            // it can either be handled straight away or queued for later
            // either way we block with Atomics.wait untill buffer is filled
            worker_send(["buffer", buf]);
            Atomics.wait(lck, 0, 0);
            if (Atomics.load(lck, 0) === -1) {
                return [new Uint8Array, -1];
            }
            const sbuf = new Uint8Array(buf, 8, request_len[0]);
            BUFFER = BUFFER + String.fromCharCode.apply(null, new Uint8Array(sbuf));
            let data = BUFFER.slice(0, len).replace("\r", "\n");
            BUFFER = BUFFER.slice(len, BUFFER.length);
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
        new Stdin(), // 0
        new Stdout(), // 1
        new Stderr(), // 2
        new PreopenDirectory(".", {
            "hello.rs": new File(new TextEncoder().encode(`fn main() { println!("Hello World!"); }`)),
        }), // 3
        new PreopenDirectory("/tmp", {"test.txt": new File(new TextEncoder().encode("test string content"))}), // 4
    ];

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
        worker_console_log("args_get(" + argv + ", " + argv_buf + ")");

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

        let err = fds[fd].write(content);

        view.setUint32(nwritten_ptr, written, !0);

        return WASI_ESUCCESS;
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
        if (fds[fd] !== undefined) {
            fds[fd] = undefined;
            return WASI_ESUCCESS;
        }
        return WASI_EBADF;
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

        if (fd > 2 && fds[fd] != undefined) {
            let stat = fds[fd].stat();
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
            worker_console_log(`fd_filestat_get returning WASI_EBADF`);
            return WASI_EBADF;
        }
    }

    function fd_read(fd, iovs_ptr, iovs_len, nread_ptr) {
        worker_console_log("fd_read(" + fd + ", " + iovs_ptr + ", " + iovs_len + ", " + nread_ptr + ")");
        let view = getModuleMemoryDataView();
        let view8 = getModuleMemoryUint8Array();

        if (fds[fd] != undefined) {
            let nread = 0;
            for (let i = 0; i < iovs_len; i++) {
                let addr = view.getUint32(iovs_ptr + 8 * i, true);
                let len = view.getUint32(iovs_ptr + 8 * i + 4, true);
                let [data, err] = fds[fd].read(len);
                if (err !== 0) {
                    return err;
                }
                view8.set(data, addr);
                nread += data.length;
            }
            view.setUint32(nread_ptr, nread, true);
            return WASI_ESUCCESS;
        } else {
            worker_console_log("fd_read returning 1");
            return 1;
        }
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
                case WHENCE_SET: {
                    file.file_pos = offset;
                    break;
                }
                case WHENCE_CUR: {
                    file.file_pos += offset;
                    break;
                }
                case WHENCE_END: {
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
        let buffer = getModuleMemoryDataView();
        let buffer8 = getModuleMemoryUint8Array();
        let path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        if (path[0] == '!') {
            worker_console_log("We are going to send a spawn message!");
            let [command, ...args] = path.split(" ");
            command = command.slice(1);
            const buf = new SharedArrayBuffer(4);
            const lck = new Int32Array(buf, 0, 1);
            worker_send(["spawn", command, args, ENV, buf]);
            worker_console_log("sent." + buf);

            // wait for child process to finish
            Atomics.wait(lck, 0, 0);

            return WASI_EBADF; // TODO, WASI_ESUCCESS throws runtime error in WASM so this is a bit better for now
        } else if (fds[dir_fd] != undefined && fds[dir_fd].directory != undefined && path_len != 0) {
            let entry = fds[dir_fd].get_entry_for_path(path);
            if (entry == null) {
                if ((oflags & OFLAGS_CREAT) === OFLAGS_CREAT) {
                    entry = fds[dir_fd].create_entry_for_path(path);
                } else {
                    return WASI_EBADF;
                }
            } else if ((oflags & OFLAGS_EXCL) === OFLAGS_EXCL) {
                // FIXME: this flag is set on fs::write and it fails, but doesnt on linux
                // worker_console_log("file already exists, return 1");
                // return WASI_EEXIST;
            }
            if ((oflags & OFLAGS_DIRECTORY) === OFLAGS_DIRECTORY && fds[dir_fd].file_type !== FILETYPE_DIRECTORY) {
                worker_console_log("oflags & OFLAGS_DIRECTORY === OFLAGS_DIRECTORY && fds[dir_fd].file_type !== FILETYPE_DIRECTORY")
                return 1;
            }
            if ((oflags & OFLAGS_TRUNC) === OFLAGS_TRUNC) {
                worker_console_log("entry.truncate()")
                entry.truncate();
            }
            fds.push(entry.open(path));
            let opened_fd = fds.length - 1;
            buffer.setUint32(opened_fd_ptr, opened_fd, true);
            return WASI_ESUCCESS;
        } else {
            worker_console_log("fd doesn't exist or is a directory");
            return WASI_EBADF;
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

    function fd_prestat_get(fd, buf_ptr) {
        worker_console_log(`fd_prestat_get(${fd}, 0x${buf_ptr.toString(16)})`);
        let view = getModuleMemoryDataView();
        if (fds[fd] != undefined && fds[fd].prestat_name != undefined) {
            const PREOPEN_TYPE_DIR = 0;
            view.setUint8(buf_ptr, PREOPEN_TYPE_DIR);
            view.setUint32(buf_ptr + 4, fds[fd].prestat_name.length);
            return WASI_ESUCCESS;
        } else {
            // FIXME: this fails for created files (when fds[fd] is undefined)
            //  what should happen when requesting with not used fd?
            //  for now we get error: 'data provided contains a nul byte' on File::create
            worker_console_log("fd_prestat_get returning EBADF");
            return WASI_EBADF;
        }
    }

    function fd_prestat_dir_name(fd, path_ptr, path_len) {
        worker_console_log(`fd_prestat_dir_name(${fd}, 0x${path_ptr.toString(16)}, ${path_len})`);
        if (fds[fd] != undefined && fds[fd].prestat_name != undefined) {
            let buffer8 = getModuleMemoryUint8Array();
            buffer8.set(fds[fd].prestat_name, path_ptr);
            return WASI_ESUCCESS;
        } else {
            worker_console_log("fd_prestat_dir_name returning EBADF");
            return WASI_EBADF; // TODO: what return code?
        }
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
            if (!is_node) {
                const response = await fetch(moduleName);
                buffer = await response.arrayBuffer();
            } else {
                buffer = fs.readFileSync(moduleName, null);
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
            if (is_node) { // TODO: add spawn for browser!
                if (!fs.existsSync(fname)) {
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
