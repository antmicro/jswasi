import * as constants from "./constants.js";
import { EventSource, EventSourceDescriptor } from "./devices.js";
import { TopLevelFs } from "./filesystem/top-level-fs";
import { Descriptor } from "./filesystem/filesystem";
import { EventType } from "./types.js";
import syscallCallback from "./syscalls.js";
import { DriverManager } from "./filesystem/virtual-filesystem/driver-manager.js";
import { TerminalDriver } from "./filesystem/virtual-filesystem/terminals/terminal.js";

export const DEFAULT_WORK_DIR = "/home/ant";
export const DEFAULT_ENV = {
  PATH: "/usr/bin:/usr/local/bin",
  PWD: DEFAULT_WORK_DIR,
  OLDPWD: DEFAULT_WORK_DIR,
  TMPDIR: "/tmp",
  TERM: "xterm-256color",
  HOME: DEFAULT_WORK_DIR,
  SHELL: "/usr/bin/wash",
  LANG: "en_US.UTF-8",
  USER: "ant",
  HOSTNAME: "browser",
  PYTHONHOME: "/",
  PS1: "\x1b[1;34m\\u@\\h \x1b[1;33m\\w$\x1b[0m ",
  DEBUG: "1",
};

export class FdTable {
  fdt: Record<number, Descriptor> = {};
  private freeFds: number[] = [];
  private topFd: number;

  constructor(fds: Record<number, Descriptor | undefined>) {
    this.fdt = { ...fds };
    this.topFd = Object.keys(fds).length - 1;
  }

  public clone(): FdTable {
    var fdTable = new FdTable([]);
    fdTable.freeFds = this.freeFds.slice(0);
    // TODO: It is temporary fix, we should look at fd_flags here
    for (let key in this.fdt) {
      if (!(this.fdt[key] instanceof EventSource)) {
        fdTable.fdt[key] = this.fdt[key];
      } else {
        fdTable.freeFds.push(Number(key));
      }
    }
    fdTable.freeFds.sort();
    fdTable.topFd = this.topFd;
    return fdTable;
  }

  public addFile(entry: Descriptor): number {
    if (entry === undefined) {
      throw "Entry is undefined";
    }
    const fd = this.freeFds.shift();
    if (fd !== undefined) {
      this.fdt[fd] = entry;
      return fd;
    } else {
      this.fdt[++this.topFd] = entry;
      return this.topFd;
    }
  }

  public freeFd(fd: number) {
    if (!(fd in this.fdt)) {
      throw "descriptor not present in descriptor table";
    }
    delete this.fdt[fd];
    this.freeFds.push(fd);
  }

  public replaceFd(fd: number, entry: Descriptor) {
    if (!(fd in this.fdt)) {
      throw "descriptor not present in descriptor table";
    }
    if (entry === undefined) {
      throw "Entry is undefined";
    }
    this.fdt[fd] = entry;
  }

  public getFd(fd: number): Descriptor {
    return this.fdt[fd];
  }

  public moveFd(srcFd: number, dstFd: number) {
    let idx = this.freeFds.findIndex((element) => element == dstFd);
    if (idx !== undefined) {
      this.freeFds.splice(idx, idx);
    } else if (this.topFd <= dstFd) {
      while (this.topFd < dstFd) {
        this.freeFds.push(this.topFd);
        this.topFd++;
      }
      this.topFd++;
    }
    // We suppose dstFd is closed!
    this.fdt[dstFd] = this.fdt[srcFd];
    delete this.fdt[srcFd];
  }

  tearDown() {
    Promise.all(
      Object.values(this.fdt).map(async (fileDescriptor) => {
        fileDescriptor?.close();
      })
    );
  }
}

type Foreground = { maj: number; min: number } | null;

class ProcessInfo {
  public shouldEcho = true;
  public terminationNotifier: EventSource | null = null;
  public timestamp: number;
  children: number[];

  constructor(
    public id: number,
    public cmd: string,
    public worker: Worker,
    public fds: FdTable,
    public parentId: number | null,
    public parentLock: Int32Array | null,
    public callback: (
      event: MessageEvent,
      processManager: ProcessManager
    ) => Promise<void>,
    public env: Record<string, string>,
    public cwd: string,
    public isJob: boolean,
    public foreground: Foreground
  ) {
    this.timestamp = Math.floor(new Date().getTime() / 1000);
    this.children = [];
  }
}

export default class ProcessManager {
  public nextProcessId = 0;
  public processInfos: Record<number, ProcessInfo> = {};
  public compiledModules: Record<string, WebAssembly.Module> = {};

  constructor(
    private readonly scriptName: string,
    public readonly filesystem: TopLevelFs,
    public driverManager: DriverManager
  ) {}

  async spawnProcess(
    parentId: number | null,
    parentLock: Int32Array | null,
    command: string,
    fds: FdTable,
    args: string[],
    env: Record<string, string>,
    isJob: boolean,
    workingDir: string,
    foreground: Foreground = null
  ): Promise<number> {
    const id = this.nextProcessId;
    this.nextProcessId += 1;
    const worker = new Worker(this.scriptName, { type: "module" });

    if (foreground === null)
      foreground = this.processInfos[parentId].foreground;

    if (parentId !== null) {
      this.processInfos[parentId].children.push(id);

      if (parentLock !== null) this.processInfos[parentId].foreground = null;
    }

    if (foreground !== null) {
      const __driver = this.driverManager.getDriver(foreground.maj);
      (__driver as TerminalDriver).terminals[foreground.min].foregroundPid = id;
    }

    this.processInfos[id] = new ProcessInfo(
      id,
      command,
      worker,
      fds,
      parentId,
      parentLock,
      syscallCallback,
      env,
      workingDir,
      isJob,
      foreground
    );
    worker.onmessage = (event) => syscallCallback(event, this);

    // save compiled module to cache
    // TODO: this will run into trouble if file is replaced after first usage (cached version will be invalid)
    try {
      if (!this.compiledModules[command]) {
        const { err, desc } = await this.filesystem.open(
          command,
          constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW
        );
        if (err !== constants.WASI_ESUCCESS) {
          console.error(`No such binary: ${command}`);
          return err;
        }

        this.compiledModules[command] = await WebAssembly.compile(
          (
            await desc.arrayBuffer()
          ).buffer
        );
      }
    } catch (e) {
      let errno;
      if (
        (e as Error).message ===
        "WebAssembly.compile(): BufferSource argument is empty"
      ) {
        errno = constants.WASI_ESUCCESS;
      } else {
        errno = constants.WASI_ENOEXEC;
      }
      await this.terminateProcess(id, errno);
      throw Error("invalid binary");
    }

    if (
      !isJob &&
      parentId != null &&
      this.processInfos[parentId].terminationNotifier !== null &&
      this.processInfos[parentId].terminationNotifier.obtainEvents(
        constants.WASI_EXT_EVENT_SIGINT
      ) != constants.WASI_EXT_NO_EVENT
    ) {
      this.terminateProcess(id, constants.EXIT_INTERRUPTED);
    } else {
      // TODO: pass module through SharedArrayBuffer to save on copying time (it seems to be a big bottleneck)
      this.processInfos[id].worker.postMessage([
        "start",
        this.compiledModules[command],
        id,
        args,
        env,
      ]);
    }

    return id;
  }

  async terminateProcess(id: number, exitNo: number = 0) {
    const process = this.processInfos[id];

    // close/flush all opened files to make sure written contents are saved to persistent storage
    this.processInfos[id].fds.tearDown();

    if (process.parentId !== null) {
      this.processInfos[this.processInfos[id].parentId].foreground =
        process.foreground;
      this.processInfos[process.parentId].children.splice(
        process.children.indexOf(id),
        1
      );

      // Pass foreground process id to the terminal driver
      if (process.foreground !== null) {
        const __driver = this.driverManager.getDriver(process.foreground.maj);
        (__driver as TerminalDriver).terminals[
          process.foreground.min
        ].foregroundPid = process.parentId;
      }
    }

    process.worker.terminate();
    process.children.forEach((child) =>
      this.terminateProcess(child, 128 + constants.WASI_SIGKILL)
    );

    // notify parent that they can resume operation
    if (id !== 0 && process.parentLock != null) {
      Atomics.store(process.parentLock, 0, exitNo);
      Atomics.notify(process.parentLock, 0);
    }
    // remove process from process array
    delete this.processInfos[id];
  }

  publishEvent(events: EventType, pid: number) {
    // If sigint is published and target process doesn't override SIGINT, terminate process
    if (
      events & constants.WASI_EXT_EVENT_SIGINT &&
      !this.processInfos[pid].terminationNotifier
    ) {
      this.terminateProcess(pid, 128 + constants.WASI_EXT_EVENT_SIGINT);
      return;
    }

    // events are stored only in contexts of event source descriptors
    // if a new event source is opened, it won't be able to read events
    // that happened in the past
    for (const desc of Object.values(this.processInfos[pid].fds.fdt)) {
      if (desc instanceof EventSource) {
        desc.sendEvents(events);
      }
    }
  }

  attachSigint(fd: number, pid: number): number {
    const eventDesc = this.processInfos[pid].fds.getFd(fd);
    if (eventDesc === undefined) return constants.WASI_EBADF;

    if (!(eventDesc instanceof EventSource)) return constants.WASI_EINVAL;

    let stat;
    new Promise(
      (resolve: (ev: EventSourceDescriptor) => void, reject: () => void) => {
        stat = eventDesc.makeNotifier({ resolve, reject });

        if (stat === constants.WASI_ESUCCESS)
          this.processInfos[pid].terminationNotifier = eventDesc;
      }
    ).then((ev: EventSourceDescriptor) => {
      if (
        this.processInfos[pid] !== undefined &&
        this.processInfos[pid].terminationNotifier === ev
      )
        this.processInfos[pid].terminationNotifier = null;
    });

    return stat;
  }
}
