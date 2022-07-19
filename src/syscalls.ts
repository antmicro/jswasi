import * as constants from "./constants.js";
import {
  ChdirArgs,
  FdCloseArgs,
  FdFdstatGetArgs,
  FdFilestatGetArgs,
  FdPrestatDirNameArgs,
  FdPrestatGetArgs,
  FdReadArgs,
  FdReaddirArgs,
  FdSeekArgs,
  FdWriteArgs,
  GetPidArgs,
  IsAttyArgs,
  PathCreateDirectoryArgs,
  PathFilestatGetArgs,
  PathLinkArgs,
  PathOpenArgs,
  PathReadlinkArgs,
  PathRemoveDirectoryArgs,
  PathSymlinkArgs,
  PathUnlinkFileArgs,
  SetEchoArgs,
  SetEnvArgs,
  SpawnArgs,
  HtermConfArgs,
} from "./types.js";
import { OpenDirectory, OpenFile } from "./filesystem/interfaces.js";
import {
  download,
  free,
  mount,
  ps,
  reset,
  umount,
  wget,
} from "./browser-apps.js";
import ProcessManager from "./process-manager.js";
import { In, Out } from "./devices.js";
import { FileOrDir, LookupFlags, OpenFlags } from "./filesystem/enums.js";
import { terminal } from "./terminal.js";

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
      processManager.terminalOutputCallback(data);
      break;
    }
    case "stderr": {
      processManager.terminalOutputCallback(`${RED_ANSI}${data}${RESET}`);
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
      processManager.terminateProcess(processId, data);
      if (processId === 0) {
        window.alive = false;
        window.exitCode = data;
      }
      break;
    }
    case "hterm": {
      const { sharedBuffer, attrib, val } = data as HtermConfArgs;
      const lock = new Int32Array(sharedBuffer, 0, 1);
      terminal.prefs_.set(attrib, val);
      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
      break;
    }
    case "chdir": {
      const { dir, sharedBuffer } = data as ChdirArgs;
      const lock = new Int32Array(sharedBuffer, 0, 1);
      const { fds } = processManager.processInfos[processId];

      const { entry } = await processManager.filesystem
        .getRootDir()
        .open()
        .getEntry(dir, FileOrDir.Directory);
      const openedPwd = entry.open() as OpenDirectory;
      openedPwd.setAsCwd();
      fds.replaceFd(4, openedPwd);

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);
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
      const {
        path,
        args,
        env,
        sharedBuffer,
        background,
        redirects,
        workingDir,
      } = data as SpawnArgs;
      const parentLck = new Int32Array(sharedBuffer, 0, 1);
      args.splice(0, 0, path.split("/").pop());

      // replace child's descriptor table with shallow copy of parent's
      const fds = processManager.processInfos[processId].fds.clone();
      await Promise.all(
        redirects.map(async ({ mode, path, fd }) => {
          const { entry } = await processManager.filesystem
            .getRootDir()
            .open()
            .getEntry(
              path,
              FileOrDir.File,
              LookupFlags.SymlinkFollow,
              OpenFlags.Create
            );
          fds.replaceFd(fd, await entry.open());
          const openFile = fds.getFd(fd);
          if (mode === "write") {
            await (openFile as OpenFile).truncate(0);
          } else if (mode === "append") {
            await (openFile as OpenFile).seek(0, constants.WASI_WHENCE_END);
          }
        })
      );

      switch (path) {
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
          const result = await umount(processManager, processId, args, env);
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
        case "/usr/bin/reset": {
          const result = await reset(processManager, processId, args, env);
          Atomics.store(parentLck, 0, result);
          Atomics.notify(parentLck, 0);
          break;
        }
        default: {
          const id = await processManager.spawnProcess(
            processId,
            background ? null : parentLck,
            syscallCallback,
            path,
            fds,
            args,
            env,
            background,
            workingDir
          );
          const newProcessName = path.split("/").slice(-1)[0];
          if (env["DEBUG"] === "1") {
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
      break;
    }
    case "fd_prestat_get": {
      const { sharedBuffer, fd } = data as FdPrestatGetArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const nameLen = new Int32Array(sharedBuffer, 4, 1);
      const preopenType = new Uint8Array(sharedBuffer, 8, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (
        fds.getFd(fd) !== undefined &&
        fds.getFd(fd).isPreopened &&
        (await fds.getFd(fd).stat()).fileType ===
          constants.WASI_FILETYPE_DIRECTORY
      ) {
        preopenType[0] = constants.WASI_PREOPENTYPE_DIR;
        nameLen[0] = (fds.getFd(fd) as OpenFile).name().length;
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "path_symlink": {
      const { sharedBuffer, oldPath, newFd, newPath } = data as PathSymlinkArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(newFd) === undefined) {
        Atomics.store(lck, 0, constants.WASI_EBADF);
        Atomics.notify(lck, 0);
      }

      const err = await (fds.getFd(newFd) as OpenDirectory).addSymlink(
        newPath,
        oldPath
      );

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
        err = await (fds.getFd(constants.WASI_STDERR_FILENO) as Out).write(
          new TextEncoder().encode("hard links are not supported")
        );
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

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        let linkedPath;
        ({ err, linkedPath } = await (fds.getFd(fd) as OpenDirectory).readlink(
          path
        ));
        if (err === constants.WASI_ESUCCESS) {
          if (linkedPath.length > bufferLen) {
            bufferUsed[0] = bufferLen;
          } else {
            buffer.set(new TextEncoder().encode(linkedPath), 0);
            bufferUsed[0] = linkedPath.length;
          }
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
          new TextEncoder().encode((fds.getFd(fd) as OpenFile).name()),
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
      const err = await (fds.getFd(fd) as OpenFile).write(content);

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "fd_read": {
      const { sharedBuffer, fd, len } = data as FdReadArgs;

      const { fds } = processManager.processInfos[processId];
      await (fds.getFd(fd) as In).scheduleRead(processId, len, sharedBuffer);

      // releasing the lock is delegated to read() call
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
      let entry;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(dirFd) !== undefined) {
        ({ err, entry } = await (fds.getFd(dirFd) as OpenDirectory).getEntry(
          path,
          FileOrDir.Any,
          lookupFlags,
          openFlags,
          fsRightsBase,
          fsRightsInheriting,
          fdFlags
        ));
        if (err === constants.WASI_ESUCCESS) {
          const e = await entry.open();
          openedFd[0] = fds.addFile(e);
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
        await (fds.getFd(fd) as OpenFile).close();
        fds.freeFd(fd);
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_filestat_get": {
      const { sharedBuffer, fd } = data as FdFilestatGetArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const buf = new DataView(sharedBuffer, 4);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        const stat = await fds.getFd(fd).stat();
        buf.setBigUint64(0, stat.dev, true);
        buf.setBigUint64(8, stat.ino, true);
        buf.setUint8(16, stat.fileType);
        buf.setBigUint64(24, stat.nlink, true);
        buf.setBigUint64(32, stat.size, true);
        buf.setBigUint64(40, stat.atim, true);
        buf.setBigUint64(48, stat.mtim, true);
        buf.setBigUint64(56, stat.ctim, true);
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_filestat_get": {
      const { sharedBuffer, fd, path, lookupFlags } =
        data as PathFilestatGetArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const buf = new DataView(sharedBuffer, 4);

      let err;
      let entry;

      if (path[0] !== "!") {
        const { fds } = processManager.processInfos[processId];
        if (fds.getFd(fd) !== undefined) {
          ({ err, entry } = await (fds.getFd(fd) as OpenDirectory).getEntry(
            path,
            FileOrDir.Any,
            lookupFlags
          ));
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
      const { sharedBuffer, fd, offset, whence } = data as FdSeekArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const filePos = new BigUint64Array(sharedBuffer, 8, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        filePos[0] = BigInt(
          await (fds.getFd(fd) as OpenFile).seek(Number(offset), whence)
        );
        err = constants.WASI_ESUCCESS;
      } else {
        err = constants.WASI_EBADF;
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
      if (fds.getFd(fd) !== undefined) {
        const entries = await (fds.getFd(fd) as OpenDirectory).entries();
        const stats = await Promise.all(
          entries.map(async (entry) => entry.stat())
        );
        for (let i = Number(cookie); i < entries.length; i += 1) {
          const entry = entries[i];
          const nameBuf = new TextEncoder().encode(entry.name());

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
          dataBuf.setBigUint64(dataBufPtr, stats[i].ino, true);
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
          dataBuf.setUint8(dataBufPtr, stats[i].fileType);
          dataBufPtr += 4; // uint8 + padding

          // check if name will fit
          if (dataBufPtr + nameBuf.byteLength >= bufLen) {
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
    case "path_unlink_file": {
      const { sharedBuffer, fd, path } = data as PathUnlinkFileArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        // TODO: should this be separate OpenDirectory.unlink() function?
        ({ err } = await (fds.getFd(fd) as OpenDirectory).deleteEntry(path, {
          recursive: false,
        }));
      } else {
        err = constants.WASI_EBADF;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "path_remove_directory": {
      const { sharedBuffer, fd, path } = data as PathRemoveDirectoryArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        ({ err } = await (fds.getFd(fd) as OpenDirectory).deleteEntry(path, {
          recursive: true,
        }));
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
        ({ err } = await (fds.getFd(fd) as OpenDirectory).getEntry(
          path,
          FileOrDir.Directory,
          LookupFlags.SymlinkFollow,
          OpenFlags.Create | OpenFlags.Directory | OpenFlags.Exclusive
        ));
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

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        fileType[0] = (await fds.getFd(fd).stat()).fileType;
        rightsBase[0] = fds.getFd(fd).fdRights;
        // for now we return the file rights as rights inheriting
        // because so far, we give rwx rights to every file
        // for character devices, rights inheriting are 0 (because wasmer does it that way)
        rightsInheriting[0] = fd < 3 ? 0n : fds.getFd(fd).fdRights;
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
