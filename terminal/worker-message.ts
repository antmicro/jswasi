import * as constants from './constants.js';
import * as utils from './utils.js';
import { FileOrDir, OpenFlags } from './filesystem.js';
import { mount, umount, wget, download, ps, free } from './browser-programs.js';
import { OpenedFd } from './browser-devices.js';

declare global {
  var exit_code: number;
  var alive: boolean;
}

export const on_worker_message = async function (event, workerTable) {
  const [worker_id, action, data] = event.data;
  let worker_name = 'unknown';
  try {
    worker_name = workerTable.workerInfos[worker_id].cmd;
  } catch {}
  worker_name = worker_name.substr(worker_name.lastIndexOf('/') + 1);

  switch (action) {
    case 'stdout': {
      workerTable.receiveCallback(data.replaceAll('\n', '\r\n'));
      break;
    }
    case 'stderr': {
      const output = data.replaceAll('\n', '\r\n');
      const RED_ANSI = '\u001b[31m';
      const RESET = '\u001b[0m';
      workerTable.receiveCallback(`${RED_ANSI}${output}${RESET}`);
      break;
    }
    case 'console': {
      console.log(`%c [dbg (%c${worker_name}:${worker_id}%c)] %c ${data}`, "background:black; color: white;", "background:black; color:yellow;", "background: black; color:white;", "background:default; color: default;");
      break;
    }
    case 'exit': {
	  const dbg = workerTable.workerInfos[worker_id].env["DEBUG"] == "1";
      workerTable.terminateWorker(worker_id, data);
	  if (dbg) {
	    console.log(`%c [dbg (%c${worker_name}:${worker_id}%c)] %c exited with result code ${data}`, "background:black; color: white;", "background:black; color:yellow;", "background: black; color:white;", "background:default; color: default;");
	  }
	  if (worker_id == 0) {
        window.alive = false;
	    window.exit_code = data;
	  }
      break;
    }
    case 'chdir': {
      const [pwd, sbuf] = data;
      const lock = new Int32Array(sbuf, 0, 1);
      const { fds } = workerTable.workerInfos[worker_id];

      const rootDir = await workerTable.filesystem.getRootDirectory();
      const { err, entry } = await rootDir.getEntry(pwd, FileOrDir.Directory);
      const open_pwd = await entry.open();
      open_pwd.path = '.';
      fds[4] = open_pwd;

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
	  break;
    }
    case 'set_env': {
      const [[key, value], sbuf] = data;
      const lock = new Int32Array(sbuf, 0, 1);
      workerTable.workerInfos[worker_id].env[key] = value;
      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
    }
    case 'set_echo': {
      const [shouldEcho, sbuf] = data;
      const lock = new Int32Array(sbuf, 0, 1);
      // TODO: should this be simply $ECHO env variable?
      workerTable.workerInfos[worker_id].shouldEcho = data === '1';
      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
      break;
    }
    case 'spawn': {
      let [fullpath, args, env, sbuf, isJob, redirects] = data;
      const parent_lck = new Int32Array(sbuf, 0, 1);
      args.splice(0, 0, fullpath.split('/').pop());
      switch (fullpath) {
		case '/usr/bin/ps': {
          const result = await ps(workerTable, worker_id, args, env);
          Atomics.store(parent_lck, 0, result);
          Atomics.notify(parent_lck, 0);
		  break;
        }
        case '/usr/bin/mount': {
          const result = await mount(workerTable, worker_id, args, env);
          Atomics.store(parent_lck, 0, result);
          Atomics.notify(parent_lck, 0);
          break;
        }
        case '/usr/bin/umount': {
          const result = await umount(workerTable, worker_id, args, env);
          Atomics.store(parent_lck, 0, result);
          Atomics.notify(parent_lck, 0);
          break;
        }
	    case '/usr/bin/free': {
          const result = await free(workerTable, worker_id, args, env);
          Atomics.store(parent_lck, 0, result);
          Atomics.notify(parent_lck, 0);
	      break;
	    }
        case '/usr/bin/wget': {
          const result = await wget(workerTable, worker_id, args, env);
          Atomics.store(parent_lck, 0, result);
          Atomics.notify(parent_lck, 0);
          break;
        }
        case '/usr/bin/download': {
          const result = await download(workerTable, worker_id, args, env);
          Atomics.store(parent_lck, 0, result);
          Atomics.notify(parent_lck, 0);
          break;
        }
	    case '/usr/bin/nohup':
        default: {
          let background = isJob;
	      if (fullpath == "/usr/bin/nohup") {
	        args = args.splice(1);
	        fullpath = args[0];
	        args = args.splice(1);
            args.splice(0, 0, fullpath.split('/').pop());
	        background = true;
	      }
          // TODO: is shallow copy enough, or should we deepcopy?
          const childFds = workerTable.workerInfos[worker_id].fds.slice(0);
          for (const [fd, path, mode] of redirects) {
            const rootDir = await workerTable.filesystem.getRootDirectory();
            const { err, entry } = await rootDir.getEntry(path, FileOrDir.File, OpenFlags.Create);
            childFds[fd] = await entry.open();
            if (mode === "append") {
                childFds[fd].seek(0, constants.WASI_WHENCE_END);
            }
          }
          const id = await workerTable.spawnWorker(
            worker_id,
            background ? null : parent_lck,
            on_worker_message,
            fullpath,
            childFds,
            args,
            env,
            isJob,
          );
	      let new_worker_name = fullpath.split("/").slice(-1)[0];
	      if (env['DEBUG'] == "1") {
            console.log(
              `%c [dbg (%c${new_worker_name}:${id}%c)] %c spawned by ${worker_name}:${worker_id}`,
              "background:black; color: white;",
              "background:black; color:yellow;",
              "background: black; color:white;",
              "background:default; color: default;"
            );
	      }
	      if (background) {
            Atomics.store(parent_lck, 0, 0);
            Atomics.notify(parent_lck, 0);
	      }
          break;
        }
      }

      break;
    }
    case 'fd_prestat_get': {
      const [sbuf, fd] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const name_len = new Int32Array(sbuf, 4, 1);
      const preopen_type = new Uint8Array(sbuf, 8, 1);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
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

    case 'path_symlink': {
      const [sbuf, path, fd, newpath] = data;
      const lck = new Int32Array(sbuf, 0, 1);

      let err; let
        entry;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] != undefined) {
        const linkpath = `${newpath}.link`;
	        console.log(`We should symlink ${newpath} --> ${path} [dir fd=${fd}]`);
        ({ err, entry } = await fds[fd].getEntry(linkpath, FileOrDir.File, 1 | 4));
        if (err == constants.WASI_ESUCCESS) {
          const file = await entry.open();
          //    let databuf = new ArrayBuffer(path.length);
		    const data = new Uint8Array(path.length);
		    data.set(new TextEncoder().encode(path), 0);
		    await file.write(data);
        }
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);

	    break;
    }

    case 'fd_prestat_dir_name': {
      const [sbuf, fd, path_len] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const path = new Uint8Array(sbuf, 4, path_len);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] != undefined) {
	    // TODO: check if path_len is enough
        path.set(new TextEncoder().encode(fds[fd].path), 0);
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);

      break;
    }
    case 'fd_write': {
      const [sbuf, fd, content_] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const content = new Uint8Array(content_);

      const { fds } = workerTable.workerInfos[worker_id];
      await fds[fd].write(content);

      let err;
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case 'fd_read': {
      const [sbuf, fd, len] = data;

      const { fds } = workerTable.workerInfos[worker_id];
      await fds[fd].read(worker_id, len, sbuf);
      
      break;
    }
    case 'path_open': {
      const [sbuf, dir_fd, path, dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const opened_fd = new Int32Array(sbuf, 4, 1);

      let err; let
        entry;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[dir_fd] != undefined) {
        ({ err, entry } = await fds[dir_fd].getEntry(path, FileOrDir.Any, oflags));
        if (err === constants.WASI_ESUCCESS) {
          fds.push(await entry.open());
          opened_fd[0] = fds.length - 1;
        }
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case 'fd_close': {
      const [sbuf, fd] = data;
      const lck = new Int32Array(sbuf, 0, 1);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] !== undefined) {
        // TODO: actually close file
        fds[fd] = undefined;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case 'fd_filestat_get': {
      const [sbuf, fd] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const buf = new DataView(sbuf, 4);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] != undefined) {
        const stat = await fds[fd].stat();
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
    case 'path_filestat_get': {
      const [sbuf, fd, path, flags] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const buf = new DataView(sbuf, 4);

      let err; let
        entry;

      if (path[0] != '!') {
        const { fds } = workerTable.workerInfos[worker_id];
        if (fds[fd] != undefined) {
          ({ err, entry } = await fds[fd].getEntry(path, FileOrDir.Any));
          if (err === constants.WASI_ESUCCESS) {
            const stat = await entry.stat();
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
      } else {
        buf.setBigUint64(0, BigInt(0), true);
        buf.setBigUint64(8, BigInt(0), true);
        buf.setUint8(16, 0);
        buf.setBigUint64(24, BigInt(0), true);
        buf.setBigUint64(32, BigInt(4096), true);
        buf.setBigUint64(40, BigInt(0), true);
        buf.setBigUint64(48, BigInt(0), true);
        buf.setBigUint64(56, BigInt(0), true);
        err = constants.WASI_ESUCCESS;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case 'fd_seek': {
      const [sbuf, fd, offset, whence] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const file_pos = new BigUint64Array(sbuf, 8, 1);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] != undefined) {
        file_pos[0] = BigInt(await fds[fd].seek(Number(offset), whence));
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case 'fd_readdir': {
      const [sbuf, fd, cookie, databuf_len] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const buf_used = new Uint32Array(sbuf, 4, 1);
      const databuf = new DataView(sbuf, 8, databuf_len);
      let databuf_ptr = 0;

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
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
          const { file_type } = entry;
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
    case 'path_unlink_file': {
      const [sbuf, fd, path] = data;
      const lck = new Int32Array(sbuf, 0, 1);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] != undefined) {
        ({ err } = fds[fd].deleteEntry(path));
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case 'path_remove_directory': {
      const [sbuf, fd, path] = data;
      const lck = new Int32Array(sbuf, 0, 1);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] != undefined) {
        ({ err } = fds[fd].deleteEntry(path, { recursive: true }));
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case 'path_create_directory': {
      const [sbuf, fd, path] = data;
      const lck = new Int32Array(sbuf, 0, 1);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] != undefined) {
        err = await fds[fd].getEntry(path, FileOrDir.Directory, OpenFlags.Create | OpenFlags.Directory | OpenFlags.Exclusive);
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case 'fd_fdstat_get': {
      const [sbuf, fd] = data;
      const lck = new Int32Array(sbuf, 0, 1);
      const file_type = new Uint8Array(sbuf, 4, 1);
      const rights_base = new BigUint64Array(sbuf, 8, 1);
      const rights_inheriting = new BigUint64Array(sbuf, 16, 1);

      let err;
      const { fds } = workerTable.workerInfos[worker_id];
      if (fds[fd] != undefined) {
        file_type[0] = fds[fd].file_type;
	/*
        rights_base[0] = constants.WASI_RIGHT_FD_WRITE | constants.WASI_RIGHT_FD_READ;
	if (file_type[0] == constants.WASI_FILETYPE_DIRECTORY) {
		rights_base[0] |= constants.WASI_RIGHT_FD_READDIR;
	}
        rights_inheriting[0] = constants.WASI_RIGHT_FD_WRITE | constants.WASI_RIGHT_FD_READ;
	if (file_type[0] == constants.WASI_FILETYPE_DIRECTORY) {
		rights_inheriting[0] |= constants.WASI_RIGHT_FD_READDIR;
	}
        */
        // TODO: analyze this
        rights_base[0] = BigInt(0xFFFFFFFF);
        rights_inheriting[0] = BigInt(0xFFFFFFFF);

	
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
  }
};
