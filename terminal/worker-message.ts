import * as constants from "./constants.js";
import { OpenDirectory } from "./filesystem.js";

export const on_worker_message = async (event, workerTable) => {
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
                const [command, args, env, sbuf] = data;
                const parent_lck = new Int32Array(sbuf, 0, 1);
                if (command === "mount") {
                    // special case for mount command
                    const mount = await showDirectoryPicker();
                    workerTable.workerInfos[worker_id].fds.push(new OpenDirectory(args[1], mount));
                    // release worker straight away
                    Atomics.store(parent_lck, 0, 0);
                    Atomics.notify(parent_lck, 0);
                } else {
                    const id = workerTable.spawnWorker(
                        worker_id,
                        parent_lck,
                        on_worker_message
                    );
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
                if (fds[fd] != undefined) {
                    preopen_type[0] = fds[fd].file_type;
                    name_len[0] = fds[fd].path.length;
                    console.log(`filte_type: ${preopen_type[0]}, name_len: ${name_len[0]}`);
                    err = constants.WASI_ESUCCESS;
                } else {
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
                if (fds[fd] != undefined) {
                    path.set(new TextEncoder().encode(fds[fd].path), 0);
                    console.log(`path: ${fds[fd].path}`);
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
                    }
                    case 1: {
                        const output = content.replaceAll("\n", "\r\n");
                        workerTable.receive_callback(worker_id, output);
                        break;
                    }
                    case 2: {
                        const output = content.replaceAll("\n", "\r\n");
                        // TODO: should print in red, use ANSI color codes
                        // terminal.io.print(`${'\\033[01;32m'}${output}${'\\033[00m'}`);
                        workerTable.receive_callback(worker_id, output);
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
                        if (workerTable.send_callback(len, lck, readlen, readbuf) == 0) {
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
                            let data;
                            [data, err] = await fds[fd].read(len);
                            if (err === 0) {
                                readbuf.set(data);
                                readlen[0] = data.byteLength;
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
                const lck = new Int32Array(sbuf, 0, 1);
                const opened_fd = new Int32Array(sbuf, 4, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[dir_fd] != undefined) { // && fds[dir_fd].directory != undefined) { 
                    const create = (oflags & constants.WASI_O_CREAT) === constants.WASI_O_CREAT;
                    let entry = await fds[dir_fd].get_entry_for_path(path);
                    if (entry == null) {
                        if ((oflags & constants.WASI_O_CREAT) === constants.WASI_O_CREAT) {
                            entry = await fds[dir_fd].create_entry_for_path(path);
                            if (entry == null) {
                                err = constants.WASI_ENOENT;
                            }
                        } else {
                            err = constants.WASI_ENOENT;
                        }
                    } else if ((oflags & constants.WASI_O_EXCL) === constants.WASI_O_EXCL) {
                        console.log("file already exists, return 1");
                        // return constants.WASI_EEXIST;
                    }
                    if ((oflags & constants.WASI_O_DIRECTORY) === constants.WASI_O_DIRECTORY && fds[dir_fd].file_type !== constants.WASI_FILETYPE_DIRECTORY) {
                        console.log("oflags & OFLAGS_DIRECTORY === OFLAGS_DIRECTORY && fds[dir_fd].file_type !== FILETYPE_DIRECTORY")
                        err = 1;
                    }
                    if ((oflags & constants.WASI_O_TRUNC) === constants.WASI_O_TRUNC) {
                        // TODO: seems to trigger on each path_open 
                        if (entry != null) entry.truncate();
                    }

                    if (entry != null) {
                        fds.push(entry);
                        opened_fd[0] = fds.length - 1;
                        err = constants.WASI_ESUCCESS;
                    }
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
                    let stat = await fds[fd].stat();
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
            case "path_filestat_get": {
                const [sbuf, fd, path, flags] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const buf = new DataView(sbuf, 4);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) {
                    let entry = await fds[fd].get_entry_for_path(path);
                    if (entry == null) {
                        err = constants.WASI_EINVAL;
                    } else {
                        let stat = await entry.stat();
                        buf.setBigUint64(0, stat.dev, true);
                        buf.setBigUint64(8, stat.ino, true);
                        buf.setUint8(16, stat.file_type);
                        buf.setBigUint64(24, stat.nlink, true);
                        buf.setBigUint64(32, stat.size, true);
                        buf.setBigUint64(38, stat.atim, true);
                        buf.setBigUint64(46, stat.mtim, true);
                        buf.setBigUint64(52, stat.ctim, true);
                        err = constants.WASI_ESUCCESS;
                    }
                } else {
                    console.log(`path_filestat_get: undefined`);
                    err = constants.WASI_EINVAL;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
            case "fd_seek": {
                const [sbuf, fd, offset, whence] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const file_pos = new BigUint64Array(sbuf, 8, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) {
                    // we get offset as BigInt, but FSA API requires Number
                    fds[fd].seek(Number(offset), whence);
                    err = constants.WASI_ESUCCESS;
                } else {
                    console.log(`fd_seek: bad fd: ${fd}`);
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
            case "fd_readdir": {
                const [sbuf, fd, cookie, databuf_len] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const buf_used = new Uint32Array(sbuf, 4, 1);
                const databuf = new DataView(sbuf, 8, databuf_len);
                let databuf_ptr = 0;

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) {
                    const entries = await fds[fd].entries();
                    for (let i = Number(cookie); i < entries.length; i++) {
                        const entry = entries[i];
                        const namebuf = new TextEncoder().encode(entry.path);
                        if (databuf_ptr > databuf_len) break;


                        databuf.setBigUint64(databuf_ptr, BigInt(i + 1), true);
                        databuf_ptr += 8;
                        if (databuf_ptr >= databuf_len) break;

                        // TODO: get file stats ino (dummy 0n for now)
                        databuf.setBigUint64(databuf_ptr, 0n, true);
                        databuf_ptr += 8;
                        // directory can have more entries that the buffor can store
                        // in such case we return only partial results 
                        if (databuf_ptr >= databuf_len) break;
                        
                        databuf.setUint32(databuf_ptr, namebuf.byteLength, true);
                        databuf_ptr += 4;
                        if (databuf_ptr >= databuf_len) break;

                        const file_type = entry.file_type;
                        databuf.setUint8(databuf_ptr, file_type);
                        databuf_ptr += 4; // uint8 + padding
                        if (databuf_ptr >= databuf_len) break;

                        // check if name will fit
                        if (databuf_ptr + namebuf.byteLength >= databuf_len) break;
                        const databuf8 = new Uint8Array(sbuf, 8);
                        databuf8.set(namebuf, databuf_ptr);
                        databuf_ptr += namebuf.byteLength;
                        if (databuf_ptr >= databuf_len) break;
                    }
                    buf_used[0] = databuf_ptr > databuf_len ? databuf_len : databuf_ptr;
                    err = constants.WASI_ESUCCESS;
                } else {
                    console.log(`fd_readdir: bad fd: ${fd}`);
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
        }
}

