import * as constants from "./constants.js";
import { EventSource } from "./devices.js";
import { TopLevelFs } from "./filesystem/top-level-fs";
import { Descriptor } from "./filesystem/filesystem";
import { BufferRequest, PollEntry, HtermEventSub } from "./types.js";
import syscallCallback from "./syscalls.js";

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
  private fdt: Record<number, Descriptor> = {};
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

  tearDown() {
    Promise.all(
      Object.values(this.fdt).map(async (fileDescriptor) => {
        fileDescriptor?.close();
      })
    );
  }
}

class ProcessInfo {
  public bufferRequestQueue: BufferRequest[] = [];
  public stdinPollSub: PollEntry | null = null;
  public terminationNotifier: EventSource | null = null;

  public shouldEcho = true;

  public timestamp: number;

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
    public isJob: boolean
  ) {
    this.timestamp = Math.floor(new Date().getTime() / 1000);
  }
}

class PubSubEvent {
  public subsTable: Array<Set<HtermEventSub>>;

  constructor() {
    this.subsTable = new Array<Set<HtermEventSub>>(
      constants.WASI_EXT_EVENTS_NUM
    );
    for (var i = 0; i < this.subsTable.length; i++) {
      this.subsTable[i] = new Set<HtermEventSub>([]);
    }
  }

  subscribeEvent(sub: HtermEventSub, events: bigint) {
    for (var i = 0; i < this.subsTable.length; i++) {
      if ((BigInt(events) & (BigInt(1n) << BigInt(i))) !== 0n) {
        this.subsTable[i].add(sub as HtermEventSub);
      }
    }
  }

  unsubscribeEvent(sub: HtermEventSub, events: bigint) {
    for (var i = 0; i < this.subsTable.length; i++) {
      if ((BigInt(events) & (BigInt(1n) << BigInt(i))) !== 0n) {
        if (!this.subsTable[i].delete(sub)) {
          var { processId, eventSourceFd } = sub;
          console.log(
            `PubSubEvent: attemp to unsubscribe process=${processId} fd=${eventSourceFd} that wasn't subcribed`
          );
        }
      }
    }
  }

  publishEvent(events: bigint) {
    for (var i = 0; i < this.subsTable.length; i++) {
      if ((BigInt(events) & (BigInt(1n) << BigInt(i))) != 0n) {
        for (const { processId, eventSourceFd } of this.subsTable[i]) {
          let fd = eventSourceFd;
          if (fd instanceof EventSource) {
            fd.sendEvents(events);
          } else {
            console.log(
              `PubSubEvent: there is fd=${fd} that is not EventSource object in fds table of process=${processId}`
            );
          }
        }
      }
    }
  }
}

export default class ProcessManager {
  public nextProcessId = 0;
  public processInfos: Record<number, ProcessInfo> = {};
  public compiledModules: Record<string, WebAssembly.Module> = {};
  public events: PubSubEvent = new PubSubEvent();

  constructor(
    private readonly scriptName: string,
    public readonly filesystem: TopLevelFs
  ) {}

  async spawnProcess(
    parentId: number | null,
    parentLock: Int32Array | null,
    command: string,
    fds: FdTable,
    args: string[],
    env: Record<string, string>,
    isJob: boolean,
    workingDir: string
  ): Promise<number> {
    const id = this.nextProcessId;
    this.nextProcessId += 1;
    const worker = new Worker(this.scriptName, { type: "module" });
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
      isJob
    );
    if (
      parentId == null ||
      (parentId === this.currentProcess && parentLock != null)
    ) {
      this.currentProcess = id;
    }
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
      ) != 0n
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

    process.worker.terminate();
    // notify parent that they can resume operation
    if (id !== 0 && process.parentLock != null) {
      Atomics.store(process.parentLock, 0, exitNo);
      Atomics.notify(process.parentLock, 0);
    }
    // remove process from process array
    delete this.processInfos[id];
  }

  sendSigInt(id: number) {
    // TODO: adapt this to new current process notion
    // let currentProcess = this.currentProcess;
    // if (
    //   currentProcess === 0 ||
    //   this.processInfos[currentProcess].cmd === "/usr/bin/wash"
    // ) {
    //   console.log(`Ctrl-C sent to PROCESS ${this.currentProcess}`);
    //   this.events.publishEvent(constants.WASI_EVENT_SIGINT);
    // } else {
    //   this.terminateProcess(id, constants.EXIT_INTERRUPTED);
    // }
    this.terminateProcess(id);
  }

  sendEndOfFile(id: number, lockValue: number) {
    const worker = this.processInfos[id];
    if (worker.bufferRequestQueue.length !== 0) {
      const { lck } = worker.bufferRequestQueue[0];
      Atomics.store(lck, 0, lockValue);
      Atomics.notify(lck, 0);
    }
  }
}
