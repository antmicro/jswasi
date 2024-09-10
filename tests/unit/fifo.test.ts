import { FifoDescriptor, fifoPeerState } from "../../src/filesystem/virtual-filesystem/devices/fifo";
import * as vfs from "./mock-vfs";
import * as constants from "../../src/constants";
// @ts-ignore
import { jest, test, expect, describe, afterEach, beforeEach, beforeAll } from "@jest/globals";

class DummyFifoINode {
  public readerGetter: jest.MockedFunction<() => number>;
  public readerSetter: jest.MockedFunction<(val: number) => void>;

  public writerGetter: jest.MockedFunction<() => number>;
  public writerSetter: jest.MockedFunction<(val: number) => void>;

  constructor() {
    this.readerGetter = jest.fn();
    this.readerSetter = jest.fn();

    this.writerGetter = jest.fn();
    this.writerSetter = jest.fn();
  }
}

jest.mock("./mock-vfs");

describe("Test fifo descriptor", () => {
  let fifoINode: vfs.Fifo;
  let dummyFifoINode: DummyFifoINode;

  beforeEach(() => {
    fifoINode = new vfs.Fifo();
    dummyFifoINode = new DummyFifoINode();
    Object.defineProperties(fifoINode, {
      "reader": {
        get: dummyFifoINode.readerGetter,
        set: dummyFifoINode.readerSetter,
      },
      "writer": {
        get: dummyFifoINode.writerGetter,
        set: dummyFifoINode.writerSetter,
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks()
  });

  test("Opening fifo for the first time should increment the reader count", () => {
    jest.spyOn(dummyFifoINode, "readerGetter").mockReturnValue(-1);
    new FifoDescriptor(0, constants.WASI_RIGHT_FD_READ, 0n, fifoINode, () => {});
    expect(dummyFifoINode.readerSetter).toHaveBeenCalledWith(1);
  });

  test("Opening fifo for the second time should increment the reader count", () => {
    jest.spyOn(dummyFifoINode, "readerGetter").mockReturnValue(1);
    new FifoDescriptor(0, constants.WASI_RIGHT_FD_READ, 0n, fifoINode, () => {});
    expect(dummyFifoINode.readerSetter).toHaveBeenCalledWith(2);
  });

  test("Opening fifo for the first time should increment the writer count", () => {
    jest.spyOn(dummyFifoINode, "writerGetter").mockReturnValue(-1);
    new FifoDescriptor(0, constants.WASI_RIGHT_FD_WRITE, 0n, fifoINode, () => {});
    expect(dummyFifoINode.writerSetter).toHaveBeenCalledWith(1);
  });

  test("Opening fifo for the second time should increment the writer count", () => {
    jest.spyOn(dummyFifoINode, "writerGetter").mockReturnValue(1);
    new FifoDescriptor(0, constants.WASI_RIGHT_FD_WRITE, 0n, fifoINode, () => {});
    expect(dummyFifoINode.writerSetter).toHaveBeenCalledWith(2);
  });

  test("Duplicating fifo should increment the reader count", () => {
    const desc = new FifoDescriptor(0, constants.WASI_RIGHT_FD_READ, 0n, fifoINode, () => {});
    jest.spyOn(dummyFifoINode, "readerGetter").mockReturnValue(1);
    desc.duplicateFd();
    expect(dummyFifoINode.readerSetter).toHaveBeenLastCalledWith(2);
  });

  test("Duplicating fifo should increment the writer count", () => {
    const desc = new FifoDescriptor(0, constants.WASI_RIGHT_FD_WRITE, 0n, fifoINode, () => {});
    jest.spyOn(dummyFifoINode, "writerGetter").mockReturnValue(1);
    desc.duplicateFd();
    expect(dummyFifoINode.writerSetter).toHaveBeenLastCalledWith(2);
  });

  test("Closing a fifo should decrement the reader count", async () => {
    const desc = new FifoDescriptor(0, constants.WASI_RIGHT_FD_READ, 0n, fifoINode, () => {});
    jest.spyOn(dummyFifoINode, "readerGetter").mockReturnValue(1);
    await desc.close();
    expect(dummyFifoINode.readerSetter).toHaveBeenCalledWith(fifoPeerState.CLOSED);
  });

  test("Closing a fifo should decrement the writer count", async () => {
    const desc = new FifoDescriptor(0, constants.WASI_RIGHT_FD_WRITE, 0n, fifoINode, () => {});
    jest.spyOn(dummyFifoINode, "writerGetter").mockReturnValue(1);
    await desc.close();
    expect(dummyFifoINode.writerSetter).toHaveBeenCalledWith(fifoPeerState.CLOSED);
  });

  test("Closing the last fifo writer descriptor should notify poll requests", async () => {
    const desc = new FifoDescriptor(0, constants.WASI_RIGHT_FD_WRITE, 0n, fifoINode, () => {});
    let writerCounter = 1;
    jest.spyOn(dummyFifoINode, "writerGetter").mockImplementation(() => writerCounter);
    jest.spyOn(dummyFifoINode, "writerSetter").mockImplementation(() => {
      writerCounter = fifoPeerState.CLOSED;
    });
    await desc.close();
    expect(fifoINode.sendEof).toHaveBeenCalled();
  });

  test("Closing all descriptors of a CLOSERM fifo should call the remover callback", async () => {
    let remover = jest.fn();
    const desc = new FifoDescriptor(0, 0n, 0n, fifoINode, remover);

    jest.spyOn(dummyFifoINode, "writerGetter").mockReturnValue(0);
    jest.spyOn(dummyFifoINode, "readerGetter").mockReturnValue(0);
    jest.spyOn(fifoINode, "isCloserm").mockReturnValue(true);

    await desc.close();

    expect(remover).toHaveBeenCalled();
  });
});
