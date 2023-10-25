import { DeviceDriver } from "../driver-manager.js";
import { Termios } from "./termios.js";

// Ioctl magic numbers for terminal devices
export const enum ioctlRequests {
  GET_SCREEN_SIZE = 0,
  SET_RAW = 1,
  SET_ECHO = 2,
  TCGETS = 0x5401,
  TCSETS = 0x5402,
  TCSETSW = 0x5403,
  TCSETSF = 0x5404,
  TCGETA = 0x5405,
  TCSETA = 0x5406,
  TCSETAW = 0x5407,
  TCSETAF = 0x5408,
  TCSBRK = 0x5409,
  TCXONC = 0x540a,
  TCFLSH = 0x540b,
  TIOCEXCL = 0x540c,
  TIOCNXCL = 0x540d,
  TIOCSCTTY = 0x540e,
  TIOCGPGRP = 0x540f,
  TIOCSPGRP = 0x5410,
  TIOCOUTQ = 0x5411,
  TIOCSTI = 0x5412,
  TIOCGWINSZ = 0x5413,
  TIOCSWINSZ = 0x5414,
  TIOCMGET = 0x5415,
  TIOCMBIS = 0x5416,
  TIOCMBIC = 0x5417,
  TIOCMSET = 0x5418,
  TIOCGSOFTCAR = 0x5419,
  TIOCSSOFTCAR = 0x541a,
  FIONREAD = 0x541b,
  TIOCINQ = 0x541b, // = FIONREAD
  TIOCLINUX = 0x541c,
  TIOCCONS = 0x541d,
  TIOCGSERIAL = 0x541e,
  TIOCSSERIAL = 0x541f,
  TIOCPKT = 0x5420,
  FIONBIO = 0x5421,
  TIOCNOTTY = 0x5422,
  TIOCSETD = 0x5423,
  TIOCGETD = 0x5424,
  TCSBRKP = 0x5425,
  TIOCSBRK = 0x5427,
  TIOCCBRK = 0x5428,
  TIOCGSID = 0x5429,
  TIOCGRS485 = 0x542e,
  TIOCSRS485 = 0x542f,
  TIOCGPTN = 0x80045430,
  TIOCSPTLCK = 0x40045431,
  TIOCGDEV = 0x80045432,
  TCGETX = 0x5432,
  TCSETX = 0x5433,
  TCSETXF = 0x5434,
  TCSETXW = 0x5435,
  TIOCSIG = 0x40045436,
  TIOCVHANGUP = 0x5437,
  TIOCGPKT = 0x80045438,
  TIOCGPTLCK = 0x80045439,
  TIOCGEXCL = 0x80045440,
  TIOCGPTPEER = 0x5441,
  TIOCGISO7816 = 0x80285442,
  TIOCSISO7816 = 0xc0285443,

  FIONCLEX = 0x5450,
  FIOCLEX = 0x5451,
  FIOASYNC = 0x5452,
  TIOCSERCONFIG = 0x5453,
  TIOCSERGWILD = 0x5454,
  TIOCSERSWILD = 0x5455,
  TIOCGLCKTRMIOS = 0x5456,
  TIOCSLCKTRMIOS = 0x5457,
  TIOCSERGSTRUCT = 0x5458,
  TIOCSERGETLSR = 0x5459,
  TIOCSERGETMULTI = 0x545a,
  TIOCSERSETMULTI = 0x545b,

  TIOCMIWAIT = 0x545c,
  TIOCGICOUNT = 0x545d,
  FIOQSIZE = 0x5460,

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
