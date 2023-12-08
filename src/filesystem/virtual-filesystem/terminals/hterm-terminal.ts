// @ts-ignore
import * as vfs from "../../../vendor/vfs.js";
// import * as termios from "./termios.js";
import {
  TerminalDriver,
  AbstractTermiosTerminal,
  Winsize,
  ioctlRequests,
} from "./terminal.js";
import { DEFAULT_HTERM_TERMIOS } from "./termios.js";
import {
  DEFAULT_ENV,
  DEFAULT_WORK_DIR,
  DescriptorEntry,
  FdTable,
} from "../../../process-manager.js";
import { Fdflags, Rights, Descriptor } from "../../filesystem.js";
import { UserData, EventType, PollEvent } from "../../../types.js";
import * as constants from "../../../constants.js";
import { getFilesystem } from "../../top-level-fs.js";
import { AbstractVirtualDeviceDescriptor } from "./../device-filesystem.js";
import ProcessManager from "../../../process-manager.js";

type InitDeviceArgs = {
  terminal: any;
};

export type InitDriverArgs = { processManager: ProcessManager };

class Hterm extends AbstractTermiosTerminal {
  constructor(public terminal: any) {
    super({ ...DEFAULT_HTERM_TERMIOS });
    this.terminal.setInsertMode(true);
  }

  protected override printTerminal(data: string): void {
    this.terminal.io.print(data);
  }

  protected override moveCursorRight(shift: number): void {
    let __shift =
      shift >= this.driverBuffer.length - this.driverBufferCursor
        ? this.driverBuffer.length - this.driverBufferCursor
        : shift;

    if (__shift === 0) return;

    // CSI Ps C  Cursor Forward Ps Times (default = 1) (CUF)
    this.terminal.io.print(`\x1b[${__shift}C`);
    this.driverBufferCursor += __shift;
  }

  protected override moveCursorLeft(shift: number): void {
    let __shift =
      shift >= this.driverBufferCursor ? this.driverBufferCursor : shift;

    if (__shift === 0) return;

    // CSI Ps D  Cursor Backward Ps Times (default = 1) (CUB)
    this.terminal.io.print(`\x1b[${__shift}D`);
    this.driverBufferCursor -= __shift;
  }

  protected override removeFromCursorToLeft(toRemove: number): void {
    let __toRemove =
      toRemove >= this.driverBufferCursor ? this.driverBufferCursor : toRemove;

    if (__toRemove === 0) return;

    this.terminal.cursorLeft(__toRemove);
    // CSI Ps P  Delete Ps Character(s) (default = 1) (DCH)
    this.terminal.io.print(`\x1b[${__toRemove}P`);
    this.driverBuffer =
      this.driverBuffer.slice(0, this.driverBufferCursor - __toRemove) +
      this.driverBuffer.slice(this.driverBufferCursor);
    this.driverBufferCursor -= __toRemove;
  }

  protected override flushDriverInputBuffer(): void {
    this.userBuffer += this.driverBuffer;
    this.driverBuffer = "";
    this.driverBufferCursor = 0;
  }

  public getScreenSize(): Winsize {
    let scrollPort = this.terminal.scrollPort_.getScreenSize();
    return {
      cellsWidth: this.terminal.screenSize.width,
      cellsHeight: this.terminal.screenSize.height,
      pxWidth: scrollPort.width,
      pxHeight: scrollPort.height,
    } as Winsize;
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
      __hterm.processTerminalInput(this.processManager, data);
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
    const data = this.hterm.sendTerminalOutput(
      new TextDecoder().decode(buffer)
    );

    if (window.stdoutAttached) {
      window.buffer += data;
    }
    return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
  }

  override async read(
    len: number,
    workerId: number
  ): Promise<{ err: number; buffer: ArrayBuffer }> {
    if (this.hterm.dataForUser() > 0) {
      return {
        err: constants.WASI_ESUCCESS,
        buffer: this.hterm.readToUser(len),
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
        if (this.hterm.dataForUser() === 0) {
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
          nbytes: BigInt(this.hterm.dataForUser()),
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
