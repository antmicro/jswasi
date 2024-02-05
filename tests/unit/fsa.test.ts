import * as constants from "../../src/constants";
import { FsaFilesystem } from "../../src/filesystem/fsa-filesystem/fsa-filesystem";
import * as fsaUtils from "../../src/filesystem/fsa-filesystem/utils";

// @ts-ignore
import { jest, expect, describe, afterEach } from "@jest/globals";

jest.mock("../../third_party/idb-keyval.js");
jest.mock("../../src/filesystem/top-level-fs");
jest.mock("../../src/filesystem/virtual-filesystem/driver-manager");
jest.mock("../../src/filesystem/fsa-filesystem/fsa-descriptors");
jest.mock("../../src/filesystem/fsa-filesystem/utils");

class MockError extends DOMException {
  constructor(public errno: number) { super(); }
}

describe("Test fsa filesystem open", () => {
  let fsaFilesystem = new FsaFilesystem();
  // let navigatorDirectoryGetter;

  beforeEach(() => {
    jest.spyOn(fsaUtils, "mapErr").mockImplementation(
      (e: DOMException) => { return (e as MockError).errno; });
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test("Files should be openable", async () => {
    const fileName = "filename";

    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getDirectoryHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOTDIR); },
      getFileHandle: (_a: string, _b: Object) => Promise.resolve({})
    }));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
    });

    const openErr = await fsaFilesystem.open(fileName, 0, 0, 0n, 0n, 0, 0);
    expect(openErr.err).toBe(constants.WASI_ESUCCESS);
  });

  test("Files should be creatable", async () => {
    const fileName = "filename";

    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, b: { create?: boolean }) => {
        if (b !== undefined) {
          if (b.create === true)
            return Promise.resolve({});
        }
        throw new MockError(constants.WASI_ENOENT);
      },
      getDirectoryHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOENT); }
    }));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
    });

    const openErr = await fsaFilesystem.open(fileName, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    expect(openErr.err).toBe(constants.WASI_ESUCCESS);
  });

  test("Files should not be openable with creat and excl", async () => {
    const fileName = "filename";

    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getDirectoryHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOTDIR); },
      getFileHandle: (_a: string, _b: Object) => Promise.resolve({})
    }));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
    });

    const openErr = await fsaFilesystem.open(
      fileName, 0, constants.WASI_O_CREAT | constants.WASI_O_EXCL, 0n, 0n, 0, 0);
    expect(openErr.err).toBe(constants.WASI_EEXIST);
  });

  test("Directories should be openable", async () => {
    const fileName = "dirname";

    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_EISDIR); },
      // @ts-ignore
      getDirectoryHandle: (_a: string, _b: Object) => Promise.resolve({})
    }));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
    });

    const openErr = await fsaFilesystem.open(fileName, 0, constants.WASI_O_DIRECTORY, 0n, 0n, 0, 0);
    expect(openErr.err).toBe(constants.WASI_ESUCCESS);
  });

  test("Directories should not be openable with creat", async () => {
    const fileName = "dirname";

    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_EISDIR); },
      // @ts-ignore
      getDirectoryHandle: (_a: string, _b: Object) => Promise.resolve({})
    }));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
    });

    const openErr = await fsaFilesystem.open(fileName, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    expect(openErr.err).toBe(constants.WASI_EISDIR);
  });
});
