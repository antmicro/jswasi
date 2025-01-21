const MINOR_BITSIZE = 20;

export const Stat = {};

export class INode { }

export class Fifo extends INode {
  public reader: number;
  public writer: number;
  public isCloserm(): boolean { return false };
  public sendEof() { };
}

export function mkDev(major: number, minor: number) {
  return major << MINOR_BITSIZE | minor;
}
