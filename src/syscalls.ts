import * as constants from "./constants.js";
import * as utils from "./utils.js";
import { FileOrDir, OpenFlags } from "./filesystem.js";
import { mount, umount, wget, download, ps, free } from "./browser-apps.js";
import ProcessManager from "./process-manager.js";
import { filesystem } from "./terminal.js";

const RED_ANSI = "\u001b[31m";
const RESET = "\u001b[0m";

declare global {
  interface Window {
    exitCode: number;
    alive: boolean;
  }
}

export default async function syscallCallback(
  event: MessageEvent,
  processManager: ProcessManager
): Promise<void> {
  const [processId, action, data] = event.data;
  const fullCommand = processManager.processInfos[processId].cmd;
  const processName = fullCommand.substr(fullCommand.lastIndexOf("/") + 1);

  switch (action) {
    case "stdout": {
      processManager.terminalOutputCallback(data.replaceAll("\n", "\r\n"));
      break;
    }
    case "stderr": {
      processManager.terminalOutputCallback(
        `${RED_ANSI}${data.replaceAll("\n", "\r\n")}${RESET}`
      );
      break;
    }
    case "console": {
      console.log(
        `%c [dbg (%c${processName}:${processId}%c)] %c ${data}`,
        "background:black; color: white;",
        "background:black; color:yellow;",
        "background: black; color:white;",
        "background:default; color: default;"
      );
      break;
    }
    case "exit": {
      const dbg = processManager.processInfos[processId].env.DEBUG === "1";
      processManager.terminateProcess(processId, data);
      if (dbg) {
        console.log(
          `%c [dbg (%c${processName}:${processId}%c)] %c exited with result code ${data}`,
          "background:black; color: white;",
          "background:black; color:yellow;",
          "background: black; color:white;",
          "background:default; color: default;"
        );
      }
      if (processId === 0) {
        window.alive = false;
        window.exitCode = data;
      }
      break;
    }
    case "chdir": {
      const [pwd, sharedBuffer] = data;
      const lock = new Int32Array(sharedBuffer, 0, 1);
      const { fds } = processManager.processInfos[processId];

      const { entry } = await filesystem.rootDir.getEntry(
        pwd,
        FileOrDir.Directory
      );
      const openedPwd = entry.open();
      openedPwd.path = ".";
      fds[4] = openedPwd;

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
      break;
    }
    case "isatty": {
      const [sharedBuffer, fd] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const isatty = new Int32Array(sharedBuffer, 4, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        isatty[0] = fds[fd].isatty;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "getpid": {
      const [sharedBuffer] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const pid = new Int32Array(sharedBuffer, 4, 1);

      pid[0] = processManager.processInfos[processId].id;

      Atomics.store(lck, 0, constants.WASI_ESUCCESS);
      Atomics.notify(lck, 0);
      break;
    }
    case "set_env": {
      const [[key, value], sharedBuffer] = data;
      const lock = new Int32Array(sharedBuffer, 0, 1);
      processManager.processInfos[processId].env[key] = value;

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
      break;
    }
    case "set_echo": {
      const [shouldEcho, sharedBuffer] = data;
      const lock = new Int32Array(sharedBuffer, 0, 1);
      // TODO: should this be simply $ECHO env variable?
      processManager.processInfos[processId].shouldEcho = shouldEcho === "1";

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
      break;
    }
    case "spawn": {
      const [fullPath, args, env, sharedBuffer, background, redirects] = data;
      const parentLck = new Int32Array(sharedBuffer, 0, 1);
      args.splice(0, 0, fullPath.split("/").pop());

      // save parent file descriptors table,
      // replace it with child's for the duration of spawn call
      // restore parent table before returning
      // TODO: is shallow copy enough, or should we deep copy?
      const parentFds = processManager.processInfos[processId].fds.slice(0);
      const { fds } = processManager.processInfos[processId];
      await Promise.all(
        redirects.map(async (redirect: any) => {
          let mode: string;
          let path: string;
          let fd: number;
          if ("Read" in redirect) {
            mode = "read";
            [fd, path] = redirect.Read;
          } else if ("Write" in redirect) {
            mode = "write";
            [fd, path] = redirect.Write;
          } else if ("Append" in redirect) {
            mode = "append";
            [fd, path] = redirect.Append;
          } else {
            throw Error("unrecognized redirect type");
          }
          const { entry } = await filesystem.rootDir.getEntry(
            path,
            FileOrDir.File,
            OpenFlags.Create
          );
          fds[fd] = entry.open();
          const openFile = fds[fd];
          if (mode === "write") {
            await openFile.truncate();
          } else if (mode === "append") {
            await openFile.seek(0, constants.WASI_WHENCE_END);
          }
        })
      );

      switch (fullPath) {
        case "/usr/bin/ps": {
          const result = await ps(processManager, processId, args, env);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/mount": {
          const result = await mount(processManager, processId, args, env);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/umount": {
          const result = umount(processManager, processId, args, env);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/free": {
          const result = await free(processManager, processId, args, env);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/wget": {
          const result = await wget(processManager, processId, args, env);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/download": {
          const result = await download(processManager, processId, args, env);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        default: {
          const id = await processManager.spawnProcess(
            processId,
            background ? null : parentLck,
            syscallCallback,
            fullPath,
            fds,
            args,
            env,
            background
          );
          const newProcessName = fullPath.split("/").slice(-1)[0];
          if (env.DEBUG === "1") {
            console.log(
              `%c [dbg (%c${newProcessName}:${id}%c)] %c spawned by ${processName}:${processId}`,
              "background:black; color: white;",
              "background:black; color:yellow;",
              "background: black; color:white;",
              "background:default; color: default;"
            );
          }
          if (background) {
            Atomics.store(parentLck, 0, 0);
            Atomics.notify(parentLck, 0);
          }
          break;
        }
      }

      // restore parent file descriptor table
      processManager.processInfos[processId].fds = parentFds;
      break;
    }
    case "fd_prestat_get": {
      const [sharedBuffer, fd] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const nameLen = new Int32Array(sharedBuffer, 4, 1);
      const preopenType = new Uint8Array(sharedBuffer, 8, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        preopenType[0] = fds[fd].fileType;
        nameLen[0] = fds[fd].path.length;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "path_symlink": {
      const [sharedBuffer, oldPath, oldFd, newPath] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      const { fds } = processManager.processInfos[processId];
      if (fds[oldFd] === undefined) {
        Atomics.store(lck, 0, constants.WASI_EBADF);
        Atomics.notify(lck, 0);
      }

      const { err, entry } = await fds[oldFd].getEntry(oldPath, FileOrDir.Any);
      if (err === constants.WASI_ESUCCESS) {
        await filesystem.addSymlink(entry, newPath, oldPath);
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "path_link": {
      const [sharedBuffer, oldFd, oldFlags, oldPath, newFd, newPath] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[oldFd] !== undefined) {
        console.log(`TODO: we should hard link ${newPath} --> ${oldPath}`);
        if (err === constants.WASI_ESUCCESS) {
          // TODO
        }
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "fd_prestat_dir_name": {
      const [sharedBuffer, fd, pathLen] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const path = new Uint8Array(sharedBuffer, 4, pathLen);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        path.set(new TextEncoder().encode(fds[fd].path), 0);
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_write": {
      const [sharedBuffer, fd, content_] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const content = new Uint8Array(content_);

      const { fds } = processManager.processInfos[processId];
      const err = await fds[fd].write(content);

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_read": {
      const [sharedBuffer, fd, len] = data;

      const { fds } = processManager.processInfos[processId];
      await fds[fd].read(processId, len, sharedBuffer);

      break;
    }
    case "path_open": {
      const [
        sharedBuffer,
        dirFd,
        path,
        dirFlags,
        oFlags,
        fsRightsBase,
        fsRightsInheriting,
        fdFlags,
      ] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const openedFd = new Int32Array(sharedBuffer, 4, 1);

      let err;
      let entry;
      const { fds } = processManager.processInfos[processId];
      if (fds[dirFd] !== undefined) {
        ({ err, entry } = await fds[dirFd].getEntry(
          path,
          FileOrDir.Any,
          oFlags
        ));
        if (err === constants.WASI_ESUCCESS) {
          fds.push(await entry.open());
          openedFd[0] = fds.length - 1;
        }
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_close": {
      const [sharedBuffer, fd] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        fds[fd].close();
        fds[fd] = undefined;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_filestat_get": {
      const [sharedBuffer, fd] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const buf = new DataView(sharedBuffer, 4);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        const stat = await fds[fd].stat();
        buf.setBigUint64(0, stat.dev, true);
        buf.setBigUint64(8, stat.ino, true);
        buf.setUint8(16, stat.fileType);
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
      const [sharedBuffer, fd, path, flags] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const buf = new DataView(sharedBuffer, 4);

      let err;
      let entry;

      if (path[0] !== "!") {
        const { fds } = processManager.processInfos[processId];
        if (fds[fd] !== undefined) {
          ({ err, entry } = await fds[fd].getEntry(path, FileOrDir.Any));
          if (err === constants.WASI_ESUCCESS) {
            const stat = await entry.stat();
            buf.setBigUint64(0, stat.dev, true);
            buf.setBigUint64(8, stat.ino, true);
            buf.setUint8(16, stat.fileType);
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
    case "fd_seek": {
      const [sharedBuffer, fd, offset, whence] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const filePos = new BigUint64Array(sharedBuffer, 8, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        filePos[0] = BigInt(await fds[fd].seek(Number(offset), whence));
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_readdir": {
      const [sharedBuffer, fd, cookie, dataBufLen] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const bufUsed = new Uint32Array(sharedBuffer, 4, 1);
      const dataBuf = new DataView(sharedBuffer, 8, dataBufLen);
      let dataBufPtr = 0;

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        const entries = await fds[fd].entries();
        for (let i = Number(cookie); i < entries.length; i += 1) {
          const entry = entries[i];
          const nameBuf = new TextEncoder().encode(entry.path);

          if (dataBufPtr + 8 > dataBufLen) break;
          dataBuf.setBigUint64(dataBufPtr, BigInt(i + 1), true);
          dataBufPtr += 8;

          if (dataBufPtr + 8 >= dataBufLen) break;
          // TODO: get file stats ino (dummy 0n for now)
          dataBuf.setBigUint64(dataBufPtr, 0n, true);
          dataBufPtr += 8;

          if (dataBufPtr + 4 >= dataBufLen) break;
          dataBuf.setUint32(dataBufPtr, nameBuf.byteLength, true);
          dataBufPtr += 4;

          if (dataBufPtr + 4 >= dataBufLen) break;
          const { fileType } = entry;
          dataBuf.setUint8(dataBufPtr, fileType);
          dataBufPtr += 4; // uint8 + padding

          // check if name will fit
          if (dataBufPtr + nameBuf.byteLength >= dataBufLen) break;
          const dataBuf8 = new Uint8Array(sharedBuffer, 8);
          dataBuf8.set(nameBuf, dataBufPtr);
          dataBufPtr += nameBuf.byteLength;
        }
        bufUsed[0] = dataBufPtr > dataBufLen ? dataBufLen : dataBufPtr;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_unlink_file": {
      const [sharedBuffer, fd, path] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        ({ err } = fds[fd].deleteEntry(path, { recursive: false }));
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_remove_directory": {
      const [sharedBuffer, fd, path] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        ({ err } = fds[fd].deleteEntry(path, { recursive: true }));
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_create_directory": {
      const [sharedBuffer, fd, path] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        err = await fds[fd].getEntry(
          path,
          FileOrDir.Directory,
          OpenFlags.Create | OpenFlags.Directory | OpenFlags.Exclusive
        );
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_fdstat_get": {
      const [sharedBuffer, fd] = data;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const fileType = new Uint8Array(sharedBuffer, 4, 1);
      const rightsBase = new BigUint64Array(sharedBuffer, 8, 1);
      const rightsInheriting = new BigUint64Array(sharedBuffer, 16, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds[fd] !== undefined) {
        fileType[0] = fds[fd].fileType;
        // TODO: analyze this
        /*
        rightsBase[0] = constants.WASI_RIGHT_FD_WRITE | constants.WASI_RIGHT_FD_READ;
        if (fileType[0] == constants.WASI_FILETYPE_DIRECTORY) {
          rightsBase[0] |= constants.WASI_RIGHT_FD_READDIR;
        }
        rightsInheriting[0] = constants.WASI_RIGHT_FD_WRITE | constants.WASI_RIGHT_FD_READ;
        if (fileType[0] == constants.WASI_FILETYPE_DIRECTORY) {
          rightsInheriting[0] |= constants.WASI_RIGHT_FD_READDIR;
        }
        */
        rightsBase[0] = BigInt(0xffffffff);
        rightsInheriting[0] = BigInt(0xffffffff);

        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    default: {
      throw new Error(`Unhandled syscall: ${action}`);
    }
  }
}
