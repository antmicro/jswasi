import * as constants from "./constants.js";
import {
  ChdirArgs,
  GetCwdArgs,
  FdCloseArgs,
  FdFdstatGetArgs,
  FdPrestatDirNameArgs,
  FdPrestatGetArgs,
  FdReadArgs,
  FdReaddirArgs,
  FdSeekArgs,
  FdTellArgs,
  FdWriteArgs,
  GetPidArgs,
  IsAttyArgs,
  PathCreateDirectoryArgs,
  FilestatGetArgs,
  PathLinkArgs,
  PathOpenArgs,
  PathReadlinkArgs,
  PathRemoveEntryArgs,
  PathSymlinkArgs,
  SetEchoArgs,
  SetEnvArgs,
  SpawnArgs,
  PathRenameArgs,
  FilestatSetTimesArgs,
  PollOneoffArgs,
  EventSourceArgs,
  AttachSigIntArgs,
  CleanInodesArgs,
  KillArgs,
  IoctlArgs,
  ClockSub,
  PollEvent,
  FdReadWriteSub,
} from "./types.js";
import { free, mount, ps, reset, wget, umount } from "./browser-apps.js";
import ProcessManager from "./process-manager.js";
import { EventSource } from "./devices.js";
import { basename, msToNs } from "./utils.js";
import { listStoredKeys, delStoredData } from "./filesystem/metadata.js";

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
    case "proc_exit": {
      if (processManager.processInfos[processId].env["DEBUG"] === "1") {
        console.log(
          `%c [dbg (%c${processName}:${processId}%c)] %c exited with result code ${data}`,
          "background:black; color: white;",
          "background:black; color:yellow;",
          "background: black; color:white;",
          "background:default; color: default;"
        );
      }
      await processManager.terminateProcess(processId, data);
      if (processId === 0) {
        window.alive = false;
        window.exitCode = data;
      }
      break;
    }
    case "chdir": {
      const { dir, sharedBuffer } = data as ChdirArgs;
      const lock = new Int32Array(sharedBuffer, 0, 1);

      processManager.processInfos[processId].cwd = dir;

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
      break;
    }
    case "getcwd": {
      const { bufLen, sharedBuffer } = data as GetCwdArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const cwd_len = new Uint32Array(sharedBuffer, 4, 1);
      const cwd = new Uint8Array(sharedBuffer, 8, bufLen);

      let err = constants.WASI_ESUCCESS;
      const cwd_path = processManager.processInfos[processId].cwd;
      if (bufLen < cwd_path.length) {
        cwd_len[0] = bufLen;
        err = constants.WASI_ENOBUFS;
      } else {
        cwd_len[0] = cwd_path.length;
        cwd.set(new TextEncoder().encode(cwd_path), 0);
      }
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "isatty": {
      const { sharedBuffer, fd } = data as IsAttyArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const isatty = new Int32Array(sharedBuffer, 4, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        isatty[0] = Number(fds.getFd(fd).isatty());
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "getpid": {
      const { sharedBuffer } = data as GetPidArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const pid = new Int32Array(sharedBuffer, 4, 1);

      pid[0] = processManager.processInfos[processId].id;

      Atomics.store(lck, 0, constants.WASI_ESUCCESS);
      Atomics.notify(lck, 0);
      break;
    }
    case "set_env": {
      const { key, value, sharedBuffer } = data as SetEnvArgs;
      const lock = new Int32Array(sharedBuffer, 0, 1);
      processManager.processInfos[processId].env[key] = value;

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
      break;
    }
    case "set_echo": {
      const { shouldEcho, sharedBuffer } = data as SetEchoArgs;
      const lock = new Int32Array(sharedBuffer, 0, 1);
      // TODO: should this be simply $ECHO env variable?
      processManager.processInfos[processId].shouldEcho = shouldEcho === "1";

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
      break;
    }
    case "spawn": {
      const { path, args, env, sharedBuffer, background, redirects } =
        data as SpawnArgs;
      const parentLck = new Int32Array(sharedBuffer, 0, 1);
      const childPID = new Int32Array(sharedBuffer, 4, 1);
      childPID[0] = -1;
      args.splice(0, 0, path.split("/").pop());

      // replace child's descriptor table with shallow copy of parent's
      const fds = processManager.processInfos[processId].fds.clone();
      await Promise.all(
        redirects.map(async ({ mode, path, fd }) => {
          const { desc } = await processManager.filesystem.open(
            path,
            constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
            constants.WASI_O_CREAT |
              (mode === "write" ? constants.WASI_O_TRUNC : 0),
            mode === "append" ? constants.WASI_FDFLAG_APPEND : 0
          );
          fds.replaceFd(fd, desc);
        })
      );
      let isBrowserApp = true;

      // TODO: Intentionally ignore SigInt, do not check termiantionOccured is set
      // for browser apps. Maybe we should handle it in the future..
      switch (path) {
        case "/usr/bin/ps": {
          const result = await ps(processManager, processId, args, env, fds);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/mount": {
          const result = await mount(processManager, processId, args, env, fds);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/free": {
          const result = await free(processManager, processId, args, env, fds);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/wget": {
          const result = await wget(processManager, processId, args, env, fds);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/reset": {
          const result = await reset(processManager, processId, args, env, fds);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        case "/usr/bin/umount": {
          const result = await umount(
            processManager,
            processId,
            args,
            env,
            fds
          );
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        default: {
          isBrowserApp = false;
          // Check did SigInt come.
          // We can skip spawn child here and return to user space with appropriate exit code.
          let events =
            processManager.processInfos[processId].terminationNotifier;
          let sigintOccurred =
            events !== null
              ? events.obtainEvents(constants.WASI_EXT_EVENT_SIGINT) != 0
              : false;

          if (sigintOccurred) {
            fds.tearDown();
            Atomics.store(parentLck, 0, constants.EXIT_INTERRUPTED);
            Atomics.notify(parentLck, 0);
            break;
          }

          try {
            const id = await processManager.spawnProcess(
              processId,
              background ? null : parentLck,
              path,
              fds,
              args,
              env,
              background,
              processManager.processInfos[processId].cwd
            );
            Atomics.store(childPID, 0, id);
            if (env["DEBUG"] === "1") {
              const newProcessName = path.split("/").slice(-1)[0];
              console.log(
                `%c [dbg (%c${newProcessName}:${id}%c)] %c spawned by ${processName}:${processId}`,
                "background:black; color: white;",
                "background:black; color:yellow;",
                "background: black; color:white;",
                "background:default; color: default;"
              );
            }
          } catch (_) {
            console.log("Failed spawning process");
          }
          if (background) {
            let exit_code = constants.EXIT_SUCCESS;
            // We have already spawned  background process, SigInt doesn't terminate it.
            // Wash should break execution of commands chain
            let sigintOccurred =
              events !== null
                ? events.obtainEvents(constants.WASI_EXT_EVENT_SIGINT) != 0
                : false;
            if (sigintOccurred) {
              exit_code = constants.EXIT_INTERRUPTED;
            }

            Atomics.store(parentLck, 0, exit_code);
            Atomics.notify(parentLck, 0);
          }
        }
      }

      if (isBrowserApp) {
        // Close stdout and stderr in browser apps
        fds.tearDown();
      }

      break;
    }
    case "fd_prestat_get": {
      const { sharedBuffer, fd } = data as FdPrestatGetArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const nameLen = new Int32Array(sharedBuffer, 4, 1);
      const preopenType = new Uint8Array(sharedBuffer, 8, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fd > 2 && fd < 4) {
        preopenType[0] = constants.WASI_PREOPENTYPE_DIR;
        nameLen[0] = basename(fds.getFd(fd).getPath()).length;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "path_symlink": {
      const { sharedBuffer, targetPath, linkFd, linkPath } =
        data as PathSymlinkArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      const { fds } = processManager.processInfos[processId];
      let err;
      if (fds.getFd(linkFd) === undefined) {
        err = constants.WASI_EBADF;
      } else {
        err = await processManager.filesystem.addSymlink(
          targetPath,
          linkPath,
          fds.getFd(linkFd)
        );
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "path_link": {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sharedBuffer, oldFd } = data as PathLinkArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(oldFd) !== undefined) {
        err = (
          await fds
            .getFd(constants.WASI_FD_STDERR)
            .write(new TextEncoder().encode("hard links are not supported"))
        ).err;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "path_readlink": {
      const { sharedBuffer, fd, path, bufferLen } = data as PathReadlinkArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const bufferUsed = new Int32Array(sharedBuffer, 4, 1);
      const buffer = new Uint8Array(sharedBuffer, 8, bufferLen);

      let err = constants.WASI_ESUCCESS;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        let __path;
        ({ err, path: __path } = await processManager.filesystem.readLink(
          fds.getFd(fd),
          path
        ));
        if (err === constants.WASI_ESUCCESS) {
          if (__path.length > bufferLen) {
            bufferUsed[0] = bufferLen;
          } else {
            buffer.set(new TextEncoder().encode(__path), 0);
            bufferUsed[0] = __path.length;
          }
        } else {
          err = constants.WASI_EINVAL;
        }
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "fd_prestat_dir_name": {
      const { sharedBuffer, fd, pathLen } = data as FdPrestatDirNameArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const path = new Uint8Array(sharedBuffer, 4, pathLen);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        path.set(
          new TextEncoder().encode(basename(fds.getFd(fd).getPath())),
          0
        );
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "fd_write": {
      const { sharedBuffer, fd, content } = data as FdWriteArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      const { fds } = processManager.processInfos[processId];
      let err;
      let ftype;
      if (fds.getFd(fd) !== undefined) {
        const fdstat = await fds.getFd(fd).getFdstat();
        ftype = fdstat.fs_filetype;
        if (ftype === constants.WASI_FILETYPE_DIRECTORY) {
          err = constants.WASI_EISDIR;
        } else if (ftype === constants.WASI_FILETYPE_SYMBOLIC_LINK) {
          err = constants.WASI_EINVAL;
        } else if (
          (fdstat.fs_rights_base & constants.WASI_RIGHT_FD_WRITE) ===
          0n
        ) {
          err = constants.WASI_EACCES;
        } else {
          err = (await fds.getFd(fd).write(content.buffer)).err;
        }
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_pread":
    case "fd_read": {
      const { sharedBuffer, fd, len, offset } = data as FdReadArgs;

      const { fds } = processManager.processInfos[processId];
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const readBuf = new Uint8Array(sharedBuffer, 8, len);
      let err;
      const readLen = new Int32Array(sharedBuffer, 4, 1);

      let fdstat;
      if (fds.getFd(fd) === undefined) {
        err = constants.WASI_EBADF;
      } else {
        fdstat = await fds.getFd(fd).getFdstat();
        if ((fdstat.fs_rights_base & constants.WASI_RIGHT_FD_READ) == 0n) {
          err = constants.WASI_EACCES;
        } else if (fdstat.fs_filetype === constants.WASI_FILETYPE_DIRECTORY) {
          err = constants.WASI_EISDIR;
        } else if (
          fdstat.fs_filetype === constants.WASI_FILETYPE_SYMBOLIC_LINK
        ) {
          err = constants.WASI_EINVAL;
        } else {
          let res;
          if (offset) {
            res = await fds.getFd(fd).pread(len, offset);
          } else {
            res = await fds.getFd(fd).read(len, processId);
          }
          err = res.err;
          readBuf.set(new Uint8Array(res.buffer));
          readLen[0] = res.buffer.byteLength;
        }
      }
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "path_open": {
      const {
        sharedBuffer,
        dirFd,
        path,
        lookupFlags,
        openFlags,
        fsRightsBase,
        fsRightsInheriting,
        fdFlags,
      } = data as PathOpenArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const openedFd = new Int32Array(sharedBuffer, 4, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(dirFd) !== undefined) {
        if (
          !(
            openFlags & constants.WASI_O_CREAT &&
            openFlags & constants.WASI_O_DIRECTORY
          )
        ) {
          let desc;
          ({ err, desc } = await processManager.filesystem.openat(
            fds.getFd(dirFd),
            path,
            lookupFlags,
            openFlags,
            fdFlags,
            fsRightsBase,
            fsRightsInheriting
          ));
          if (err === constants.WASI_ESUCCESS) {
            openedFd[0] = fds.addFile(desc);
          }
        } else {
          err = constants.WASI_EINVAL;
        }
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_close": {
      const { sharedBuffer, fd } = data as FdCloseArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        await fds.getFd(fd).close();
        fds.freeFd(fd);
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_filestat_get":
    case "fd_filestat_get": {
      const { sharedBuffer, fd, path, lookupFlags } = data as FilestatGetArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const buf = new DataView(sharedBuffer, 4);

      let err = constants.WASI_ESUCCESS;

      const { fds } = processManager.processInfos[processId];
      let desc = fds.getFd(fd);
      if (desc === undefined) {
        err = constants.WASI_EBADF;
      } else {
        let fdstat = await desc.getFdstat();
        if (
          (path &&
            fdstat.fs_rights_base & constants.WASI_RIGHT_PATH_FILESTAT_GET) ||
          (!path &&
            fdstat.fs_rights_base & constants.WASI_RIGHT_FD_FILESTAT_GET)
        ) {
          let __desc;
          if (path !== undefined) {
            let res = await processManager.filesystem.openat(
              desc,
              path,
              lookupFlags
            );
            err = res.err;
            if (res.err === constants.WASI_ESUCCESS) {
              __desc = res.desc;
            }
          } else {
            __desc = desc;
          }
          if (__desc !== undefined) {
            if (
              (path &&
                fdstat.fs_rights_base &
                  constants.WASI_RIGHT_PATH_FILESTAT_GET) ||
              (!path &&
                fdstat.fs_rights_base & constants.WASI_RIGHT_FD_FILESTAT_GET)
            ) {
              if (err === constants.WASI_ESUCCESS) {
                let filestat = await __desc.getFilestat();
                buf.setBigUint64(0, filestat.dev, true);
                buf.setBigUint64(8, filestat.ino, true);
                buf.setUint8(16, filestat.filetype);
                buf.setBigUint64(24, filestat.nlink, true);
                buf.setBigUint64(32, filestat.size, true);
                buf.setBigUint64(40, filestat.atim, true);
                buf.setBigUint64(48, filestat.mtim, true);
                buf.setBigUint64(56, filestat.ctim, true);
              }
            }
          }
        } else {
          err = constants.WASI_EACCES;
        }
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_seek": {
      const { sharedBuffer, fd, offset, whence } = data as FdSeekArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const filePos = new BigUint64Array(sharedBuffer, 8, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) === undefined) {
        err = constants.WASI_EBADF;
      } else {
        const fdstat = await fds.getFd(fd).getFdstat();
        if ((fdstat.fs_rights_base & constants.WASI_RIGHT_FD_SEEK) !== 0n) {
          if (fdstat.fs_filetype !== constants.WASI_FILETYPE_DIRECTORY) {
            const result = await fds.getFd(fd).seek(offset, whence);
            filePos[0] = result.offset;
            err = result.err;
          } else {
            err = constants.WASI_EBADF;
          }
        } else {
          err = constants.WASI_EACCES;
        }
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_readdir": {
      const { sharedBuffer, fd, cookie, bufLen } = data as FdReaddirArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const bufUsed = new Uint32Array(sharedBuffer, 4, 1);
      const dataBuf = new DataView(sharedBuffer, 8, bufLen);
      let dataBufPtr = 0;

      let err;
      const { fds } = processManager.processInfos[processId];
      if (
        fds.getFd(fd) !== undefined &&
        (await fds.getFd(fd).getFilestat()).filetype ===
          constants.WASI_FILETYPE_DIRECTORY
      ) {
        let entries = (await fds.getFd(fd).readdir(cookie === 0n)).dirents;
        for (let i = Number(cookie); i < entries.length; i += 1) {
          const entry = entries[i];
          const nameBuf = new TextEncoder().encode(entry.name);

          // TODO: check if these breaks can lead to null byte runtime errors
          if (dataBufPtr + 8 > bufLen) {
            dataBufPtr += 8;
            break;
          }
          dataBuf.setBigUint64(dataBufPtr, BigInt(i + 1), true);
          dataBufPtr += 8;

          if (dataBufPtr + 8 >= bufLen) {
            dataBufPtr += 8;
            break;
          }
          dataBuf.setBigUint64(dataBufPtr, entry.d_ino, true);
          dataBufPtr += 8;

          if (dataBufPtr + 4 >= bufLen) {
            dataBufPtr += 4;
            break;
          }
          dataBuf.setUint32(dataBufPtr, nameBuf.byteLength, true);
          dataBufPtr += 4;

          if (dataBufPtr + 4 >= bufLen) {
            dataBufPtr += 4;
            break;
          }
          dataBuf.setUint8(dataBufPtr, entry.d_type);
          dataBufPtr += 4; // uint8 + padding

          // check if name will fit
          if (dataBufPtr + nameBuf.byteLength > bufLen) {
            dataBufPtr += nameBuf.byteLength;
            break;
          }
          const dataBuf8 = new Uint8Array(sharedBuffer, 8);
          dataBuf8.set(nameBuf, dataBufPtr);
          dataBufPtr += nameBuf.byteLength;
        }
        bufUsed[0] = dataBufPtr > bufLen ? bufLen : dataBufPtr;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_unlink_file":
    case "path_remove_directory": {
      // path_unlink_file and path_remove_directory are handled the same way
      const { sharedBuffer, fd, path } = data as PathRemoveEntryArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        err = await processManager.filesystem.removeEntry(
          path,
          action !== "path_unlink_file",
          fds.getFd(fd)
        );
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_create_directory": {
      const { sharedBuffer, fd, path } = data as PathCreateDirectoryArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        err = await processManager.filesystem.createDir(path, fds.getFd(fd));
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_fdstat_get": {
      const { sharedBuffer, fd } = data as FdFdstatGetArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const fileType = new Uint8Array(sharedBuffer, 4, 1);
      const rightsBase = new BigUint64Array(sharedBuffer, 8, 1);
      const rightsInheriting = new BigUint64Array(sharedBuffer, 16, 1);
      const fdFlags = new Uint8Array(sharedBuffer, 24, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      const fdstat = await fds.getFd(fd).getFdstat();
      if (fds.getFd(fd) !== undefined) {
        fileType[0] = fdstat.fs_filetype;
        fdFlags[0] = fdstat.fs_flags;
        rightsBase[0] = fdstat.fs_rights_base;
        rightsInheriting[0] = fdstat.fs_rights_inheriting;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_rename": {
      const { sharedBuffer, oldFd, oldPath, newFd, newPath } =
        data as PathRenameArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const { fds } = processManager.processInfos[processId];

      let err = await processManager.filesystem.move(
        fds.getFd(oldFd),
        oldPath,
        fds.getFd(newFd),
        newPath
      );

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_tell": {
      const { sharedBuffer, fd } = data as FdTellArgs;
      const offset = new BigInt64Array(sharedBuffer, 0, 1);
      const lck = new Int32Array(sharedBuffer, 8, 1);

      const { fds } = processManager.processInfos[processId];
      let err;
      if (fds.getFd(fd) !== undefined) {
        let fdstat = await fds.getFd(fd).getFdstat();
        if ((fdstat.fs_rights_base & constants.WASI_RIGHT_FD_TELL) !== 0n) {
          if (
            fdstat.fs_filetype === constants.WASI_FILETYPE_REGULAR_FILE ||
            fdstat.fs_filetype === constants.WASI_FILETYPE_SYMBOLIC_LINK
          ) {
            offset[0] = BigInt(
              (await fds.getFd(fd).seek(0n, constants.WASI_WHENCE_CUR)).offset
            );
            err = constants.WASI_ESUCCESS;
          } else {
            err = constants.WASI_EBADF;
          }
        } else {
          err = constants.WASI_EACCES;
        }
      } else {
        err = constants.WASI_EBADF;
      }
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_filestat_set_times":
    case "fd_filestat_set_times": {
      const { sharedBuffer, st_atim, flags, st_mtim, fst_flags, fd, path } =
        data as FilestatSetTimesArgs;

      let err = constants.WASI_EBADF;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      const { fds } = processManager.processInfos[processId];
      let desc = fds.getFd(fd);
      if (desc && path !== undefined) {
        const res = await processManager.filesystem.openat(desc, path, flags);
        desc = res.desc;
        err = res.err;
      }

      if (desc) {
        let fdstat = await desc.getFdstat();
        if (
          !(fdstat.fs_rights_base & constants.WASI_RIGHT_FD_FILESTAT_SET_TIMES)
        ) {
          err = constants.WASI_EACCES;
        } else {
          if (
            !(
              ((fst_flags & constants.WASI_FSTFLAGS_ATIM_NOW) !== 0 &&
                (fst_flags & constants.WASI_FSTFLAGS_ATIM) !== 0) ||
              ((fst_flags & constants.WASI_FSTFLAGS_MTIM_NOW) !== 0 &&
                (fst_flags & constants.WASI_FSTFLAGS_MTIM) !== 0)
            )
          ) {
            let __mtim, __atim;
            if ((fst_flags & constants.WASI_FSTFLAGS_ATIM) !== 0) {
              __atim = st_atim;
            } else if ((fst_flags & constants.WASI_FSTFLAGS_ATIM_NOW) !== 0) {
              __atim = msToNs(performance.now());
            }
            if ((fst_flags & constants.WASI_FSTFLAGS_MTIM) !== 0) {
              __mtim = st_mtim;
            } else if ((fst_flags & constants.WASI_FSTFLAGS_MTIM_NOW) !== 0) {
              __mtim = msToNs(performance.now());
            }
            err = await desc.setFilestatTimes(__atim, __mtim);
          } else {
            err = constants.WASI_EINVAL;
          }
        }
      }
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);

      break;
    }
    case "poll_oneoff": {
      const { sharedBuffer, subs, eventBuf } = data as PollOneoffArgs;
      const lock = new Int32Array(sharedBuffer, 0, 2);

      const { fds } = processManager.processInfos[processId];

      let __events: PollEvent[] = [];
      await Promise.any(
        subs.map(async (sub) => {
          let __subPromise;
          switch (sub.eventType) {
            case constants.WASI_EVENTTYPE_CLOCK:
              __subPromise = new Promise(
                (resolve: (event: PollEvent) => void) => {
                  setTimeout(() => {
                    resolve({
                      userdata: sub.userdata,
                      error: constants.WASI_ESUCCESS,
                      eventType: sub.eventType,
                      nbytes: 0n,
                    });
                  }, Number((sub.event as ClockSub).timeout / 1000000n));
                }
              );
              break;

            case constants.WASI_EVENTTYPE_FD_WRITE:
            case constants.WASI_EVENTTYPE_FD_READ:
              __subPromise = fds
                .getFd((sub.event as FdReadWriteSub).fd)
                .addPollSub(sub.userdata, sub.eventType, processId);
              break;

            default:
              __subPromise = new Promise(
                (resolve: (event: PollEvent) => void) => {
                  resolve({
                    userdata: sub.userdata,
                    // TODO: Should this be EINVAL?
                    error: constants.WASI_EINVAL,
                    eventType: constants.WASI_EXT_NO_EVENT,
                    nbytes: 0n,
                  });
                }
              );
          }
          return __subPromise.then((event: PollEvent) => __events.push(event));
        })
      );

      const eventBufView = new DataView(eventBuf, 0);
      let nOccured = __events.length;
      let offset = 0;
      __events.forEach((event) => {
        eventBufView.setBigUint64(offset, event.userdata, true);
        offset += 8;

        eventBufView.setUint16(offset, event.error, true);
        offset += 2;

        eventBufView.setUint8(offset, event.eventType);
        offset += 6;

        eventBufView.setBigUint64(offset, event.nbytes, true);
        offset += 8;
        // TODO: event flags
        offset += 8;
      });

      Atomics.store(lock, 1, nOccured);
      Atomics.store(lock, 0, constants.WASI_ESUCCESS);
      Atomics.notify(lock, 0);

      break;
    }
    case "event_source_fd": {
      const { sharedBuffer, eventMask } = data as EventSourceArgs;

      const lck = new Int32Array(sharedBuffer, 0, 1);
      const fileDescriptor = new Int32Array(sharedBuffer, 4, 1);

      let eventSource = new EventSource(
        0,
        constants.WASI_RIGHTS_ALL,
        constants.WASI_RIGHTS_ALL,
        eventMask
      );

      var fd = processManager.processInfos[processId].fds.addFile(eventSource);
      Atomics.store(fileDescriptor, 0, fd);
      Atomics.store(lck, 0, 0);
      Atomics.notify(lck, 0);

      break;
    }
    case "attach_sigint": {
      const { sharedBuffer, fd } = data as AttachSigIntArgs;

      const stat = processManager.attachSigint(fd, processId);

      const lck = new Int32Array(sharedBuffer, 0, 1);
      Atomics.store(lck, 0, stat);
      Atomics.notify(lck, 0);

      break;
    }
    case "clean_inodes": {
      // This syscall removes indexedDB entries that don't correspond to any file or directory
      const { sharedBuffer } = data as CleanInodesArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let keys = await listStoredKeys();

      for (let key of keys) {
        const { err } = await processManager.filesystem.open(key);
        if (err === constants.WASI_ENOENT) {
          delStoredData(key);
        }
      }

      Atomics.store(lck, 0, 0);
      Atomics.notify(lck, 0);
      break;
    }
    case "kill": {
      const { sharedBuffer, processId, signalNumber } = data as KillArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let exitStatus = constants.WASI_ESUCCESS;
      if (signalNumber !== constants.WASI_SIGKILL) {
        // For now, we support SigKill only
        console.log(
          `Process=${processId} send usupported singnal: ${signalNumber}!`
        );
        exitStatus = constants.WASI_EINVAL;
      } else if (processManager.processInfos[processId] === undefined) {
        console.log(
          `Process=${processId} send singnal to process ${processId} that does not exist!`
        );
        exitStatus = constants.WASI_ESRCH;
      } else {
        // In bash:
        // When a command terminates on a fatal signal whose number is N,
        // Bash uses the value 128+N as the exit status.
        await processManager.terminateProcess(processId, 128 + signalNumber);
      }

      Atomics.store(lck, 0, exitStatus);
      Atomics.notify(lck, 0);
      break;
    }
    case "ioctl": {
      const { sharedBuffer, fd, command } = data as IoctlArgs;

      const lck = new Int32Array(sharedBuffer, 0, 1);
      const argBufferUsed = new Int32Array(sharedBuffer, 4, 1);
      const argBuffer = new Uint8Array(sharedBuffer, 8);

      const { fds } = processManager.processInfos[processId];
      let desc = fds.getFd(fd);

      if (fd === undefined) {
        Atomics.store(lck, 0, constants.WASI_EBADF);
        Atomics.notify(lck, 0);
        break;
      }

      const { err, written } = await desc.ioctl(command, argBuffer);
      argBufferUsed[0] = written;

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    default: {
      throw new Error(`Unhandled syscall: ${action}`);
    }
  }
}
