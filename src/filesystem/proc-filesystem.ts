import * as constants from "../constants.js";
import {
  Filestat,
  Descriptor,
  Filesystem,
  LookupFlags,
  OpenFlags,
  Rights,
  Fdflags,
  AbstractDirectoryDescriptor,
  Dirent,
} from "./filesystem.js";
import ProcessManager from "../process-manager.js";

interface ProcNode {
  getFilestat(): Filestat;
}

interface ProcDirectory extends ProcNode {
  getNode(path: string[], workerId: number): { err: number; node?: ProcNode };
}

interface ProcFile extends ProcNode {
  read(): string;
}

abstract class AbstractProcFile implements ProcFile {
  protected processManager: ProcessManager;
  abstract read(): string;

  constructor(pm: ProcessManager) {
    this.processManager = pm;
  }

  getFilestat(): Filestat {
    return {
      dev: 0n,
      ino: 0n,
      filetype: constants.WASI_FILETYPE_REGULAR_FILE,
      nlink: 1n,
      size: 0n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    };
  }
}

abstract class AbstractProcDirectory implements ProcDirectory {
  protected processManager: ProcessManager;
  abstract getNode(
    path: string[],
    workerId: number
  ): { err: number; node?: ProcNode };

  constructor(pm: ProcessManager) {
    this.processManager = pm;
  }

  getFilestat(): Filestat {
    return {
      dev: 0n,
      ino: 0n,
      filetype: constants.WASI_FILETYPE_DIRECTORY,
      nlink: 1n,
      size: 0n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    };
  }
}

class MountinfoFile extends AbstractProcFile implements ProcNode {
  read(): string {
    return Object.entries(this.processManager.filesystem.getMounts())
      .map(([mountPoint, fs]) => `${mountPoint} ${fs}`)
      .join("\n");
  }
}

class TopLevelDirectory extends AbstractProcDirectory implements ProcNode {
  getNode(
    pathStack: string[],
    workerId: number
  ): { err: number; node?: ProcNode } {
    const component = pathStack.shift();

    const num = Number(component);
    if (num !== NaN) {
      if (this.processManager.processInfos[workerId] !== undefined) {
        return {
          err: constants.WASI_ESUCCESS,
          node: new ProcessDirectory(this.processManager),
        };
      }
    }
    return {
      err: constants.WASI_ENOENT,
      node: undefined,
    };
  }
}

class ProcessDirectory extends AbstractProcDirectory implements ProcNode {
  getNode(
    pathStack: string[],
    workerId: number
  ): { err: number; node?: ProcNode } {
    const component = pathStack.shift();
    switch (component) {
      case "mountinfo": {
        if (pathStack.length === 0) {
          return {
            err: constants.WASI_ESUCCESS,
            node: new MountinfoFile(this.processManager),
          };
        } else {
          return {
            err: constants.WASI_ENOTDIR,
            node: undefined,
          };
        }
      }
      default: {
        return {
          err: constants.WASI_ENOENT,
          node: undefined,
        };
      }
    }
  }
}

export class ProcFilesystem implements Filesystem {
  private processManager: ProcessManager;

  mkdirat(_desc: Descriptor, _path: string): Promise<number> {
    return Promise.resolve(constants.WASI_ENOTSUP);
  }
  getFilestat(_path: string): Promise<{ err: number; filestat: Filestat }> {
    return Promise.resolve({
      err: constants.WASI_ENOTSUP,
      filestat: undefined,
    });
  }

  open(
    path: string,
    dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags,
    workerId: number
  ): Promise<{ err: number; index: number; desc: Descriptor }> {}

  unlinkat(
    _desc: Descriptor,
    _path: string,
    _is_dir: boolean
  ): Promise<number> {
    return Promise.resolve(constants.WASI_ENOTSUP);
  }

  renameat(
    _oldDesc: Descriptor,
    _oldPath: string,
    _newDesc: Descriptor,
    _newPath: string
  ): Promise<number> {
    return Promise.resolve(constants.WASI_ENOTSUP);
  }

  symlinkat(
    _target: string,
    _desc: Descriptor,
    _linkpath: string
  ): Promise<number> {
    return Promise.resolve(constants.WASI_ENOTSUP);
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
    return Promise.resolve(constants.WASI_ENOTSUP);
  }
}

export class ProcDirectoryDescriptor extends AbstractDirectoryDescriptor {
  private filesystem: ProcFilesystem;

  readdir(refresh: boolean): Promise<{ err: number; dirents: Dirent[] }> {}
}
