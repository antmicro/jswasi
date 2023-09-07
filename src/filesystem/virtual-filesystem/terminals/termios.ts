export type TcFlag = number;

export const IGNBRK: TcFlag = 0x0000001;
export const BRKINT: TcFlag = 0x0000002;
export const PARMRK: TcFlag = 0x0000010;
export const ISTRIP: TcFlag = 0x0000040;
export const INLCR: TcFlag = 0x0000100;
export const IGNCR: TcFlag = 0x0000200;
export const ICRNL: TcFlag = 0x0000400;
export const IXON: TcFlag = 0x0002000;

export const OPOST: TcFlag = 0x0002000;

export const CSIZE: TcFlag = 0x0000060;
export const CS5: TcFlag = 0x0000000;
export const CS6: TcFlag = 0x0000020;
export const CS7: TcFlag = 0x0000040;
export const CS8: TcFlag = 0x0000060;
export const PARENB: TcFlag = 0x0000400;

export const ISIG: TcFlag = 0x0000001;
export const ICANON: TcFlag = 0x0000002;
export const ECHO: TcFlag = 0x0000010;
export const ECHONL: TcFlag = 0x0000100;
export const IEXTEN: TcFlag = 0x0100000;

// Termios struct allows to manipulate terminal behavior
export type Termios = {
  IFlag: TcFlag;
  OFlag: TcFlag;
  CFlag: TcFlag;
  LFlag: TcFlag;
};
