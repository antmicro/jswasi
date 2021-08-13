import {hterm, lib} from "./hterm-all.js";
import * as constants from "./constants.js";
import {WorkerTable} from "./worker-table.js";
import {PreopenDirectory, PreopenFile, File, OpenFile, OpenDirectory} from "./filesystem.js";

let buffer = "";

function send_buffer_to_worker(requested_len: number, lck: Int32Array, readlen: Int32Array, buf: Uint8Array) {
    // console.log("got buffer request of len " + requested_len + ", notifying");
    readlen[0] = (buffer.length > requested_len) ? requested_len : buffer.length;
    // console.log("current buffer is '" + buffer + "', copying len " + readlen[0]);
    for (let j = 0; j < readlen[0]; j++) {
        buf[j] = buffer.charCodeAt(j);
    }
    buffer = buffer.slice(readlen[0]);
    Atomics.store(lck, 0, constants.WASI_ESUCCESS);
    Atomics.notify(lck, 0);
}

async function init_all() {
    // If you are a cross-browser web app and want to use window.localStorage.
    hterm.defaultStorage = new lib.Storage.Local();

    // setup filesystem
    const root = await navigator.storage.getDirectory();
    // const home = await root.getDirectoryHandle("home", {create: true});
    // const ant = await home.getDirectoryHandle("ant", {create: true});
    const shell_history = await root.getFileHandle(".shell_history", {create: true});
    const w = await shell_history.createWritable();
    await w.write("abc");
    await w.close();

    let workerTable = new WorkerTable;


    const setupHterm = () => {
        const t = new hterm.Terminal("profile-id");

        t.onTerminalReady = function () {
            const io = t.io.push();

            io.onVTKeystroke = io.sendString = (data) => {
                let code = data.charCodeAt(0);
                console.log(data, code);

                if (code === 13) {
                    code = 10;
                    data = String.fromCharCode(10);
                }

                if (code !== 10 && code < 32) {
                    // control characters
                    if (code == 3) {
                        console.log(`got ^C control, killing current worker (${workerTable.currentWorker})`);
                        workerTable.terminateWorker(workerTable.currentWorker);
                    } else if (code == 4) {
                        console.log(`got ^D, releasing buffer read lock (if present) with value -1`);
                        workerTable.releaseWorker(workerTable.currentWorker, -1);
                    }
                } else {
                    // regular characters
                    buffer = buffer + data;

                    // echo
                    t.io.print(code === 10 ? "\r\n" : data);

                    // each worker has a buffer request queue to store fd_reads on stdin that couldn't be handled straight away
                    // now that buffer was filled, look if there are pending buffer requests from current foreground worker
                    while (workerTable.workerInfos[workerTable.currentWorker].buffer_request_queue.length !== 0 && buffer.length !== 0) {
                        let {
                            requested_len,
                            lck,
                            len,
                            sbuf
                        } = workerTable.workerInfos[workerTable.currentWorker].buffer_request_queue.shift();
                        send_buffer_to_worker(requested_len, lck, len, sbuf);
                    }
                }
            };

            io.onTerminalResize = (columns, rows) => {
            };

        };

        t.decorate(document.querySelector('#terminal'));
        t.installKeyboard();

        return t;
    }

    // This will be whatever normal entry/initialization point your project uses.
    await lib.init();
    const terminal = setupHterm();

    workerTable.spawnWorker(
        [
            null, // stdin
            null, // stdout
            null, // stderr
            // new PreopenDirectory(".", {
            //     "hello.rs": new File(new TextEncoder().encode(`fn main() { println!("Hello World!"); }`)),
            // }), // 3
            // new PreopenDirectory("/tmp", {"test.txt": new File(new TextEncoder().encode("test string content"))}), // 4
            new OpenDirectory("/", root),
        ],
        null, // parent_id
        null // parent_lock
    );

    const on_worker_message = async (event) => {
        const [worker_id, action, data] = event.data;
        switch (action) {
            case "console": {
                console.log("WORKER " + worker_id + ": " + data);
                break;
            }
            case "exit": {
                workerTable.terminateWorker(worker_id);
                console.log(`WORKER ${worker_id} exited with result code: ${data}`);
                break;
            }
            case "spawn": {
                console.log("got spawn");
                const [command, args, env, sbuf] = data;
                const parent_lck = new Int32Array(sbuf, 0, 1);
                if (command === "mount") {
                    // special case for mount command
                    const mount = await showDirectoryPicker();
                    workerTable.workerInfos[worker_id].fds.push(new OpenDirectory(args[0], mount);
                    // release worker straight away
                    Atomics.store(parent_lck, 0, 0);
                    Atomics.notify(parent_lck, 0);
                } else {
                    const id = workerTable.spawnWorker(
                        [
                            null, // stdin
                            null, // stdout
                            null, // stderr
                            // new PreopenDirectory(".", {
                            //     "hello.rs": new File(new TextEncoder().encode(`fn main() { println!("Hello World!"); }`)),
                            // }), // 3
                            // new PreopenDirectory("/tmp", {"test.txt": new File(new TextEncoder().encode("test string content"))}), // 4
                            new OpenDirectory("/", root),
                        ],
                        worker_id,
                        parent_lck
                    );
                    workerTable.setOnMessage(id, on_worker_message);
                    workerTable.postMessage(id, ["start", `${command}.wasm`, id, args, env]);
                    console.log("WORKER " + worker_id + " spawned: " + command);
                }
                break;
            }
            case "fd_prestat_get": {
                const [sbuf, fd] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const name_len = new Int32Array(sbuf, 4, 1);
                const preopen_type = new Uint8Array(sbuf, 8, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) { // && fds[fd].prestat_name != undefined) {
                    preopen_type[0] = fds[fd].file_type;
                    name_len[0] = fds[fd].path.length;
                    err = constants.WASI_ESUCCESS;
                } else {
                    // FIXME: this fails for created files (when fds[fd] is undefined)
                    //  what should happen when requesting with not used fd?
                    //  for now we get error: 'data provided contains a nul byte' on File::create
                    console.log("fd_prestat_get returning EBADF");
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);

                break;
            }
            case "fd_prestat_dir_name": {
                const [sbuf, fd, path_len] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const path = new Uint8Array(sbuf, 4, path_len);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) { // && fds[fd].prestat_name != undefined) {
                    path.set(fds[fd].path, 0);
                    err = constants.WASI_ESUCCESS;
                } else {
                    console.log("fd_prestat_dir_name returning EBADF");
                    err = constants.WASI_EBADF; // TODO: what return code?
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);

                break;
            }
            case "fd_write": {
        		const [sbuf, fd, content] = data;
                const lck = new Int32Array(sbuf, 0, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                switch (fd) {
                    case 0: {
                        throw "can't write to stdin!";
                        break;
                    }
                    case 1: {
                        const output = content.replaceAll("\n", "\r\n");
                        terminal.io.print(output);
                        break;
                    }
                    case 2: {
                        const output = content.replaceAll("\n", "\r\n");
                        // TODO: should print in red, use ANSI color codes
                        // terminal.io.print(`${'\\033[01;32m'}${output}${'\\033[00m'}`);
                        terminal.io.print(output);
                        break;
                    }
                    default: {
                        if (fds[fd] != undefined) {
                            fds[fd].write(content);
                            err = constants.WASI_ESUCCESS;
                        } else {
                            console.log("fd_prestat_dir_name returning EBADF");
                            err = constants.WASI_EBADF; // TODO: what return code?
                        }
                        break;
                    }
                }
                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }    
            case "fd_read": {
                const [sbuf, fd, len] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const readlen = new Int32Array(sbuf, 4, 1);
                const readbuf = new Uint8Array(sbuf, 8, len);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                switch (fd) {
                    case 0: {
                        if (buffer.length !== 0) {
                            // handle buffer request straight away
                            send_buffer_to_worker(len, lck, readlen, readbuf);
                        } else {
                            // push handle buffer request to queue
                            workerTable.workerInfos[worker_id].buffer_request_queue.push({requested_len: len, lck: lck, len: readlen, sbuf: readbuf});
                        }
                        break;
                    }
                    case 1: {
                        throw "can't read from stdout!";
                        break;
                    }
                    case 2: {
                        throw "can't read from stderr!";
                        break;
                    }
                    default: {
                        if (fds[fd] != undefined) {
                            console.log(fds);
                            let data;
                            [data, err] = fds[fd].read(len);
                            console.log(`read len=${len} from file: ` + new TextDecoder().decode(data));
                            if (err === 0) {
                                readbuf.set(data);
                                readlen[0] = data.byteLength;
                                // console.log(`sent to wasm: ` + new TextDecoder().decode(readbuf));
                            }
                        } else {
                            console.log("fd_prestat_dir_name returning EBADF");
                            err = constants.WASI_EBADF; // TODO: what return code?
                        }
                        Atomics.store(lck, 0, err);
                        Atomics.notify(lck, 0);
                        break;
                    }
                }
                break;
            }
            case "path_open": {
                const [sbuf, dir_fd, path, dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags] = data;
                console.log(path);
                const lck = new Int32Array(sbuf, 0, 1);
                const opened_fd = new Int32Array(sbuf, 4, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[dir_fd] != undefined) { // && fds[dir_fd].directory != undefined) {
                    let entry = fds[dir_fd].open_entry(path, create);
                    if (entry == null) {
                        if ((oflags & constants.WASI_O_CREAT) === constants.WASI_O_CREAT) {
                            entry = fds[dir_fd].create_entry_for_path(path);
                        } else {
                            err = constants.WASI_EBADF;
                        }
                    } else if ((oflags & constants.WASI_O_EXCL) === constants.WASI_O_EXCL) {
                        // FIXME: this flag is set on fs::write and it fails, but doesnt on linux
                        // console.log("file already exists, return 1");
                        // return constants.WASI_EEXIST;
                    }
                    if ((oflags & constants.WASI_O_DIRECTORY) === constants.WASI_O_DIRECTORY && fds[dir_fd].file_type !== constants.WASI_FILETYPE_DIRECTORY) {
                        console.log("oflags & OFLAGS_DIRECTORY === OFLAGS_DIRECTORY && fds[dir_fd].file_type !== FILETYPE_DIRECTORY")
                        err = 1;
                    }
                    if ((oflags & constants.WASI_O_TRUNC) === constants.WASI_O_TRUNC) {
                        // TODO: seems to trigger on each path_open 
                        console.log("entry.truncate()");
                        entry.truncate();
                    }
                    fds.push(entry.open(path));
                    opened_fd[0] = fds.length - 1;
                    err = constants.WASI_ESUCCESS;
                } else {
                    console.log("fd doesn't exist or is a directory");
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
            case "fd_close": {
                const [sbuf, fd] = data;
                const lck = new Int32Array(sbuf, 0, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] !== undefined) {
                    fds[fd] = undefined;
                    err = constants.WASI_ESUCCESS;
                } else {
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
            case "fd_filestat_get" : {
                const [sbuf, fd] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const buf = new DataView(sbuf, 4);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fd > 2 && fds[fd] != undefined) {
                    let stat = fds[fd].stat();
                    buf.setBigUint64(0, stat.dev, true);
                    buf.setBigUint64(8, stat.ino, true);
                    buf.setUint8(16, stat.file_type);
                    buf.setBigUint64(24, stat.nlink, true);
                    buf.setBigUint64(32, stat.size, true);
                    buf.setBigUint64(38, stat.atim, true);
                    buf.setBigUint64(46, stat.mtim, true);
                    buf.setBigUint64(52, stat.ctim, true);
                    err = constants.WASI_ESUCCESS;
                } else {
                    console.log(`fd_filestat_get returning WASI_EBADF`);
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
        }
    }

    workerTable.setOnMessage(0, on_worker_message);
    workerTable.postMessage(0, ["start", "shell.wasm", 0, [], {
        RUST_BACKTRACE: "full",
        PATH: "/usr/bin:/usr/local/bin",
        PWD: "/",
    }]);
}

window.onload = init_all;
