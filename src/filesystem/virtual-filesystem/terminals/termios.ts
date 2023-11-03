export type TcFlag = number;
export type TcFlushMode = number;
export type TcTransmissionControl = number;
export type TcSpecialCharIndex = number;

export const VINTR: TcSpecialCharIndex = 0;
export const VQUIT: TcSpecialCharIndex = 1;
export const VERASE: TcSpecialCharIndex = 2;
export const VKILL: TcSpecialCharIndex = 3;
export const VEOF: TcSpecialCharIndex = 4;
export const VTIME: TcSpecialCharIndex = 5;
export const VMIN: TcSpecialCharIndex = 6;
export const VSWTC: TcSpecialCharIndex = 7;
export const VSTART: TcSpecialCharIndex = 8;
export const VSTOP: TcSpecialCharIndex = 9;
export const VSUSP: TcSpecialCharIndex = 10;
export const VEOL: TcSpecialCharIndex = 11;
export const VREPRINT: TcSpecialCharIndex = 12;
export const VDISCARD: TcSpecialCharIndex = 13;
export const VWERASE: TcSpecialCharIndex = 14;
export const VLNEXT: TcSpecialCharIndex = 15;
export const VEOL2: TcSpecialCharIndex = 16;

export const IGNBRK: TcFlag = 0o0000001;
export const BRKINT: TcFlag = 0o0000002;
export const IGNPAR: TcFlag = 0o0000004;
export const PARMRK: TcFlag = 0o0000010;
export const INPCK: TcFlag = 0o0000020;
export const ISTRIP: TcFlag = 0o0000040;
export const INLCR: TcFlag = 0o0000100;
export const IGNCR: TcFlag = 0o0000200;
export const ICRNL: TcFlag = 0o0000400;
export const IUCLC: TcFlag = 0o0001000;
export const IXON: TcFlag = 0o0002000;
export const IXANY: TcFlag = 0o0004000;
export const IXOFF: TcFlag = 0o0010000;
export const IMAXBEL: TcFlag = 0o0020000;
export const IUTF8: TcFlag = 0o0040000;

export const OPOST: TcFlag = 0o0000001;
export const OLCUC: TcFlag = 0o0000002;
export const ONLCR: TcFlag = 0o0000004;
export const OCRNL: TcFlag = 0o0000010;
export const ONOCR: TcFlag = 0o0000020;
export const ONLRET: TcFlag = 0o0000040;
export const OFILL: TcFlag = 0o0000100;
export const OFDEL: TcFlag = 0o0000200;

export const VTDLY: TcFlag = 0o0040000;
export const VT0: TcFlag = 0o0000000;
export const VT1: TcFlag = 0o0040000;

export const B0: TcFlag = 0o0000000;
export const B50: TcFlag = 0o0000001;
export const B75: TcFlag = 0o0000002;
export const B110: TcFlag = 0o0000003;
export const B134: TcFlag = 0o0000004;
export const B150: TcFlag = 0o0000005;
export const B200: TcFlag = 0o0000006;
export const B300: TcFlag = 0o0000007;
export const B600: TcFlag = 0o0000010;
export const B1200: TcFlag = 0o0000011;
export const B1800: TcFlag = 0o0000012;
export const B2400: TcFlag = 0o0000013;
export const B4800: TcFlag = 0o0000014;
export const B9600: TcFlag = 0o0000015;
export const B19200: TcFlag = 0o0000016;
export const B38400: TcFlag = 0o0000017;

export const B57600: TcFlag = 0o0010001;
export const B115200: TcFlag = 0o0010002;
export const B230400: TcFlag = 0o0010003;
export const B460800: TcFlag = 0o0010004;
export const B500000: TcFlag = 0o0010005;
export const B576000: TcFlag = 0o0010006;
export const B921600: TcFlag = 0o0010007;
export const B1000000: TcFlag = 0o0010010;
export const B1152000: TcFlag = 0o0010011;
export const B1500000: TcFlag = 0o0010012;
export const B2000000: TcFlag = 0o0010013;
export const B2500000: TcFlag = 0o0010014;
export const B3000000: TcFlag = 0o0010015;
export const B3500000: TcFlag = 0o0010016;
export const B4000000: TcFlag = 0o0010017;

export const CSIZE: TcFlag = 0o0000060;
export const CS5: TcFlag = 0o0000000;
export const CS6: TcFlag = 0o0000020;
export const CS7: TcFlag = 0o0000040;
export const CS8: TcFlag = 0o0000060;
export const CSTOPB: TcFlag = 0o0000100;
export const CREAD: TcFlag = 0o0000200;
export const PARENB: TcFlag = 0o0000400;
export const PARODD: TcFlag = 0o0001000;
export const HUPCL: TcFlag = 0o0002000;
export const CLOCAL: TcFlag = 0o0004000;

export const ISIG: TcFlag = 0o0000001;
export const ICANON: TcFlag = 0o0000002;
export const ECHO: TcFlag = 0o0000010;
export const ECHOE: TcFlag = 0o0000020;
export const ECHOK: TcFlag = 0o0000040;
export const ECHONL: TcFlag = 0o0000100;
export const NOFLSH: TcFlag = 0o0000200;
export const TOSTOP: TcFlag = 0o0000400;
export const IEXTEN: TcFlag = 0o0100000;

export const TCOOFF: TcTransmissionControl = 0;
export const TCOON: TcTransmissionControl = 1;
export const TCIOFF: TcTransmissionControl = 2;
export const TCION: TcTransmissionControl = 3;

export const TCIFLUSH: TcFlushMode = 0;
export const TCOFLUSH: TcFlushMode = 1;
export const TCIOFLUSH: TcFlushMode = 2;

// Termios struct allows to manipulate terminal behavior
export type Termios = {
  iFlag: TcFlag;
  oFlag: TcFlag;
  cFlag: TcFlag;
  lFlag: TcFlag;
};
