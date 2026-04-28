import * as constants from "../../constants.js";
import ProcessManager from "../../process-manager.js";
import { Filestat, getInodeRandom } from "../filesystem.js";

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
  private static get filestat() {
    return {
      dev: 1n,
      ino: getInodeRandom(),
      filetype: constants.WASI_FILETYPE_SYMBOLIC_LINK,
      nlink: 1n,
      size: 0n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    };
  }

  constructor() {}

  getFilestat() {
    return AbstractProcSymlink.filestat;
  }

  abstract read(): string;
}

abstract class AbstractProcFile implements ProcFile {
  private static get filestat() {
    return {
      dev: 1n,
      ino: getInodeRandom(),
      filetype: constants.WASI_FILETYPE_REGULAR_FILE,
      nlink: 1n,
      size: 0n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    };
  }

  getFilestat(): Filestat {
    return AbstractProcFile.filestat;
  }

  abstract read(): string;
}

abstract class AbstractProcDirectory implements ProcDirectory {
  private static get filestat() {
    return {
      dev: 1n,
      ino: getInodeRandom(),
      filetype: constants.WASI_FILETYPE_DIRECTORY,
      nlink: 1n,
      size: 0n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    };
  }

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
        .map(([mountPoint, fs]) => `${mountPoint} ${fs.fsname()}`)
        .join("\n") + "\n"
    );
  }
}

class MeminfoFile extends AbstractProcFile {
  // kB in /proc/meminfo means kiB
  private toKBWithPadding(val: number): string {
    return `${(val / 1024).toFixed(0).toString()} kB`.padStart(10, " ");
  }

  read(): string {
    const totalMemory = (performance as any).memory.jsHeapSizeLimit;
    const usedMemory = (performance as any).memory.usedJSHeapSize;
    const freeMemory = totalMemory - usedMemory;

    let output = "";

    output += `MemTotal:        ${this.toKBWithPadding(totalMemory)}\n`;
    output += `MemFree:         ${this.toKBWithPadding(freeMemory)}\n`;
    output += `MemAvailable:    ${this.toKBWithPadding(freeMemory)}\n`;

    return output;
  }
}

class StatusFile extends AbstractProcFile {
  constructor(private pid: number) {
    super();
  }

  read(): string {
    const processInfo = processManager.processInfos[this.pid];

    const cmd = processInfo.cmd.split("/");
    const name = cmd[cmd.length - 1];

    // Normally init system has pid of 1 and ppid of 0 (the scheduler)
    // but for us init is at pid 0 and ppid null, which will be mapped to -1 here
    const status =
      `Name:\t${name}\n` +
      `State:\tR (running)\n` +
      `Pid:\t${this.pid}\n` +
      `PPid:\t${processInfo.parentId ?? -1}\n`;

    return status;
  }
}

// This mimics proc_pid_stat file up to starttime
// with many of the values hardcoded to placeholders
class StatFile extends AbstractProcFile {
  constructor(private pid: number) {
    super();
  }

  read(): string {
    const info = processManager.processInfos[this.pid];
    const cmdPath = info.cmd.split("/");
    const comm = cmdPath[cmdPath.length - 1];

    const startTime = info.timestamp;

    const currentTime = new Date().getTime();
    const utime = currentTime - startTime;
    // we do not differentiate between kernel time and user time,
    // so these two are the same for now
    const stime = utime;

    let cutime = 0;
    const cstime = cutime;

    let tty = info.foreground;
    let ttyNumber = 0;

    if (tty !== null) {
      ttyNumber |= tty.min & 0xff;
      ttyNumber |= tty.maj << 8;
      ttyNumber |= (tty.min & ~0xff) << 12;
    }

    return `${info.id} (${comm}) R ${info.parentId ?? -1} 0 0 ${ttyNumber} 0 0 0 0 0 0 ${utime} ${stime} ${cutime} ${cstime} -2 0 1 0 ${startTime}\n`;
  }
}

class EnvironFile extends AbstractProcFile {
  constructor(private pid: number) {
    super();
  }

  read(): string {
    const env = processManager.processInfos[this.pid].env;
    let envString = "";

    for (const [key, value] of Object.entries(env))
      envString += `${key}=${value}\0`;

    return envString;
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

class CwdSymlink extends AbstractProcSymlink {
  constructor(private pid: number) {
    super();
  }

  read(): string {
    return processManager.processInfos[this.pid].cwd;
  }
}

export class TopLevelDirectory extends AbstractProcDirectory {
  static specialNodes: Record<string, new (pid: number) => ProcNode> = {
    self: SelfSymlink,
  };

  listNodes(): { err: number; nodes: Record<string, ProcNode> } {
    let nodes: Record<string, ProcNode> = {};

    for (const [name, callback] of Object.entries(
      TopLevelDirectory.specialNodes,
    ))
      nodes[name] = new callback(this.pid);

    for (const pid of Object.keys(processManager.processInfos))
      nodes[pid.toString()] = new ProcessDirectory(Number(pid));

    if ((performance as any).memory !== undefined) {
      // Add meminfo only for browsers that support memory.performance API
      // (so Chromium-based)
      nodes["meminfo"] = new MeminfoFile();
    }

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
    } else if (
      name === "meminfo" &&
      (performance as any).memory !== undefined
    ) {
      return {
        err: constants.WASI_ESUCCESS,
        node: new MeminfoFile(),
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
    status: StatusFile,
    environ: EnvironFile,
    stat: StatFile,
    cwd: CwdSymlink,
  };

  listNodes(): { err: number; nodes: Record<string, ProcNode> } {
    let nodes: Record<string, ProcNode> = {};

    for (const [name, callback] of Object.entries(
      ProcessDirectory.specialNodes,
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
      case "status":
        return {
          err: constants.WASI_ESUCCESS,
          node: new StatusFile(this.pid),
        };
      case "environ":
        return {
          err: constants.WASI_ESUCCESS,
          node: new EnvironFile(this.pid),
        };
      case "stat":
        return {
          err: constants.WASI_ESUCCESS,
          node: new StatFile(this.pid),
        };
      case "cwd":
        return {
          err: constants.WASI_ESUCCESS,
          node: new CwdSymlink(this.pid),
        };
      default:
        return {
          err: constants.WASI_ENOENT,
          node: undefined,
        };
    }
  }
}
