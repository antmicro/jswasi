// @ts-ignore
import * as vfs from "../../../vendor/vfs.js";
import * as termios from "./termios.js";
import {
  TerminalDriver,
  Terminal,
  Winsize,
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

  driverBuffer: string;
  driverBufferCursor: number;
  userBuffer: string;

  constructor(public terminal: any) {
    this.driverBuffer = "";
    this.driverBufferCursor = 0;
    this.userBuffer = "";
    this.bufRequestQueue = [];
    this.subs = [];
    this.foregroundPid = null;

    this.termios = { ...termios.DEFAULT_HTERM_TERMIOS };

    this.terminal.setInsertMode(true);
  }

  splitBuf(len: number): string {
    let out = this.userBuffer.slice(0, len);
    this.userBuffer = this.userBuffer.slice(len);
    return out;
  }

  getScreenSize(): Winsize {
    let scrollPort = this.terminal.scrollPort_.getScreenSize();
    return {
      cellsWidth: this.terminal.screenSize.width,
      cellsHeight: this.terminal.screenSize.height,
      pxWidth: scrollPort.width,
      pxHeight: scrollPort.height,
    } as Winsize;
  }

  pushDriverInputBuffer(data: string) {
    if ((this.termios.lFlag & termios.ECHO) !== 0) {
      this.terminal.io.print(data);
    }
    this.driverBuffer =
      this.driverBuffer.slice(0, this.driverBufferCursor) +
      data +
      this.driverBuffer.slice(this.driverBufferCursor);
    this.driverBufferCursor += data.length;
  }

  pushNLDriverInputBuffer() {
    this.driverBuffer += "\n";
    if ((this.termios.lFlag & termios.ICANON) !== 0) {
      if (
        (this.termios.lFlag & termios.ECHO) !== 0 ||
        (this.termios.lFlag & termios.ECHONL) !== 0
      ) {
        this.terminal.io.println("");
      }
      this.flushDriverInputBuffer();
    }
  }

  deleteCharDriverInputBuffer() {
    if (this.driverBufferCursor > 0) {
      this.terminal.cursorLeft(1);
      // CSI Ps P  Delete Ps Character(s) (default = 1) (DCH)
      this.terminal.io.print("\x1b[P");
      this.driverBuffer =
        this.driverBuffer.slice(0, this.driverBufferCursor - 1) +
        this.driverBuffer.slice(this.driverBufferCursor);
      this.driverBufferCursor -= 1;
    }
  }

  moveCursorRight() {
    if (this.driverBufferCursor < this.driverBuffer.length) {
      // CSI Ps C  Cursor Forward Ps Times (default = 1) (CUF)
      this.terminal.io.print("\x1b[C");
      this.driverBufferCursor += 1;
    }
  }

  moveCursorLeft() {
    if (this.driverBufferCursor > 0) {
      // CSI Ps D  Cursor Backward Ps Times (default = 1) (CUB)
      this.terminal.io.print("\x1b[D");
      this.driverBufferCursor -= 1;
    }
  }

  flushDriverInputBuffer() {
    this.userBuffer += this.driverBuffer;
    this.driverBuffer = "";
    this.driverBufferCursor = 0;
  }

  resolveUserReadRequests() {
    if (this.userBuffer.length > 0) {
      // In case EOF arrives when line is not empty flush requests
      // until there are data in user buffer
      while (this.userBuffer.length > 0 && this.bufRequestQueue.length > 0) {
        let req = this.bufRequestQueue.shift();
        let buff = this.userBuffer.slice(0, req.len);
        this.userBuffer = this.userBuffer.slice(req.len);

        req.resolve({
          err: constants.WASI_ESUCCESS,
          buffer: new TextEncoder().encode(buff),
        });
      }
    } else {
      // Resolve all foreground process requests with empty buffers
      let foreground_reqs = this.bufRequestQueue.filter(
        (req) => req.pid === this.foregroundPid
      );
      this.bufRequestQueue = this.bufRequestQueue.filter(
        (req) => req.pid !== this.foregroundPid
      );
      foreground_reqs.forEach((req) =>
        req.resolve({
          err: constants.WASI_ESUCCESS,
          buffer: new ArrayBuffer(0),
        })
      );
    }
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
      let iFlag = __hterm.termios.iFlag;
      let cFlag = __hterm.termios.cFlag;
      let lFlag = __hterm.termios.lFlag;

      if ((cFlag & termios.CREAD) === 0) {
        // Discard input
        return;
      }

      if ((iFlag & termios.ISTRIP) !== 0) {
        data = this.stripOffBytes(data);
      }

      while (data.length > 0) {
        let code = data.charCodeAt(0);
        if (code === 0 && data.length > 1 && data.charCodeAt(1) === 0) {
          const breakOffset = this.detectBreakCondition(data);

          if ((iFlag & termios.IGNBRK) === 0) {
            // Do not ignore break condition
            if ((iFlag & termios.BRKINT) === 0) {
              if ((iFlag & termios.PARMRK) === 0) {
                __hterm.driverBuffer += "\x00";
              } else {
                __hterm.driverBuffer += "\xFF\x00\x00";
              }
            } else {
              __hterm.flushDriverInputBuffer();
              // TODO: Send SIGINT to foreground process group
            }
          }

          data = data.slice(breakOffset);
          continue;
        }

        switch (code) {
          // 0x0a - LN
          case 0x0a: {
            if ((lFlag & termios.ICANON) !== 0) {
              if ((iFlag & termios.INLCR) !== 0) {
                if ((iFlag & termios.IGNCR) === 0) {
                  if ((iFlag & termios.ICRNL) !== 0) {
                    __hterm.pushNLDriverInputBuffer();
                  } else {
                    __hterm.pushDriverInputBuffer("\r");
                  }
                }
              } else {
                __hterm.pushNLDriverInputBuffer();
              }
            } else {
              __hterm.pushNLDriverInputBuffer();
            }

            break;
          }
          // 0x0d - CR
          case 0x0d: {
            if ((lFlag & termios.ICANON) !== 0) {
              if ((iFlag & termios.IGNCR) === 0) {
                if ((iFlag & termios.ICRNL) !== 0) {
                  __hterm.pushNLDriverInputBuffer();
                } else {
                  __hterm.pushDriverInputBuffer("\r");
                }
              }
            } else {
              __hterm.pushDriverInputBuffer("\r");
            }

            break;
          }
          // 0x11 - START, 0x13 - STOP
          case 0x11:
          case 0x13: {
            if ((iFlag & termios.IXON) !== 0) {
              if (code === 0x11) {
                // TODO: do not flush driver input buffer
              } else if (code === 0x13) {
                // TODO: flush driver input buffer
              }
            } else {
              __hterm.pushDriverInputBuffer(data[0]);
            }
            break;
          }
          // 0x03 - INTR, 0x1a - SUSP, 0x1c - QUIT
          case 0x03:
          case 0x1a:
          case 0x1c: {
            if ((lFlag & termios.ISIG) !== 0) {
              if (code === 0x03) {
                if (__hterm.foregroundPid !== null) {
                  this.processManager.publishEvent(
                    constants.WASI_EXT_EVENT_SIGINT,
                    __hterm.foregroundPid
                  );
                }
              } else if (code === 0x1a) {
                // TODO: handle SUSP
              } else if (code === 0x1c) {
                // TODO: handle QUIT
              }
            } else {
              __hterm.pushDriverInputBuffer(data[0]);
            }
            break;
          }
          // EOT - end of transmission
          case 0x04: {
            if ((lFlag & termios.ICANON) !== 0) {
              __hterm.flushDriverInputBuffer();
              __hterm.resolveUserReadRequests();
            } else {
              __hterm.pushDriverInputBuffer(data[0]);
            }
            break;
          }
          // KILL - remove line
          case 0x15: {
            if (
              (lFlag & termios.ICANON) !== 0 &&
              (lFlag & termios.ECHOK) !== 0
            ) {
              // Remove all characters from driver buffer to the left from the cursor
              __hterm.driverBuffer = __hterm.driverBuffer.slice(
                __hterm.driverBufferCursor
              );
              __hterm.terminal.cursorLeft(__hterm.driverBufferCursor);
              __hterm.terminal.io.print(`\x1b[${__hterm.driverBufferCursor}P`);
            } else {
              __hterm.pushDriverInputBuffer(data[0]);
            }
            break;
          }
          // DEL
          case 0x7f: {
            if (
              (lFlag & termios.ICANON) !== 0 &&
              (lFlag & termios.ECHOE) !== 0
            ) {
              __hterm.deleteCharDriverInputBuffer();
            } else {
              __hterm.pushDriverInputBuffer(data[0]);
            }
            break;
          }
          // Start of escape sequence
          case 0x1b: {
            if ((lFlag & termios.ICANON) !== 0) {
              if (data[1] === "[") {
                switch (data[2]) {
                  // Move cursor right
                  case "C": {
                    __hterm.moveCursorRight();
                    break;
                  }
                  // Move cursor left
                  case "D": {
                    __hterm.moveCursorLeft();
                    break;
                  }
                  default: {
                    break;
                  }
                }
                // ignore rest of CSIs, for now...
                data = data.slice(3);
                continue;
              } else {
                // ignore, for now...
                data = data.slice(2);
                continue;
              }
            } else {
              __hterm.pushDriverInputBuffer(data[0]);
            }

            break;
          }
          default: {
            __hterm.pushDriverInputBuffer(data[0]);
            break;
          }
        }

        data = data.slice(1);
      }

      if ((lFlag & termios.ICANON) === 0) {
        __hterm.flushDriverInputBuffer();
      }

      if (__hterm.userBuffer.length > 0) {
        __hterm.resolveUserReadRequests();
      }

      if (__hterm.userBuffer.length > 0) {
        for (const sub of __hterm.subs) {
          sub.resolve({
            userdata: sub.userdata,
            error: constants.WASI_ESUCCESS,
            nbytes: BigInt(__hterm.userBuffer.length),
            eventType: constants.WASI_EVENTTYPE_FD_READ,
          });
        }
        __hterm.subs.length = 0;
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
    const data =
      this.hterm.termios.oFlag & termios.ONLCR
        ? new TextDecoder().decode(buffer).replaceAll("\n", "\r\n")
        : new TextDecoder().decode(buffer);

    this.hterm.terminal.io.print(data);
    if (window.stdoutAttached) {
      window.buffer += data;
    }
    return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
  }

  override async read(
    len: number,
    workerId: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    if (this.hterm.userBuffer.length !== 0) {
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
      case ioctlRequests.TCGETS: {
        if (buf.byteLength < 16) break;

        const __buf = new Int32Array(buf.buffer, buf.byteOffset);

        __buf[0] = this.hterm.termios.iFlag;
        __buf[1] = this.hterm.termios.oFlag;
        __buf[2] = this.hterm.termios.cFlag;
        __buf[3] = this.hterm.termios.lFlag;

        err = constants.WASI_ESUCCESS;
        break;
      }
      case ioctlRequests.TCSETS: {
        if (buf.byteLength < 16) break;

        const __buf = new Int32Array(buf.buffer, buf.byteOffset);

        this.hterm.termios.iFlag = __buf[0];
        this.hterm.termios.oFlag = __buf[1];
        this.hterm.termios.cFlag = __buf[2];
        this.hterm.termios.lFlag = __buf[3];

        err = constants.WASI_ESUCCESS;

        break;
      }
      case ioctlRequests.TIOCGWINSZ: {
        if (buf.byteLength < 8) break;

        const winsize = await this.hterm.getScreenSize();
        const __buf = new Uint16Array(buf.buffer, buf.byteOffset);

        __buf[0] = winsize.cellsHeight;
        __buf[1] = winsize.cellsWidth;
        __buf[2] = winsize.pxWidth;
        __buf[3] = winsize.pxHeight;

        err = constants.WASI_ESUCCESS;
        break;
      }
      default: {
        if (
          ioctlRequests.TCGETS <= request &&
          request <= ioctlRequests.FIOQSIZE &&
          ioctlRequests.TIOCGPTN <= request &&
          request <= ioctlRequests.TIOCGEXCL &&
          ioctlRequests.FIOSETOWN <= request &&
          request <= ioctlRequests.SIOCGSTAMPNS
        ) {
          err = constants.WASI_ENOTSUP;
        } else {
          err = constants.WASI_EINVAL;
        }
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
        if (this.hterm.userBuffer.length === 0) {
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
          nbytes: BigInt(this.hterm.userBuffer.length),
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
