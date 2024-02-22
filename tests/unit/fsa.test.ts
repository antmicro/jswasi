import * as constants from "../../src/constants";
import { FsaFilesystem } from "../../src/filesystem/fsa-filesystem/fsa-filesystem";

import * as fsaUtils from "../../src/filesystem/fsa-filesystem/utils";
import * as metadata from "../../src/filesystem/fsa-filesystem/metadata";

// @ts-ignore
import { test, beforeEach, jest, expect, describe, afterEach, Mock } from "@jest/globals";

jest.mock("../../third_party/idb-keyval.js");
jest.mock("../../src/filesystem/top-level-fs");
jest.mock("../../src/filesystem/virtual-filesystem/devices/driver-manager");
jest.mock("../../src/filesystem/fsa-filesystem/fsa-descriptors");
jest.mock("../../src/filesystem/fsa-filesystem/metadata");
jest.mock("../../src/filesystem/fsa-filesystem/utils");

class MockError extends DOMException {
  constructor(public errno: number) { super(); }
}

describe("Test fsa filesystem open", () => {
  let fsaFilesystem = new FsaFilesystem();

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

describe("Test fsa filesystem mkdirat", () => {
  let fsaFilesystem = new FsaFilesystem();

  beforeEach(() => {
    jest.spyOn(fsaUtils, "mapErr").mockImplementation(
      (e: DOMException) => { return (e as MockError).errno; });
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test("Directories should be creatable", async () => {
    const dirName = "directory";

    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOENT); },
      // @ts-ignore
      getDirectoryHandle: (_a: string, b: { create?: boolean }) => {
        if (b !== undefined) {
          if (b.create === true)
            return Promise.resolve({});
        }
        throw new MockError(constants.WASI_ENOENT);
      }
    }));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
    });

    const mkdiratErr = await fsaFilesystem.mkdirat(undefined, dirName);
    expect(mkdiratErr).toBe(constants.WASI_ESUCCESS);
  });

  test("Directory creation should fail if a directory exists", async () => {
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

    const mkdiratErr = await fsaFilesystem.mkdirat(undefined, fileName);
    expect(mkdiratErr).toBe(constants.WASI_EEXIST);
  });

  test("Directory creation should fail if a file exists", async () => {
    const fileName = "dirname";

    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      // @ts-ignore
      getFileHandle: (_a: string, _b: Object) => Promise.resolve({}),
      getDirectoryHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOTDIR); },
    }));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
    });

    const mkdiratErr = await fsaFilesystem.mkdirat(undefined, fileName);
    expect(mkdiratErr).toBe(constants.WASI_ENOTDIR);
  });
});

describe("Test fsa filesystem getFilestat", () => {
  let fsaFilesystem = new FsaFilesystem();

  beforeEach(() => {
    jest.spyOn(fsaUtils, "mapErr").mockImplementation(
      (e: DOMException) => { return (e as MockError).errno; });
  });
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test("Filestat data should be returned for files", async () => {
    const fileName = "dirname";

    jest.spyOn(metadata, "getStoredData").mockReturnValue(Promise.resolve({
      dev: 0n,
      ino: 0n,
      filetype: constants.WASI_FILETYPE_REGULAR_FILE,
      nlink: 1n,
      size: 0n,
      mtim: 0n,
      atim: 0n,
      ctim: 0n,
    }));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
      keepMetadata: "true",
    });

    const getFilestatErr = await fsaFilesystem.getFilestat(fileName);
    expect(getFilestatErr.err).toBe(constants.WASI_ESUCCESS);
    expect(getFilestatErr.filestat.filetype).toBe(constants.WASI_FILETYPE_REGULAR_FILE);
  });

  test("Filestat data should not be returned if file doesn't exist", async () => {
    const fileName = "dirname";

    jest.spyOn(metadata, "getStoredData").mockReturnValue(Promise.resolve(undefined));

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
      keepMetadata: "true",
    });

    const getFilestatErr = await fsaFilesystem.getFilestat(fileName);
    expect(getFilestatErr.err).toBe(constants.WASI_ENOENT);
  });

  test("Indexeddb should not be searched if keepMetadata is disabled", async () => {
    const fileName = "dirname";

    // @ts-ignore
    jest.spyOn(metadata, "getStoredData").mockReturnValue(undefined);

    await fsaFilesystem.initialize({
      prompt: "false",
      name: "test",
      keepMetadata: "false",
    });

    const getFilestatErr = await fsaFilesystem.getFilestat(fileName);
    expect(getFilestatErr.err).toBe(constants.WASI_ESUCCESS);
    expect(metadata.getStoredData).toBeCalledTimes(0);
  });
});

describe("Test fsa filesystem initialize", () => {
  let fsaFilesystem = new FsaFilesystem();

  beforeEach(() => {
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve(Mock));
    jest.spyOn(fsaUtils, "getHostDirectoryHandle").mockReturnValue(
      Promise.resolve({ err: constants.WASI_ESUCCESS, handle: Mock }));
    jest.spyOn(metadata, "setStoredData");
  });
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test.each([
    ["Prompt with name", {"prompt": "true", "name": "test"}],
    ["Prompt with create", {"prompt": "true", "keepMetadata": "false", "create": "true"}],
    ["Prompt with metadata", {"prompt": "true", "keepMetadata": "true"}],
    ["Without prompt and name", {"prompt": "false"}],
  ])("%s initialization should be invalid", async (_name: string, opts: Record<string, string>) => {
    const err = await fsaFilesystem.initialize(opts);
    expect(err).toBe(constants.WASI_EINVAL);
  });

  test.each([
    ["Prompt without metadata", {"prompt": "true", "keepMetadata": "false"}],
    ["Normal with metadata", {"name": "test", "keepMetadata": "false"}],
    ["Normal with create", {"name": "test", "create": "true"}],
    ["Normal without metadata", {"name": "test", "keepMetadata": "false"}],
  ])("%s initialization should work", async (_s: string, opts: Record<string, string>) => {
    const err = await fsaFilesystem.initialize(opts);
    expect(err).toBe(constants.WASI_ESUCCESS);
  });

  test("Initialization without metadata should not call getStoredData", async () => {
    await fsaFilesystem.initialize({"name": "test", "keepMetadata": "false"});
    expect(metadata.getStoredData).toBeCalledTimes(0);
  });

  test("Initialization with metadata should call getStoredData", async () => {
    jest.spyOn(metadata, "getStoredData").mockReturnValue(Promise.resolve(undefined));
    await fsaFilesystem.initialize({"name": "test", "keepMetadata": "true"});
    expect(metadata.setStoredData).toBeCalled();
  });

  test("Initialization without metadata should not call setStoredData", async () => {
    // @ts-ignore
    jest.spyOn(metadata, "getStoredData").mockReturnValue(Promise.resolve({}));
    await fsaFilesystem.initialize({"name": "test", "keepMetadata": "true"});
    expect(metadata.setStoredData).toBeCalledTimes(0);
  });
});

describe("Test fsa filesystem unlinkat", () => {
  let fsaFilesystem = new FsaFilesystem();

  beforeEach(() => {
    jest.spyOn(fsaUtils, "mapErr").mockImplementation(
      (e: DOMException) => { return (e as MockError).errno; });
  });
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test("Unlinkat should fail if file doesn't exist", async () => {
    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOENT); },
      getDirectoryHandle: (_a: string, _b: Object) => Promise.resolve({})
    }));

    await fsaFilesystem.initialize({ prompt: "false", name: "test" });

    const err = await fsaFilesystem.unlinkat(undefined, "test", false);
    expect(err).toBe(constants.WASI_ENOENT);
  });

  test("Unlinkat should fail if directory doesn't exist", async () => {
    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, _b: Object) => Promise.resolve({}),
      getDirectoryHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOENT); }
    }));

    await fsaFilesystem.initialize({ prompt: "false", name: "test" });

    const err = await fsaFilesystem.unlinkat(undefined, "test", true);
    expect(err).toBe(constants.WASI_ENOENT);
  });

  test("Unlinkat should fail if directory is not empty", async () => {
    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOENT); },
      getDirectoryHandle: (_a: string, _b: Object) => Promise.resolve({}),
      removeEntry: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOTEMPTY); }
    }));

    await fsaFilesystem.initialize({ prompt: "false", name: "test" });

    const err = await fsaFilesystem.unlinkat(undefined, "test", true);
    expect(err).toBe(constants.WASI_ENOTEMPTY);
  });

  test("Unlinkat should work if file exists", async () => {
    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, _b: Object) => Promise.resolve({}),
      getDirectoryHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOENT); },
      removeEntry: (_a: string, _b: Object) => Promise.resolve()
    }));

    await fsaFilesystem.initialize({ prompt: "false", name: "test" });

    const err = await fsaFilesystem.unlinkat(undefined, "test", false);
    expect(err).toBe(constants.WASI_ESUCCESS);
  });

  test("Unlinkat should work if file exists", async () => {
    // @ts-ignore
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(Promise.resolve({
      getFileHandle: (_a: string, _b: Object) => { throw new MockError(constants.WASI_ENOENT); },
      getDirectoryHandle: (_a: string, _b: Object) => Promise.resolve({}),
      removeEntry: (_a: string, _b: Object) => Promise.resolve()
    }));

    await fsaFilesystem.initialize({ prompt: "false", name: "test" });

    const err = await fsaFilesystem.unlinkat(undefined, "test", true);
    expect(err).toBe(constants.WASI_ESUCCESS);
  });
});
