import { DeviceDriver } from "../driver-manager.js";
import * as termios from "./termios.js";
import { PollSub } from "../../filesystem.js";
import ProcessManager from "../../../process-manager.js";
import * as constants from "../../../constants.js";

// Ioctl magic numbers for terminal devices
export const enum ioctlRequests {
  TCGETS = 0x01,
  TCSETS = 0x02,
  TCSETSW = 0x03,
  TCSETSF = 0x04,
  TCGETA = 0x05,
  TCSETA = 0x06,
  TCSETAW = 0x07,
  TCSETAF = 0x08,
  TCSBRK = 0x09,
  TCXONC = 0x0a,
  TCFLSH = 0x0b,
  TIOCEXCL = 0x0c,
  TIOCNXCL = 0x0d,
  TIOCSCTTY = 0x0e,
  TIOCGPGRP = 0x0f,
  TIOCSPGRP = 0x10,
  TIOCOUTQ = 0x11,
  TIOCSTI = 0x12,
  TIOCGWINSZ = 0x13,
  TIOCSWINSZ = 0x14,
  TIOCMGET = 0x15,
  TIOCMBIS = 0x16,
  TIOCMBIC = 0x17,
  TIOCMSET = 0x18,
  TIOCGSOFTCAR = 0x19,
  TIOCSSOFTCAR = 0x1a,
  FIONREAD = 0x1b,
  TIOCINQ = 0x1b, // = FIONREAD
  TIOCLINUX = 0x1c,
  TIOCCONS = 0x1d,
  TIOCGSERIAL = 0x1e,
  TIOCSSERIAL = 0x1f,
  TIOCPKT = 0x20,
  FIONBIO = 0x21,
  TIOCNOTTY = 0x22,
  TIOCSETD = 0x23,
  TIOCGETD = 0x24,
  TCSBRKP = 0x25,
  TIOCSBRK = 0x27,
  TIOCCBRK = 0x28,
  TIOCGSID = 0x29,
  TIOCGRS485 = 0x2e,
  TIOCSRS485 = 0x2f,
  TIOCGPTN = 0x80045430,
  TIOCSPTLCK = 0x40045431,
  TIOCGDEV = 0x80045432,
  TCGETX = 0x32,
  TCSETX = 0x33,
  TCSETXF = 0x34,
  TCSETXW = 0x35,
  TIOCSIG = 0x40045436,
  TIOCVHANGUP = 0x37,
  TIOCGPKT = 0x80045438,
  TIOCGPTLCK = 0x80045439,
  TIOCGEXCL = 0x80045440,
  TIOCGPTPEER = 0x41,
  TIOCGISO7816 = 0x80285442,
  TIOCSISO7816 = 0xc0285443,

  FIONCLEX = 0x50,
  FIOCLEX = 0x51,
  FIOASYNC = 0x52,
  TIOCSERCONFIG = 0x53,
  TIOCSERGWILD = 0x54,
  TIOCSERSWILD = 0x55,
  TIOCGLCKTRMIOS = 0x56,
  TIOCSLCKTRMIOS = 0x57,
  TIOCSERGSTRUCT = 0x58,
  TIOCSERGETLSR = 0x59,
  TIOCSERGETMULTI = 0x5a,
  TIOCSERSETMULTI = 0x5b,

  TIOCMIWAIT = 0x5c,
  TIOCGICOUNT = 0x5d,
  FIOQSIZE = 0x60,

  TIOCM_LE = 0x001,
  TIOCM_DTR = 0x002,
  TIOCM_RTS = 0x004,
  TIOCM_ST = 0x008,
  TIOCM_SR = 0x010,
  TIOCM_CTS = 0x020,
  TIOCM_CAR = 0x040,
  TIOCM_RNG = 0x080,
  TIOCM_DSR = 0x100,
  TIOCM_CD = 0x040, // = TIOCM_CAR,
  TIOCM_RI = 0x080, // = TIOCM_RNG
  TIOCM_OUT1 = 0x2000,
  TIOCM_OUT2 = 0x4000,
  TIOCM_LOOP = 0x8000,

  FIOSETOWN = 0x8901,
  SIOCSPGRP = 0x8902,
  FIOGETOWN = 0x8903,
  SIOCGPGRP = 0x8904,
  SIOCATMARK = 0x8905,
  SIOCGSTAMP = 0x8906,
  SIOCGSTAMPNS = 0x8907,
}

export type Winsize = {
  cellsWidth: number;
  cellsHeight: number;
  pxWidth: number;
  pxHeight: number;
};

// Buffer request is enqueued each read call, once data is available,
// calling resolve resolves promise returned by the read call
export type BufferRequest = {
  len: number;
  pid: number;
  resolve: (ret: { err: number; buffer: ArrayBuffer }) => void;
};

// Interface for interacting with terminals mainatained by terminal
// device driver. One Terminal implementator instance is assigned to
// one minor number
export interface Terminal {
  foregroundPid: number | null;
  bufRequestQueue: BufferRequest[];
  subs: PollSub[];

  getScreenSize(): Winsize;

  // process data from system before and expose it to user
  processTerminalInput(processManager: ProcessManager, data: String): void;

  // get len of data exposed to user
  dataForUser(): number;

  // obtain data that are exposed to user
  readToUser(len: number): ArrayBuffer;

  // process data from user and send to terminal
  sendTerminalOutput(data: String): String;
}

export abstract class AbstractTermiosTerminal implements Terminal {
  public foregroundPid: number | null;
  public bufRequestQueue: BufferRequest[];
  public subs: PollSub[];

  public termios: termios.Termios;

  protected driverBuffer: string;
  protected driverBufferCursor: number;

  protected userBuffer: string;

  constructor(termios: termios.Termios) {
    this.bufRequestQueue = [];
    this.subs = [];
    this.termios = termios;
    this.driverBuffer = "";
    this.driverBufferCursor = 0;
    this.userBuffer = "";
  }

  // prints data on the screen
  protected abstract printTerminal(data: string): void;

  // move cursor `n` positions right, both on screen and buffer
  protected abstract moveCursorRight(shift: number): void;

  // move cursor `n` positions left, both on screen and buffer
  protected abstract moveCursorLeft(shift: number): void;

  // remove `n` chars to left, both on screen and buffer
  protected abstract removeFromCursorToLeft(toRemove: number): void;

  public abstract getScreenSize(): Winsize;

  protected splitBuf(len: number): string {
    let out = this.userBuffer.slice(0, len);
    this.userBuffer = this.userBuffer.slice(len);
    return out;
  }

  protected detectBreakCondition(data: string): number {
    for (let i = 2; i < data.length; ++i) {
      if (data.charCodeAt(i) !== 0) {
        return i;
      }
    }

    return data.length;
  }

  protected stripOffBytes(data: string): string {
    let stripped = "";
    for (let i = 0; i < data.length; ++i) {
      let c = data.charCodeAt(i);
      stripped += String.fromCharCode(c & 0x7f)[0];
    }
    return stripped;
  }

  protected pushDriverInputBuffer(data: string): void {
    if ((this.termios.lFlag & termios.ECHO) !== 0) {
      this.printTerminal(data);
    }
    this.driverBuffer =
      this.driverBuffer.slice(0, this.driverBufferCursor) +
      data +
      this.driverBuffer.slice(this.driverBufferCursor);
    this.driverBufferCursor += data.length;
  }

  protected pushNLDriverInputBuffer(): void {
    this.driverBuffer += "\n";
    if ((this.termios.lFlag & termios.ICANON) !== 0) {
      if (
        (this.termios.lFlag & termios.ECHO) !== 0 ||
        (this.termios.lFlag & termios.ECHONL) !== 0
      ) {
        this.printTerminal("\r\n");
      }
      this.flushDriverInputBuffer();
    }
  }

  protected flushDriverInputBuffer(): void {
    this.userBuffer += this.driverBuffer;
    this.driverBuffer = "";
    this.driverBufferCursor = 0;
  }

  protected resolveUserReadRequests(): void {
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

  public processTerminalInput(
    processManager: ProcessManager,
    data: string
  ): void {
    let iFlag = this.termios.iFlag;
    let cFlag = this.termios.cFlag;
    let lFlag = this.termios.lFlag;

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
              this.driverBuffer += "\x00";
            } else {
              this.driverBuffer += "\xFF\x00\x00";
            }
          } else {
            this.flushDriverInputBuffer();
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
                  this.pushNLDriverInputBuffer();
                } else {
                  this.pushDriverInputBuffer("\r");
                }
              }
            } else {
              this.pushNLDriverInputBuffer();
            }
          } else {
            this.pushNLDriverInputBuffer();
          }

          break;
        }
        // 0x0d - CR
        case 0x0d: {
          if ((lFlag & termios.ICANON) !== 0) {
            if ((iFlag & termios.IGNCR) === 0) {
              if ((iFlag & termios.ICRNL) !== 0) {
                this.pushNLDriverInputBuffer();
              } else {
                this.pushDriverInputBuffer("\r");
              }
            }
          } else {
            this.pushDriverInputBuffer("\r");
          }

          break;
        }
        // 0x11 - START, 0x13 - STOP
        case 0x11:
        case 0x13: {
          if ((iFlag & termios.IXON) !== 0) {
            // ignore for now...
          } else {
            this.pushDriverInputBuffer(data[0]);
          }
          break;
        }
        // 0x03 - INTR, 0x1a - SUSP, 0x1c - QUIT
        case 0x03:
        case 0x1a:
        case 0x1c: {
          if ((lFlag & termios.ISIG) !== 0) {
            if (code === 0x03) {
              if (this.foregroundPid !== null) {
                processManager.publishEvent(
                  constants.WASI_EXT_EVENT_SIGINT,
                  this.foregroundPid
                );
              }
            }
            // ingore 0x1a, 0x1c for now...
          } else {
            this.pushDriverInputBuffer(data[0]);
          }
          break;
        }
        // EOT - end of transmission
        case 0x04: {
          if ((lFlag & termios.ICANON) !== 0) {
            this.flushDriverInputBuffer();
            this.resolveUserReadRequests();
          } else {
            this.pushDriverInputBuffer(data[0]);
          }
          break;
        }
        // KILL - remove line
        case 0x15: {
          if ((lFlag & termios.ICANON) !== 0 && (lFlag & termios.ECHOK) !== 0) {
            // Remove all characters from driver buffer to the left from the cursor
            this.removeFromCursorToLeft(this.driverBufferCursor);
          } else {
            this.pushDriverInputBuffer(data[0]);
          }
          break;
        }
        // DEL
        case 0x7f: {
          if ((lFlag & termios.ICANON) !== 0 && (lFlag & termios.ECHOE) !== 0) {
            this.removeFromCursorToLeft(1);
          } else {
            this.pushDriverInputBuffer(data[0]);
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
                  this.moveCursorRight(1);
                  break;
                }
                // Move cursor left
                case "D": {
                  this.moveCursorLeft(1);
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
            this.pushDriverInputBuffer(data[0]);
          }

          break;
        }
        default: {
          this.pushDriverInputBuffer(data[0]);
          break;
        }
      }

      data = data.slice(1);
    }

    if ((lFlag & termios.ICANON) === 0) {
      this.flushDriverInputBuffer();
    }

    if (this.userBuffer.length > 0) {
      this.resolveUserReadRequests();
    }

    if (this.userBuffer.length > 0) {
      for (const sub of this.subs) {
        sub.resolve({
          userdata: sub.userdata,
          error: constants.WASI_ESUCCESS,
          nbytes: BigInt(this.userBuffer.length),
          eventType: constants.WASI_EVENTTYPE_FD_READ,
        });
      }
      this.subs.length = 0;
    }
  }

  public dataForUser(): number {
    return this.userBuffer.length;
  }

  public readToUser(len: number): ArrayBuffer {
    return new TextEncoder().encode(this.splitBuf(len));
  }

  public sendTerminalOutput(data: string): string {
    if ((this.termios.oFlag & termios.ONLCR) !== 0) {
      data = data.replaceAll("\n", "\r\n");
    }
    this.printTerminal(data);

    return data;
  }
}

// Extended device driver interface for interacting with terminal
// device drivers
export interface TerminalDriver extends DeviceDriver {
  terminals: Record<number, Terminal>;
}
