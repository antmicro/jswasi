import * as constants from "../../constants.js";
import {
  Filestat,
  Descriptor,
  Filesystem,
  LookupFlags,
  OpenFlags,
  Rights,
  Fdflags,
} from "../filesystem.js";
import ProcessManager from "../../process-manager.js";
import {
  ProcFileDescriptor,
  ProcDirectoryDescriptor,
} from "./proc-descriptors.js";
import * as proc from "./proc-tree.js";

export class ProcFilesystem implements Filesystem {
  constructor(private processManager: ProcessManager) {
    proc.initialize(this.processManager);
  }

  fsname(): string {
    return "ProcFilesystem";
  }

  mkdirat(_desc: Descriptor, _path: string): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  getFilestat(_path: string): Promise<{ err: number; filestat: Filestat }> {
    return Promise.resolve({
      err: constants.WASI_ENOTSUP,
      filestat: undefined,
    });
  }

  open(
    path: string,
    _dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags,
    workerId: number
  ): Promise<{ err: number; index: number; desc: Descriptor }> {
    let currentNode: proc.ProcNode = proc.getTopLevelNode(workerId);
    let err = constants.WASI_ESUCCESS,
      index = -1;

    let start = path.startsWith("/") ? 0 : -1,
      stop = path.indexOf("/", start + 1);

    do {
      const __path =
        stop === -1 ? path.slice(start + 1) : path.slice(start + 1, stop);

      if (
        currentNode.getFilestat().filetype !== constants.WASI_FILETYPE_DIRECTORY
      ) {
        err = constants.WASI_ENOTDIR;
        index = start;
        break;
      }

      const nextNode = (currentNode as proc.ProcDirectory).getNode(__path);
      if (nextNode.err !== constants.WASI_ESUCCESS) {
        err = nextNode.err;
        index = stop;
        break;
      }

      currentNode = nextNode.node;

      const __stop = path.indexOf("/", stop + 1);
      start = stop;
      stop = __stop;
    } while (start !== -1);

    if (start === -1) {
      index = -1;
      if (err === constants.WASI_ESUCCESS) {
        if (
          oflags & constants.WASI_O_DIRECTORY &&
          currentNode.getFilestat().filetype !==
            constants.WASI_FILETYPE_DIRECTORY
        ) {
          err = constants.WASI_ENOTDIR;
        } else if (
          oflags & constants.WASI_O_CREAT &&
          oflags & constants.WASI_O_EXCL
        ) {
          err = constants.WASI_EEXIST;
        }
      } else if (
        err === constants.WASI_ENOENT &&
        oflags & constants.WASI_O_CREAT
      ) {
        err = constants.WASI_EACCES;
      }
    }

    let desc: Descriptor;
    const __ftype = currentNode.getFilestat().filetype;
    if (__ftype === constants.WASI_FILETYPE_DIRECTORY) {
      desc = new ProcDirectoryDescriptor(
        fdflags,
        fs_rights_base,
        fs_rights_inheriting,
        currentNode as proc.ProcDirectory
      );
    } else {
      const __node =
        __ftype === constants.WASI_FILETYPE_REGULAR_FILE
          ? (currentNode as proc.ProcFile)
          : (currentNode as proc.ProcSymlink);

      desc = new ProcFileDescriptor(
        fdflags,
        fs_rights_base,
        fs_rights_inheriting,
        __node
      );
    }
    return Promise.resolve({ err, index, desc });
  }

  unlinkat(
    _desc: Descriptor,
    _path: string,
    _is_dir: boolean
  ): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  renameat(
    _oldDesc: Descriptor,
    _oldPath: string,
    _newDesc: Descriptor,
    _newPath: string
  ): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  symlinkat(
    _target: string,
    _desc: Descriptor,
    _linkpath: string
  ): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }

  initialize(_opts: Object): Promise<number> {
    return Promise.resolve(constants.WASI_ESUCCESS);
  }

  mknodat(
    _desc: Descriptor,
    _path: string,
    _dev: number,
    _args: Object
  ): Promise<number> {
    return Promise.resolve(constants.WASI_EACCES);
  }
}
