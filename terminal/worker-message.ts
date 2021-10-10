import * as constants from './constants.js';
import { FileOrDir, OpenFlags } from './filesystem.js';
import { mount, umount, wget } from './browser-shell.js';

function human_readable(bytes) {
	const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
	let result = bytes;
	let unit = 0;
	while ((result >= 1024) && ((unit+1) < units.length)) {
	     result /= 1024;
	     unit++;
	}
	return `${result.toFixed(1)}${units[unit]}`;
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
        workerTable.receive_callback(data.replaceAll('\n', '\r\n'));
        break;
    }
    case 'stderr': {
        const output = data.replaceAll('\n', '\r\n');
        const RED_ANSI = '\u001b[31m';
        const RESET = '\u001b[0m';
        workerTable.receive_callback(`${RED_ANSI}${output}${RESET}`);
        break;
    }
    case 'console': {
        console.log(`%c [dbg (%c${worker_name}:${worker_id}%x)] %c ${data}`, "background:black; color: white;", "background:black; color:yellow;", "background: black; color:white;", "background:default; color: default;");
        break;
    }
    case 'exit': {
        workerTable.terminateWorker(worker_id, data);
	  console.log(`%c [dbg (%c${worker_name}:${worker_id}%c)] %c exited with result code ${data}`, "background:black; color: white;", "background:black; color:yellow;", "background: black; color:white;", "background:default; color: default;");
        // @ts-ignore
        if (worker_id == 0) window.alive = false;
        break;
    }
    case 'chdir': {
      const [pwd, sbuf] = data;
      const parent_lck = new Int32Array(sbuf, 0, 1);
      const { fds } = workerTable.workerInfos[worker_id];

      const rootDir = await workerTable.filesystem.getRootDirectory();
      const { err, entry } = await rootDir.getEntry(pwd, FileOrDir.Directory);
      const open_pwd = entry.open();
      open_pwd.path = '.';
      fds[4] = open_pwd;

      Atomics.store(parent_lck, 0, 0);
      Atomics.notify(parent_lck, 0);
	        break;
    }
    case 'spawn': {
      const [fullpath, args, env, sbuf] = data;
      const parent_lck = new Int32Array(sbuf, 0, 1);
      args.splice(0, 0, fullpath.split('/').pop());
      switch (fullpath) {
		case '/usr/bin/ps': {
	      let ps_data = '  PID TTY          TIME CMD\n\r';
		  for (let id = 0; id < workerTable.nextWorkerId; id++) {
		    if (workerTable.alive[id]) {
		      const now = new Date();
              const time = Math.floor(now.getTime() / 1000) - workerTable.workerInfos[id].timestamp;
              const seconds = time % 60;
              const minutes = ((time - seconds) / 60) % 60;
              const hours = (time - seconds - minutes * 60) / 60 / 60;
              ps_data += `${(`     ${id}`).slice(-5)} pts/0    ${(`00${hours}`).slice(-2)}:${(`00${minutes}`).slice(-2)}:${(`00${seconds}`).slice(-2)} ${workerTable.workerInfos[id].cmd.split('/').slice(-1)[0]}\n\r`;
			}
	      }
          workerTable.receive_callback(ps_data);
		  Atomics.store(parent_lck, 0, 0);
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
          const result = umount(workerTable, worker_id, args, env);
          Atomics.store(parent_lck, 0, result);
          Atomics.notify(parent_lck, 0);
          break;
        }
	case '/usr/bin/free': {
	  let total_mem_raw = performance.memory.jsHeapSizeLimit; 
          let used_mem_raw = performance.memory.usedJSHeapSize;
	  let total_mem = "";
	  let used_mem = "";
	  let avail_mem = "";
	  if ((args.length > 1) && (args[1] == "-h")) {
	      total_mem = human_readable(total_mem_raw);
	      used_mem = human_readable(used_mem_raw);
	      avail_mem = human_readable(total_mem_raw - used_mem_raw);
	  } else {
              total_mem = `${Math.round(total_mem_raw / 1024)}`;
	      used_mem = `${Math.round(used_mem_raw / 1024)}`;
	      avail_mem = `${Math.round((total_mem_raw-used_mem_raw) / 1024)}`;
	  }
	  let free_data = `               total        used   available\n\r`;
	  free_data    += `Mem:      ${("          " + total_mem).slice(-10)}  ${("          " + used_mem).slice(-10)}  ${("          " + avail_mem).slice(-10)}\n\r`;
	  workerTable.receive_callback(free_data);
          Atomics.store(parent_lck, 0, 0);
          Atomics.notify(parent_lck, 0);
	  break;
	}
        case '/usr/bin/wget': {
          await wget(workerTable, worker_id, args, env);
          Atomics.store(parent_lck, 0, 0);
          Atomics.notify(parent_lck, 0);
          break;
        }
        default: {
          const parent = workerTable.workerInfos[worker_id];
          const id = await workerTable.spawnWorker(
            worker_id,
            parent_lck,
            on_worker_message,
            fullpath,
            parent.fds,
            args,
            env,
          );
	  let new_worker_name = fullpath.substr(fullpath.lastIndexOf('/') + 1);
	  console.log(`%c [dbg (%c${new_worker_name}:${id}%c)] %c spawned by ${worker_name}:${worker_id}`, "background:black; color: white;", "background:black; color:yellow;", "background: black; color:white;", "background:default; color: default;");
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
        if (fds[fd].path == '') if (fd == 3) fds[fd].path = '/';
        if (fds[fd].path == '') if (fd == 4) fds[fd].path = '.';
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

      let err;
      switch (fd) {
        case 0: {
          throw "can't write to stdin!";
        }
        case 1: {
          let output = '';
          for (let i = 0; i < content.byteLength; i++) output += String.fromCharCode(content[i]);
          workerTable.receive_callback(output.replaceAll('\n', '\r\n')); // TODO
          break;
        }
        case 2: {
          let output = '';
          for (let i = 0; i < content.byteLength; i++) output += String.fromCharCode(content[i]);
		            output = output.replaceAll('\n', '\r\n');
          const RED_ANSI = '\u001b[31m';
          const RESET = '\u001b[0m';
          workerTable.receive_callback(`${RED_ANSI}${output}${RESET}`);
          break;
        }
        default: {
          const { fds } = workerTable.workerInfos[worker_id];
          if (fds[fd] != undefined) {
            const local_content = new Uint8Array(content.byteLength);
            local_content.set(content);
            // for some reason writable cannot use shared arrays?
            await fds[fd].write(local_content);
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
    case 'fd_read': {
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
        }
        case 2: {
          throw "can't read from stderr!";
        }
        default: {
          const { fds } = workerTable.workerInfos[worker_id];
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
      } else {
        err = constants.WASI_EBADF;
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
        fds[fd].seek(Number(offset), whence);
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
        rights_base[0] = -1n;
        rights_inheriting[0] = ~(1n << 24n);

        err = constants.WASI_ESUCCESS;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
  }
};
