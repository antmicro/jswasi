import * as constants from "./constants.js";
import {
  ChdirArgs,
  GetCwdArgs,
  FdCloseArgs,
  FdFdstatGetArgs,
  FdFilestatGetArgs,
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
  PathFilestatGetArgs,
  PathLinkArgs,
  PathOpenArgs,
  PathReadlinkArgs,
  PathRemoveEntryArgs,
  PathSymlinkArgs,
  SetEchoArgs,
  SetEnvArgs,
  SpawnArgs,
  HtermConfArgs,
  PathRenameArgs,
  FdFilestatSetTimesArgs,
  PathFilestatSetTimesArgs,
  PollOneoffArgs,
  FdReadSub,
  EventSourceArgs,
  CleanInodesArgs,
} from "./types.js";
import ProcessManager from "./process-manager.js";
import { In, Stdin, Out, EventSource } from "./devices.js";
import { FileOrDir, LookupFlags, OpenFlags } from "./filesystem/enums.js";
import { msToNs } from "./utils.js";
import { listStoredKeys, delStoredData } from "./filesystem/metadata.js";

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
      const { sharedBuffer, method, attrib, val } = data as HtermConfArgs;
      const lock = new Int32Array(sharedBuffer, 0, 1);

      const terminal = processManager.terminal;

      let err = constants.WASI_ESUCCESS;
      if (method === "get") {
        const bufferUsed = new Int32Array(sharedBuffer, 4, 1);
        const buffer = new Int8Array(sharedBuffer, 8, bufferUsed[0]);
        const fields = attrib.split(".");

        let data;
        try {
          if (fields[0] === "prefs_") {
            data = terminal.prefs_.get(fields[1]);
          } else {
            var param = terminal;
            for (var field of fields) {
              param = param[field];
            }
            data = param;
          }

          const value = String(data);
          if (value.length <= bufferUsed[0]) {
            buffer.set(new TextEncoder().encode(value), 0);
          }

          bufferUsed[0] = value.length;
        } catch (error) {
          err = constants.WASI_EINVAL;
        }
      } else if (method === "set") {
        try {
          terminal.prefs_.set(attrib, val);
        } catch (error) {
          err = constants.WASI_EINVAL;
        }
      } else {
        err = constants.WASI_EINVAL;
      }

      Atomics.store(lock, 0, err);
      Atomics.notify(lock, 0);
      break;
    }
    case "chdir": {
      const { dir, sharedBuffer } = data as ChdirArgs;
      const lock = new Int32Array(sharedBuffer, 0, 1);
      const { fds } = processManager.processInfos[processId];

      const { desc } = await processManager.filesystem.open(dir);
      fds.replaceFd(4, desc);
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
      args.splice(0, 0, path.split("/").pop());

      // replace child's descriptor table with shallow copy of parent's
      const fds = processManager.processInfos[processId].fds.clone();
      await Promise.all(
        redirects.map(async ({ mode, path, fd }) => {
          const { desc } = await processManager.filesystem.open(
            path,
            constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
          );
          fds.replaceFd(fd, desc);
          if (mode === "write") {
            desc.truncate(0);
          } else if (mode === "append") {
            desc.seek(0n, constants.WASI_WHENCE_END);
          }
        })
      );

      switch (path) {
        case "/usr/local/bin/syscalls_test": {
          const openedPwdDir = fds.getFd(4) as OpenDirectory;
          await openedPwdDir.getEntry(
            "dir",
            FileOrDir.Directory,
            LookupFlags.SymlinkFollow,
            OpenFlags.Create | OpenFlags.Directory
          );
          const text = await (
            await openedPwdDir.getEntry(
              "text",
              FileOrDir.Any,
              LookupFlags.SymlinkFollow,
              OpenFlags.Create
            )
          ).entry.open();
          await (text as OpenFile).write(
            new TextEncoder().encode("sample text\n")
          );
          await text.close();
          openedPwdDir.addSymlink("link", "text");
          openedPwdDir.addSymlink("dir_link", "dir");
          for (let i = 0; i < 10; i++) {
            await openedPwdDir.getEntry(
              `dir/ent${i}`,
              FileOrDir.File,
              LookupFlags.SymlinkFollow,
              OpenFlags.Create
            );
          }
          // no break so that test is spawned normally (default must be below this case)
        }
        default: {
          try {
            const id = await processManager.spawnProcess(
              processId,
              background ? null : parentLck,
              syscallCallback,
              path,
              fds,
              args,
              env,
              background,
              processManager.processInfos[processId].cwd
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
          } catch (_) {
            console.log("Failed spawning process");
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
        fds.getFd(fd) === undefined ||
        (await fds.getFd(fd).stat()).fileType !==
          constants.WASI_FILETYPE_DIRECTORY ||
        fds.getFd(fd).isPreopened === false
      ) {
        err = constants.WASI_EBADF;
      } else {
        preopenType[0] = constants.WASI_PREOPENTYPE_DIR;
        nameLen[0] = (fds.getFd(fd) as OpenFile).name().length;
        err = constants.WASI_ESUCCESS;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }

    case "path_symlink": {
      const { sharedBuffer, oldPath, newFd, newPath } = data as PathSymlinkArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      const { fds } = processManager.processInfos[processId];
      let err;
      if (fds.getFd(newFd) === undefined) {
        err = constants.WASI_EBADF;
      } else {
        err = await (fds.getFd(newFd) as OpenDirectory).addSymlink(
          newPath,
          oldPath
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
            .getFd(constants.WASI_STDERR_FILENO)
            .write(
              new DataView(
                new TextEncoder().encode("hard links are not supported")
              )
            )
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
      let err;
      let ftype;
      const fdstat = await fds.getFd(fd).getFdstat();
      if (fds.getFd(fd) !== undefined) {
        ftype = fdstat.fs_filetype;
      }
      if (fds.getFd(fd) === undefined) {
        err = constants.WASI_EBADF;
      } else if (ftype === constants.WASI_FILETYPE_DIRECTORY) {
        err = constants.WASI_EISDIR;
      } else if (ftype === constants.WASI_FILETYPE_SYMBOLIC_LINK) {
        err = constants.WASI_EINVAL;
      } else if (
        (fdstat.fs_rights_base & constants.WASI_RIGHT_FD_WRITE) ===
        0n
      ) {
        err = constants.WASI_EACCES;
      } else {
        err = (await fds.getFd(fd).write(new DataView(content))).err;
      }

      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);
      break;
    }
    case "fd_pread":
    case "fd_read": {
      const { sharedBuffer, fd, len, pread } = data as FdReadArgs;

      const { fds } = processManager.processInfos[processId];
      const lck = new Int32Array(sharedBuffer, 0, 1);
      let ftype, err;
      const fdstat = await fds.getFd(fd).getFdstat();
      if (fds.getFd(fd) !== undefined) {
        ftype = fdstat.fs_filetype;
      }
      if (fds.getFd(fd) === undefined) {
        Atomics.store(lck, 0, constants.WASI_EBADF);
        Atomics.notify(lck, 0);
      } else if ((fdstat.fs_rights_base & constants.WASI_RIGHT_FD_READ) == 0n) {
        Atomics.store(lck, 0, constants.WASI_EACCES);
        Atomics.notify(lck, 0);
      } else if (ftype === constants.WASI_FILETYPE_DIRECTORY) {
        Atomics.store(lck, 0, constants.WASI_EISDIR);
        Atomics.notify(lck, 0);
      } else if (ftype === constants.WASI_FILETYPE_SYMBOLIC_LINK) {
        Atomics.store(lck, 0, constants.WASI_EINVAL);
        Atomics.notify(lck, 0);
      } else {
        if (pread) {
          err = (await fds.getFd(fd).pread(len, pread)).err;
        } else {
          err = (await fds.getFd(fd).read(len)).err;
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
      let entry;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(dirFd) !== undefined) {
        if (
          !(
            openFlags & constants.WASI_O_CREAT &&
            openFlags & constants.WASI_O_DIRECTORY
          )
        ) {
          ({ err, entry } = await (fds.getFd(dirFd) as OpenDirectory).getEntry(
            path,
            FileOrDir.Any,
            lookupFlags,
            openFlags
          ));
          if (err === constants.WASI_ESUCCESS) {
            const e = await entry.open(
              fsRightsBase &
                (fds.getFd(dirFd) as OpenDirectory).rightsInheriting,
              fsRightsInheriting,
              fdFlags
            );
            openedFd[0] = fds.addFile(e);
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
    case "fd_filestat_get": {
      const { sharedBuffer, fd } = data as FdFilestatGetArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const buf = new DataView(sharedBuffer, 4);

      let err;
      const { fds } = processManager.processInfos[processId];
      if (fds.getFd(fd) !== undefined) {
        const stat = await fds.getFd(fd).getFilestat();
        buf.setBigUint64(0, stat.dev, true);
        buf.setBigUint64(8, stat.ino, true);
        buf.setUint8(16, stat.filetype);
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
          if (
            ((await fds.getFd(fd).getFdstat()).fs_rights_base &
              constants.WASI_RIGHT_PATH_FILESTAT_GET) !==
            0n
          ) {
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
            err = constants.WASI_EACCES;
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
      const fdstat = await fds.getFd(fd).getFdstat();
      if (fds.getFd(fd) !== undefined) {
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
      if (
        fds.getFd(fd) !== undefined &&
        (await fds.getFd(fd).getFilestat()).filetype ===
          constants.WASI_FILETYPE_DIRECTORY
      ) {
        let entries = (await fds.getFd(fd).readdir(cookie === 0)).dirents;
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
        ({ err } = await (fds.getFd(fd) as OpenDirectory).deleteEntry(path, {
          // recursive flag is only meant for internal purposes
          // from outside, path_remove_directory can only delete empty directory
          // to remove non-empty directory, all files need to be removed from directory using different syscalls
          recursive: false,
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
      // renaming entries is not supported in filesystem access api yet
      // in order for programs to work, this syscall has a workaround solution
      // instead of renaming the file or directory, it is copied and then deleted
      // more info on move feature in filesystem access api: https://chromestatus.com/feature/5640802622504960
      const { sharedBuffer, oldFd, oldPath, newFd, newPath } =
        data as PathRenameArgs;
      const lck = new Int32Array(sharedBuffer, 0, 1);
      const { fds } = processManager.processInfos[processId];
      var err = constants.WASI_ESUCCESS;

      // delete entry at a target path if it already exists
      // if it doesn't exist, we just ignore error code and move on
      ((await fds.getFd(newFd)) as OpenDirectory).deleteEntry(newPath, {
        recursive: true,
      });
      const oldEntry = await (fds.getFd(oldFd) as OpenDirectory).getEntry(
        oldPath,
        FileOrDir.Any,
        LookupFlags.NoFollow
      );
      // copy the entry recursively
      if (oldEntry.err === constants.WASI_ESUCCESS) {
        let openedOldEntry = await oldEntry.entry.open();
        let result = await openedOldEntry.copyEntry(
          fds.getFd(newFd) as OpenDirectory,
          newPath
        );
        if (result === constants.WASI_ESUCCESS) {
          // close and remove old entry
          await openedOldEntry.close();
          ((await fds.getFd(oldFd)) as OpenDirectory).deleteEntry(oldPath, {
            recursive: true,
          });
        } else {
          err = result;
        }
      } else {
        err = oldEntry.err;
      }
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
        console.log((await fds.getFd(fd).stat()).fileType);
        if ((fds.getFd(fd).rightsBase & constants.WASI_RIGHT_FD_TELL) !== 0n) {
          const ftype = (await fds.getFd(fd).stat()).fileType;
          if (
            ftype === constants.WASI_FILETYPE_REGULAR_FILE ||
            ftype === constants.WASI_FILETYPE_SYMBOLIC_LINK
          ) {
            offset[0] = BigInt(
              (
                await (fds.getFd(fd) as OpenFile).seek(
                  0,
                  constants.WASI_WHENCE_CUR
                )
              ).pos
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
      const { sharedBuffer, st_atim, st_mtim, fst_flags } =
        data as FdFilestatSetTimesArgs;
      let file;
      let err = constants.WASI_ESUCCESS;
      const lck = new Int32Array(sharedBuffer, 0, 1);

      const { fds } = processManager.processInfos[processId];
      if (action === "fd_filestat_set_times") {
        const { fd } = data as FdFilestatGetArgs;
        file = fds.getFd(fd);
        if (!file) {
          err = constants.WASI_EBADF;
        } else if (
          (file.rightsBase & constants.WASI_RIGHT_FD_FILESTAT_SET_TIMES) ===
          0n
        ) {
          err = constants.WASI_EACCES;
        }
      } else {
        const { fd, path, flags } = data as PathFilestatSetTimesArgs;
        if (fds.getFd(fd) === undefined) {
          err = constants.WASI_EBADF;
        } else {
          file = (
            await (fds.getFd(fd) as OpenDirectory).getEntry(
              path,
              FileOrDir.Any,
              flags
            )
          ).entry;
          if (!file) {
            err = constants.WASI_EINVAL;
          }
        }
      }
      if (err === constants.WASI_ESUCCESS) {
        if (
          (!(
            (fst_flags & constants.WASI_FSTFLAGS_ATIM_NOW) !== 0 &&
            (fst_flags & constants.WASI_FSTFLAGS_ATIM) !== 0
          ) &&
            !(
              (fst_flags & constants.WASI_FSTFLAGS_MTIM_NOW) !== 0 &&
              (fst_flags & constants.WASI_FSTFLAGS_MTIM) !== 0
            )) ||
          file.fileType === constants.WASI_FILETYPE_CHARACTER_DEVICE
        ) {
          let metadata = await (file as File | Directory).metadata();
          if ((fst_flags & constants.WASI_FSTFLAGS_ATIM) !== 0) {
            metadata.atim = st_atim;
          } else if ((fst_flags & constants.WASI_FSTFLAGS_ATIM_NOW) !== 0) {
            metadata.atim = msToNs(performance.now());
          }
          if ((fst_flags & constants.WASI_FSTFLAGS_MTIM) !== 0) {
            metadata.mtim = st_mtim;
          } else if ((fst_flags & constants.WASI_FSTFLAGS_MTIM_NOW) !== 0) {
            metadata.mtim = msToNs(performance.now());
          }
          try {
            // setting times of character devices makes no sense for now
            await (file as File | Directory).updateMetadata(metadata);
          } catch (e: any) {}
        } else {
          err = constants.WASI_EINVAL;
        }
      }
      Atomics.store(lck, 0, err);
      Atomics.notify(lck, 0);

      break;
    }
    case "poll_oneoff": {
      const { sharedBuffer, subs, events } = data as PollOneoffArgs;
      const lock = new Int32Array(sharedBuffer, 0, 2);

      const { fds } = processManager.processInfos[processId];
      var isEvent = false;

      for (var i = 0; i < subs.length; i++) {
        let sub = subs[i];
        const event = new Int32Array(events[i], 0, 2);

        let fdNum = (sub.event as FdReadSub).fd;
        let fd = fds.getFd(fdNum);
        if (fd === undefined) {
          event[0] = constants.WASI_POLL_BUF_STATUS_ERR;
          event[1] = constants.WASI_EBADF;
          isEvent = true;

          continue;
        }

        let stat = await fd.stat();

        switch (sub.eventType) {
          case constants.WASI_EVENTTYPE_FD_READ: {
            switch (stat.fileType) {
              case constants.WASI_FILETYPE_CHARACTER_DEVICE: {
                if (fd instanceof Stdin) {
                  let stdin = fd as Stdin;
                  let bytes = stdin.availableBytes(processId);

                  if (bytes > 0) {
                    event[0] = constants.WASI_POLL_BUF_STATUS_READY;
                    event[1] = bytes;
                    isEvent = true;
                  }
                } else if (fd instanceof EventSource) {
                  let eventSource = fd as EventSource;
                  let bytes = eventSource.availableBytes(processId);

                  if (bytes > 0) {
                    event[0] = constants.WASI_POLL_BUF_STATUS_READY;
                    event[1] = bytes;
                    isEvent = true;
                  }
                } else {
                  event[0] = constants.WASI_POLL_BUF_STATUS_ERR;
                  event[1] = constants.WASI_EBADF;
                  isEvent = true;
                }

                break;
              }
              case constants.WASI_FILETYPE_DIRECTORY:
              case constants.WASI_FILETYPE_REGULAR_FILE: {
                event[0] = constants.WASI_POLL_BUF_STATUS_ERR;
                event[1] = constants.WASI_EPERM;
                isEvent = true;

                break;
              }
              default: {
                event[0] = constants.WASI_POLL_BUF_STATUS_ERR;
                event[1] = constants.WASI_ENOTSUP;
                isEvent = true;
              }
            }

            break;
          }
          case constants.WASI_EVENTTYPE_FD_WRITE: {
            event[0] = constants.WASI_POLL_BUF_STATUS_ERR;
            event[1] = constants.WASI_ENOTSUP;
            isEvent = true;

            break;
          }
          default: {
            event[0] = constants.WASI_POLL_BUF_STATUS_ERR;
            event[1] = constants.WASI_EINVAL;
            isEvent = true;
          }
        }
      }

      if (isEvent) {
        Atomics.store(lock, 0, 0);
        Atomics.store(lock, 1, 0);
        Atomics.notify(lock, 0);

        break;
      }

      const endLock = new Int32Array(sharedBuffer, 4, 1);

      for (var i = 0; i < subs.length; i++) {
        let sub = subs[i];
        const buffer = new Int32Array(events[i], 0, 2);
        let fdNum = (sub.event as FdReadSub).fd;
        let fd = fds.getFd(fdNum);
        let stat = await fd.getFdstat();

        switch (stat.fs_filetype) {
          case constants.WASI_FILETYPE_CHARACTER_DEVICE: {
            if (fd instanceof Stdin) {
              let stdin = fd as Stdin;
              stdin.setPollEntry(processId, endLock, buffer);
            } else if (fd instanceof EventSource) {
              let eventSource = fd as EventSource;
              eventSource.setPollEntry(endLock, buffer);
            } else {
              //! We have processed data earlier, it should be not executed
              console.log(`Poll fd[${fdNum}] = ${fd} is handled incorrectly!`);
            }

            break;
          }
          case constants.WASI_FILETYPE_DIRECTORY:
          case constants.WASI_FILETYPE_REGULAR_FILE:
          default: {
            //! We have processed data earlier, it should be not executed
            console.log(`Poll fd[${fdNum}] = ${fd} is handled incorrectly!`);
          }
        }
      }

      Atomics.store(lock, 0, 0);
      Atomics.notify(lock, 0);

      break;
    }
    case "event_source_fd": {
      const { sharedBuffer, eventMask } = data as EventSourceArgs;

      const lck = new Int32Array(sharedBuffer, 0, 1);
      const fileDescriptor = new Int32Array(sharedBuffer, 4, 1);

      let eventSource = new EventSource(processManager, processId, eventMask);

      var fd = processManager.processInfos[processId].fds.addFile(eventSource);
      Atomics.store(fileDescriptor, 0, fd);
      Atomics.store(lck, 0, 0);
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
    default: {
      throw new Error(`Unhandled syscall: ${action}`);
    }
  }
}
