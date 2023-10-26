import { DeviceDriver } from "../driver-manager.js";
import { Termios } from "./termios.js";

// Ioctl magic numbers for terminal devices
export const enum ioctlRequests {
  GET_SCREEN_SIZE = 0,
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
  echo: boolean;
  raw: boolean;
  foregroundPid: number | null;
  bufRequestQueue: BufferRequest[];
  termios: Termios;

  getScreenSize(): Promise<[number, number]>;
}

// Extended device driver interface for interacting with terminal
// device drivers
export interface TerminalDriver extends DeviceDriver {
  terminals: Record<number, Terminal>;
}
