import * as constants from "./constants.js";
import { FileOrDir, OpenFlags } from "./filesystem.js";
import { OpenDirectory } from "./browser-fs.js";
import { mount, wget } from "./browser-shell.js";

export const on_worker_message = async (event, workerTable) => {
        const [worker_id, action, data] = event.data;
        const fds = workerTable.workerInfos[worker_id].fds;
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
                switch(command) {
                    case "mount": {
                        await mount(workerTable, worker_id, args, env);
                        Atomics.store(parent_lck, 0, 0);
                        Atomics.notify(parent_lck, 0);
                        break;
                    } 
                    case "wget": {
                        await wget(workerTable, worker_id, args, env);
                        Atomics.store(parent_lck, 0, 0);
                        Atomics.notify(parent_lck, 0);
                        break;
                    }
                    default: {
                        const id = workerTable.spawnWorker(
                            worker_id,
                            parent_lck,
                            on_worker_message
                        );
                        workerTable.postMessage(id, ["start", `${command}.wasm`, id, args, env]);
                    }
                }
                break;
            }
            case "fd_prestat_get": {
                const [sbuf, fd] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const name_len = new Int32Array(sbuf, 4, 1);
                const preopen_type = new Uint8Array(sbuf, 8, 1);

                let err;
                if (fds[fd] != undefined) {
                    preopen_type[0] = fds[fd].file_type;
                    name_len[0] = fds[fd].path.length;
                    err = constants.WASI_ESUCCESS;
                } else {
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
                if (fds[fd] != undefined) {
                    // FIXME: this shouldn't work, but it fixes the 'uutils cat', find out why and document it
                    // path.set(new TextEncoder().encode(fds[fd].path), 0);
                    path.set(fds[fd].path, 0);
                    err = constants.WASI_ESUCCESS;
                } else {
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);

                break;
            }
            case "fd_write": {
        		const [sbuf, fd, content] = data;
                const lck = new Int32Array(sbuf, 0, 1);

                let err;
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
                        // TODO: should print in red, use ANSI color codes around output
                        const output = content.replaceAll("\n", "\r\n");
                        workerTable.receive_callback(worker_id, output);
                        break;
                    }
                    default: {
                        if (fds[fd] != undefined) {
                            fds[fd].write(content);
                            err = constants.WASI_ESUCCESS;
                        } else {
                            err = constants.WASI_EBADF;
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
                switch (fd) {
                    case 0: {
                        workerTable.send_buffer_to_worker(len, lck, readlen, readbuf);
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
                            err = constants.WASI_EBADF;
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

                let err, entry;
                if (fds[dir_fd] != undefined) {
                    ({err, entry} = await fds[dir_fd].get_entry(path, FileOrDir.Any, oflags));
                    if (err === constants.WASI_ESUCCESS) {
                        fds.push(await entry.open());
                        opened_fd[0] = fds.length - 1;
                    }
                } else {
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
                if (fds[fd] !== undefined) {
                    // TODO: actually close file
                    fds[fd] == undefined;
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
                if (fds[fd] != undefined) {
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

                let err, entry;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) {
                    ({err, entry} = await fds[fd].get_entry(path, FileOrDir.Any));
                    if (err === constants.WASI_ESUCCESS) {
                        let stat = await entry.stat();
                        buf.setBigUint64(0, stat.dev, true);
                        buf.setBigUint64(8, stat.ino, true);
                        buf.setUint8(16, stat.file_type);
                        buf.setBigUint64(24, stat.nlink, true);
                        buf.setBigUint64(32, stat.size, true);
                        buf.setBigUint64(40, stat.atim, true);
                        buf.setBigUint64(48, stat.mtim, true);
                        buf.setBigUint64(56, stat.ctim, true);
                    }
                } else {
                    err = constants.WASI_EBADF;
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
                    fds[fd].seek(Number(offset), whence);
                    err = constants.WASI_ESUCCESS;
                } else {
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

                        if (databuf_ptr + 8 > databuf_len) break;
                        databuf.setBigUint64(databuf_ptr, BigInt(i + 1), true);
                        databuf_ptr += 8;
                        
                        if (databuf_ptr + 8 >= databuf_len) break;
                        // TODO: get file stats ino (dummy 0n for now)
                        databuf.setBigUint64(databuf_ptr, 0n, true);
                        databuf_ptr += 8;
                        
                        if (databuf_ptr + 4 >= databuf_len) break;
                        databuf.setUint32(databuf_ptr, namebuf.byteLength, true);
                        databuf_ptr += 4;
                        
                        if (databuf_ptr + 4 >= databuf_len) break;
                        const file_type = entry.file_type;
                        databuf.setUint8(databuf_ptr, file_type);
                        databuf_ptr += 4; // uint8 + padding

                        // check if name will fit
                        if (databuf_ptr + namebuf.byteLength >= databuf_len) break;
                        const databuf8 = new Uint8Array(sbuf, 8);
                        databuf8.set(namebuf, databuf_ptr);
                        databuf_ptr += namebuf.byteLength;
                    }
                    buf_used[0] = databuf_ptr > databuf_len ? databuf_len : databuf_ptr;
                    err = constants.WASI_ESUCCESS;
                } else {
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
            case "path_unlink_file": {
                const [sbuf, fd, path] = data;
                const lck = new Int32Array(sbuf, 0, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) {              
                    ({err} = fds[fd].delete_entry(path));
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
            case "path_remove_directory": {
                const [sbuf, fd, path] = data;
                const lck = new Int32Array(sbuf, 0, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) {              
                    ({err} = fds[fd].delete_entry(path, {recursive: true}));
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }   
            case "path_create_directory": {
                const [sbuf, fd, path] = data;
                const lck = new Int32Array(sbuf, 0, 1);

                let err;
                const fds = workerTable.workerInfos[worker_id].fds;
                if (fds[fd] != undefined) {              
                    err = await fds[fd].get_entry(path, FileOrDir.Directory, OpenFlags.Create | OpenFlags.Directory | OpenFlags.Exclusive);
                } else {
                    err = constants.WASI_EBADF;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
            case "fd_fdstat_get": {
                const [sbuf, fd] = data;
                const lck = new Int32Array(sbuf, 0, 1);
                const file_type = new Uint8Array(sbuf, 4, 1);
                const rights_base = new BigUint64Array(sbuf, 8, 1);
                const rights_inheriting = new BigUint64Array(sbuf, 16, 1);

                let err;
                if (fds[fd] != undefined) {
                    file_type[0] = fds[fd].file_type;
                    rights_base[0] = -1n;
                    rights_inheriting[0] = ~(1n << 24n);

                    err = constants.WASI_ESUCCESS;
                }

                Atomics.store(lck, 0, err);
                Atomics.notify(lck, 0);
                break;
            }
        }
}

