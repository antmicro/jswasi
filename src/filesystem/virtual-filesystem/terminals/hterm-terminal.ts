// @ts-ignore
import * as vfs from "../../../vendor/vfs.js";
import * as termios from "./termios.js";
import {
  TerminalDriver,
  Terminal,
  BufferRequest,
  ioctlRequests,
} from "./terminal.js";
import {
  DEFAULT_ENV,
  DEFAULT_WORK_DIR,
  DescriptorEntry,
  FdTable,
} from "../../../process-manager.js";
import { PollSub, Fdflags, Rights, Descriptor } from "../../filesystem.js";
import { UserData, EventType, PollEvent } from "../../../types.js";
import * as constants from "../../../constants.js";
import { getFilesystem } from "../../top-level-fs.js";
import { AbstractVirtualDeviceDescriptor } from "./../device-filesystem.js";
import ProcessManager from "../../../process-manager.js";

type InitDeviceArgs = {
  terminal: any;
};

export type InitDriverArgs = { processManager: ProcessManager };

class Hterm implements Terminal {
  foregroundPid: number | null;
  bufRequestQueue: BufferRequest[];
  termios: termios.Termios;
  subs: PollSub[];

  buffer: string;

  raw: boolean;
  echo: boolean;

  constructor(public terminal: any) {
    this.buffer = "";
    this.bufRequestQueue = [];
    this.subs = [];
    this.foregroundPid = null;

    this.echo = false;
    this.raw = true;

    this.termios = {
      iFlag:
        termios.IGNBRK |
        termios.BRKINT |
        termios.PARMRK |
        // It zeroes eighth bit of each byte, I suppose it shoulde be disabled by default
        //termios.ISTRIP |
        termios.INLCR |
        termios.IGNCR |
        termios.ICRNL |
        termios.IXON,
      oFlag: termios.OPOST,
      cFlag: termios.CS8 | termios.PARENB,
      lFlag:
        termios.ECHO |
        termios.ECHONL |
        termios.ICANON |
        termios.ISIG |
        termios.IEXTEN,
    } as termios.Termios;
  }

  splitBuf(len: number): string {
    let out = this.buffer.slice(0, len);
    this.buffer = this.buffer.slice(len);
    return out;
  }

  async getScreenSize(): Promise<[number, number]> {
    return [this.terminal.screenSize.width, this.terminal.screenSize.height];
  }
}

export class HtermDeviceDriver implements TerminalDriver {
  private maxTty: number;
  private freedTerminals: number[];
  private processManager: ProcessManager;

  terminals: Record<number, Hterm>;

  async initDriver(args: Object): Promise<number> {
    const __args = args as InitDriverArgs;

    this.processManager = __args.processManager;
    this.terminals = [];
    this.freedTerminals = [];
    this.maxTty = 0;
    return constants.WASI_ESUCCESS;
  }

  private __initFsaDropImport(
    min: number,
    terminalContentWindow: Window,
    notifyDroppedFileSaved: (path: string, entryName: string) => void,
    processManager: ProcessManager
  ) {
    terminalContentWindow.addEventListener(
      "dragover",
      function handleDragOver(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer!.dropEffect = "copy";
      },
      false
    );

    const __this = this;
    terminalContentWindow.addEventListener("drop", async function (evt) {
      evt.stopPropagation();
      evt.preventDefault();
      const pwd =
        processManager.processInfos[__this.terminals[min].foregroundPid].cwd;

      await Promise.all(
        (Object.values(evt.dataTransfer!.items) || []).map(async (item) => {
          let handle = (await item.getAsFileSystemHandle())!;
          let path = `${pwd}/${handle.name}`;
          if (handle.kind === "file") {
            const stream = (
              await (handle as FileSystemFileHandle).getFile()
            ).stream();
            const result = await processManager.filesystem.open(
              path,
              constants.WASI_O_CREAT
            );
            if (result.err !== constants.WASI_ESUCCESS) {
              return;
            }
            const { err: __err, stream: writableStream } =
              await result.desc.writableStream();
            return new Promise<void>(async (resolve) => {
              // @ts-ignore
              await stream.pipeTo(writableStream);
              if (notifyDroppedFileSaved)
                notifyDroppedFileSaved(path, handle.name);
              resolve();
            });
          } else if (handle.kind === "directory") {
            // TODO: use some kind of uuid in mount point names
            const tmp_mount = `/tmp/temp_mount_${handle.name}`;
            await processManager.filesystem.createDir(tmp_mount);
            let { err, filesystem } = await getFilesystem("fsa", {
              dir: handle,
              keepMetadata: false,
            });
            if (err !== constants.WASI_ESUCCESS) {
              return;
            }
            await processManager.filesystem.addMountFs(tmp_mount, filesystem);
            // this process is spawned as a child of init, this isn't very elegant
            await processManager.spawnProcess(
              0, // parent_id
              null, // parent_lock
              "/usr/bin/wash",
              new FdTable({
                // TODO: replace with /dev/null once it is implemented
                0: undefined,
                1: undefined,
                2: undefined,
                3: new DescriptorEntry(
                  (
                    await processManager.filesystem.open("/")
                  ).desc
                ),
              }),
              [
                "/usr/bin/wash",
                "-c",
                `cp -r ${tmp_mount} ${path} ; umount ${tmp_mount}`,
              ],
              DEFAULT_ENV,
              false,
              DEFAULT_WORK_DIR
            );
          }
        })
      );
    });
  }

  private __initTerminal(terminal: any): Hterm {
    const __hterm = new Hterm(terminal);
    __hterm.terminal.installKeyboard();
    __hterm.terminal.keyboard.bindings.addBindings({
      "Ctrl-R": "PASS",
    });
    const onTerminalInput = (data: string): void => {
      let code = data.charCodeAt(0);
      let iFlag = __hterm.termios.iFlag;

      if (code === 0 && data.length > 1 && data.charCodeAt(1) === 0) {
        const breakOffset = this.detectBreakCondition(data);

        if ((iFlag & termios.IGNBRK) !== 0) {
          if ((iFlag & termios.BRKINT) !== 0) {
            if ((iFlag & termios.PARMRK) === 0) {
              __hterm.buffer += "\x00";
            } else {
              __hterm.buffer += "\xFF\x00\x00";
            }
          } else {
            // TODO: Flush input and output buffers and it should be sent
            // SIGINT to foreground process group
          }
        }

        if (breakOffset === data.length) {
          // TODO: jump to flushing procedure
        } else {
          data = data.slice(breakOffset);
          code = data.charCodeAt(0);
        }
      }

      if ((iFlag & termios.ISTRIP) !== 0) {
        data = this.stripOffBytes(data);
        code = data.charCodeAt(0);
      }

      if (code === 13) {
        code = 10;
        data = String.fromCharCode(10);
      }

      if (code === 3 || code === 4 || code === 81) {
        // control characters
        if (__hterm.foregroundPid !== null) {
          if (code === 3) {
            this.processManager.publishEvent(
              constants.WASI_EXT_EVENT_SIGINT,
              __hterm.foregroundPid
            );
          } else if (code === 4) {
            // this.processManager.sendEndOfFile(currentProcessId, -1);
            for (const req of __hterm.bufRequestQueue) {
              if (req.pid === __hterm.foregroundPid) {
                req.resolve({
                  err: constants.WASI_ESUCCESS,
                  buffer: new ArrayBuffer(0),
                });
              }
            }
          }
        }
      } else {
        // regular characters
        __hterm.buffer += data;
      }

      if (__hterm.bufRequestQueue.length !== 0) {
        let request = __hterm.bufRequestQueue.shift();

        request!.resolve({
          err: constants.WASI_ESUCCESS,
          buffer: new TextEncoder().encode(__hterm.splitBuf(request!.len)),
        });
      }

      for (const sub of __hterm.subs) {
        sub.resolve({
          userdata: sub.userdata,
          error: constants.WASI_ESUCCESS,
          nbytes: BigInt(__hterm.buffer.length),
          eventType: constants.WASI_EVENTTYPE_FD_READ,
        });
      }
      __hterm.subs.length = 0;

      if (__hterm.echo && (code === 10 || code >= 32)) {
        __hterm.terminal.io.print(code === 10 ? "\r\n" : data);
      }
    };
    const io = __hterm.terminal.io.push();
    io.onVTKeystroke = onTerminalInput;
    io.sendString = onTerminalInput;

    // TODO: maybe save all output and rewrite it on adjusted size?
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    io.onTerminalResize = (_columns: number, _rows: number) => {
      if (__hterm.foregroundPid !== null)
        this.processManager.publishEvent(
          constants.WASI_EXT_EVENT_WINCH,
          __hterm.foregroundPid
        );
    };
    return __hterm;
  }

  async initDevice(_min: number, args: Object): Promise<number> {
    const __args = args as InitDeviceArgs;
    let __ttyMin = this.freedTerminals.pop();

    if (!__ttyMin) {
      __ttyMin = this.maxTty++;
    }

    const __term = this.__initTerminal(__args.terminal);
    this.terminals[__ttyMin] = __term;
    this.__initFsaDropImport(
      __ttyMin,
      __args.terminal.div_.getElementsByTagName("iframe")[0].contentWindow!,
      () => {},
      this.processManager
    );
    return constants.WASI_ESUCCESS;
  }

  async teardownDevice(min: number): Promise<number> {
    if (this.terminals[min]) {
      delete this.terminals[min];
      this.freedTerminals.push(min);
      return constants.WASI_ESUCCESS;
    } else {
      return constants.WASI_ENOENT;
    }
  }

  async teardownDriver(): Promise<number> {
    return constants.WASI_ESUCCESS;
  }

  async getDesc(
    min: number,
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev
  ): Promise<{ desc?: Descriptor; err: number }> {
    const __term = this.terminals[min];
    if (__term === undefined) {
      return {
        err: constants.WASI_ENODEV,
        desc: undefined,
      };
    }
    return {
      err: constants.WASI_ESUCCESS,
      desc: new VirtualHtermDescriptor(
        fs_flags,
        fs_rights_base,
        fs_rights_inheriting,
        ino,
        this.terminals[min]
      ),
    };
  }

  // Auxiliary function to print uncaught exceptions to all terminals
  async wrapCallback(callback: () => Promise<void>) {
    try {
      await callback();
    } catch (e) {
      Object.values(this.terminals).forEach((terminal) => {
        terminal.terminal.io.println(
          `[ERROR] Unrecoverable kernel error: ${e}`
        );
      });
      throw e;
    }
  }

  private detectBreakCondition(data: string): number {
    for (let i = 2; i < data.length; ++i) {
      if (data.charCodeAt(i) !== 0) {
        return i;
      }
    }

    return data.length;
  }

  private stripOffBytes(data: string): string {
    let stripped = "";
    for (let i = 0; i < data.length; ++i) {
      let c = data.charCodeAt(i);
      stripped += String.fromCharCode(c & 0x7f)[0];
    }
    return stripped;
  }
}

class VirtualHtermDescriptor extends AbstractVirtualDeviceDescriptor {
  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: vfs.CharacterDev,
    private hterm: Hterm
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
  }

  isatty(): boolean {
    return true;
  }

  override async write(
    buffer: ArrayBuffer
  ): Promise<{ err: number; written: bigint }> {
    const replaced = new TextDecoder().decode(buffer).replaceAll("\n", "\r\n");
    this.hterm.terminal.io.print(replaced);
    if (window.stdoutAttached) {
      window.buffer += replaced;
    }
    return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
  }

  override async read(
    len: number,
    workerId: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    if (this.hterm.buffer.length !== 0) {
      return {
        err: constants.WASI_ESUCCESS,
        buffer: new TextEncoder().encode(this.hterm.splitBuf(len)),
      };
    } else if (this.fdstat.fs_flags & constants.WASI_FDFLAG_NONBLOCK) {
      return {
        err: constants.WASI_ESUCCESS,
        buffer: new ArrayBuffer(0),
      };
    } else {
      // Return custom promise which is resolved in onTerminalInput hterm callback
      return new Promise<{ err: number; buffer: ArrayBuffer }>((resolve) => {
        this.hterm.bufRequestQueue.push({
          len,
          pid: workerId,
          resolve,
        });
      });
    }
  }

  override async ioctl(request: number, buf: Uint8Array): Promise<number> {
    let err = constants.WASI_ENOBUFS;

    switch (request) {
      case ioctlRequests.GET_SCREEN_SIZE: {
        if (buf.byteLength < 8) break;

        const [width, height] = await this.hterm.getScreenSize();
        const __buf = new Int32Array(buf.buffer, buf.byteOffset);

        __buf[0] = width;
        __buf[1] = height;

        err = constants.WASI_ESUCCESS;
        break;
      }
      case ioctlRequests.SET_ECHO: {
        if (buf.byteLength < 1) err = constants.WASI_ENOBUFS;

        this.hterm.echo = buf[0] !== 0;

        err = constants.WASI_ESUCCESS;
        break;
      }
      case ioctlRequests.SET_RAW: {
        if (buf.byteLength < 1) break;

        this.hterm.raw = buf[0] !== 0;

        err = constants.WASI_ESUCCESS;
        break;
      }
      default: {
        err = constants.WASI_EINVAL;
        break;
      }
    }
    return err;
  }

  override addPollSub(
    userdata: UserData,
    eventType: EventType,
    workerId: number
  ): Promise<PollEvent> {
    switch (eventType) {
      case constants.WASI_EVENTTYPE_FD_WRITE: {
        return Promise.resolve({
          userdata,
          error: constants.WASI_ESUCCESS,
          eventType,
          nbytes: 0n,
        });
      }
      case constants.WASI_EVENTTYPE_FD_READ: {
        if (this.hterm.buffer.length === 0) {
          return new Promise((resolve: (event: PollEvent) => void) => {
            this.hterm.subs.push({
              pid: workerId,
              userdata,
              tag: eventType,
              resolve,
            });
          });
        }
        return Promise.resolve({
          userdata,
          error: constants.WASI_ESUCCESS,
          eventType,
          nbytes: BigInt(this.hterm.buffer.length),
        });
      }
      default: {
        return Promise.resolve({
          userdata,
          error: constants.WASI_EINVAL,
          eventType: constants.WASI_EXT_NO_EVENT,
          nbytes: 0n,
        });
      }
    }
  }
}
