export const Stat = {};

export class INode {}

export class Fifo extends INode {
  public reader: number;
  public writer: number;
  public isCloserm(): boolean { return false };
  public sendEof() {};
}
