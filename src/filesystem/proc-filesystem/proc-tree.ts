import * as constants from "../../constants.js";
import ProcessManager from "../../process-manager.js";
import { Filestat } from "../filesystem.js";

let processManager: ProcessManager;

export function initialize(pm: ProcessManager): void {
  processManager = pm;
}

export function getTopLevelNode(pid: number): TopLevelDirectory {
  return new TopLevelDirectory(pid);
}

export interface ProcNode {
  getFilestat(): Filestat;
}

export interface ProcDirectory extends ProcNode {
  listNodes(): { err: number; nodes: Record<string, ProcNode> };
  getNode(name: string): { err: number; node?: ProcNode };
}

export interface ProcFile extends ProcNode {
  read(): string;
}

export interface ProcSymlink extends ProcNode {
  read(): string;
}

abstract class AbstractProcSymlink implements ProcSymlink {
  private static filestat = {
    dev: 0n,
    ino: 0n,
    filetype: constants.WASI_FILETYPE_SYMBOLIC_LINK,
    nlink: 1n,
    size: 0n,
    mtim: 0n,
    atim: 0n,
    ctim: 0n,
  };

  constructor() {}

  getFilestat() {
    return AbstractProcSymlink.filestat;
  }

  abstract read(): string;
}

abstract class AbstractProcFile implements ProcFile {
  private static filestat = {
    dev: 0n,
    ino: 0n,
    filetype: constants.WASI_FILETYPE_REGULAR_FILE,
    nlink: 1n,
    size: 0n,
    mtim: 0n,
    atim: 0n,
    ctim: 0n,
  };

  getFilestat(): Filestat {
    return AbstractProcFile.filestat;
  }

  abstract read(): string;
}

abstract class AbstractProcDirectory implements ProcDirectory {
  private static filestat = {
    dev: 0n,
    ino: 0n,
    filetype: constants.WASI_FILETYPE_DIRECTORY,
    nlink: 1n,
    size: 0n,
    mtim: 0n,
    atim: 0n,
    ctim: 0n,
  };

  constructor(protected pid: number) {}

  getFilestat(): Filestat {
    return AbstractProcDirectory.filestat;
  }

  abstract listNodes(): { err: number; nodes: Record<string, ProcNode> };
  abstract getNode(path: string): { err: number; node?: ProcNode };
}

class MountinfoFile extends AbstractProcFile {
  read(): string {
    return (
      Object.entries(processManager.filesystem.getMounts())
        .map(([mountPoint, fs]) => `${mountPoint} ${fs.constructor.name}`)
        .join("\n") + "\n"
    );
  }
}

class SelfSymlink extends AbstractProcSymlink {
  constructor(private pid: number) {
    super();
  }

  read(): string {
    return this.pid.toString();
  }
}

class TopLevelDirectory extends AbstractProcDirectory {
  static specialNodes: Record<string, new (pid: number) => ProcNode> = {
    self: SelfSymlink,
  };

  listNodes(): { err: number; nodes: Record<string, ProcNode> } {
    let nodes: Record<string, ProcNode> = {};

    for (const [name, callback] of Object.entries(
      TopLevelDirectory.specialNodes
    ))
      nodes[name] = new callback(this.pid);

    for (const pid of Object.keys(processManager.processInfos))
      nodes[pid.toString()] = new ProcessDirectory(Number(pid));

    return {
      err: constants.WASI_ESUCCESS,
      nodes,
    };
  }

  getNode(name: string): { err: number; node?: ProcNode } {
    if (name === "") {
      return { err: constants.WASI_ESUCCESS, node: this };
    }

    const num = Number(name);
    if (!isNaN(num)) {
      if (processManager.processInfos[num] !== undefined) {
        return {
          err: constants.WASI_ESUCCESS,
          node: new ProcessDirectory(num),
        };
      }
    } else if (name === "self") {
      return {
        err: constants.WASI_ESUCCESS,
        node: new SelfSymlink(this.pid),
      };
    }
    return {
      err: constants.WASI_ENOENT,
      node: undefined,
    };
  }
}

class ProcessDirectory extends AbstractProcDirectory implements ProcNode {
  static specialNodes: Record<string, new (pid: number) => ProcNode> = {
    mountinfo: MountinfoFile,
  };

  listNodes(): { err: number; nodes: Record<string, ProcNode> } {
    let nodes: Record<string, ProcNode> = {};

    for (const [name, callback] of Object.entries(
      ProcessDirectory.specialNodes
    ))
      nodes[name] = new callback(this.pid);

    return {
      err: constants.WASI_ESUCCESS,
      nodes,
    };
  }

  getNode(name: string): { err: number; node?: ProcNode } {
    switch (name) {
      case "mountinfo":
        return {
          err: constants.WASI_ESUCCESS,
          node: new MountinfoFile(),
        };
      default:
        return {
          err: constants.WASI_ENOENT,
          node: undefined,
        };
    }
  }
}
