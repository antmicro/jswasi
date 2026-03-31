import { FsaFilesystem } from "../../src/filesystem/fsa-filesystem/fsa-filesystem";
import * as fsaUtils from "../../src/filesystem/fsa-filesystem/utils";
import * as metadata from "../../src/filesystem/fsa-filesystem/metadata";
import * as constants from "../../src/constants";
import { runFilesystemTests, FsTestAdapter } from "./filesystem-gen";
import {
  jest,
  test,
  expect,
  beforeEach,
  afterEach,
  describe,
} from "@jest/globals";
import { Filesystem } from "../../src/filesystem/filesystem";

jest.mock("../../src/filesystem/fsa-filesystem/fsa-descriptors");
jest.mock("../../src/filesystem/fsa-filesystem/metadata");
jest.mock("../../src/filesystem/fsa-filesystem/utils");
jest.mock("../../third_party/idb-keyval.js");
jest.mock("../../src/filesystem/top-level-fs");

class MockError extends DOMException {
  constructor(public errno: number) {
    super();
  }
}

const fsaAdapter: FsTestAdapter = {
  getFilesystem: () => new FsaFilesystem(),

  defaultInitialize: async (
    fs: Filesystem,
    mergeOpts: Record<string, string>,
  ) => {
    const defaultOpts = {
      prompt: "false",
      name: "test",
    };
    const opts = { ...defaultOpts, ...mergeOpts };

    await fs.initialize(opts);
  },

  setup: () => {
    jest.spyOn(fsaUtils, "mapErr").mockImplementation((e: DOMException) => {
      return (e as MockError).errno;
    });
  },

  teardown: () => {},

  mockEmptyDisk: () => {
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(
      Promise.resolve({
        getFileHandle: () => {
          throw new MockError(constants.WASI_ENOENT);
        },
        getDirectoryHandle: () => {
          throw new MockError(constants.WASI_ENOENT);
        },
      }),
    );
  },

  mockCreateFile: (filename: string) => {
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(
      Promise.resolve({
        getFileHandle: (_a: string, b: { create?: boolean }) => {
          if (b !== undefined) {
            if (b.create === true) return Promise.resolve({});
          }
          throw new MockError(constants.WASI_ENOENT);
        },
        getDirectoryHandle: (_a: string, _b: Object) => {
          throw new MockError(constants.WASI_ENOENT);
        },
      }),
    );
  },

  mockFileExists: (filename: string, fs: Filesystem) => {
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(
      Promise.resolve({
        getDirectoryHandle: () => {
          throw new MockError(constants.WASI_ENOTDIR);
        },
        getFileHandle: () => Promise.resolve({}),
      }),
    );
  },

  mockDirectoryExists: (dirname: string, fs: Filesystem) => {
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(
      Promise.resolve({
        getFileHandle: (_a: string, _b: Object) => {
          throw new MockError(constants.WASI_EISDIR);
        },
        getDirectoryHandle: (_a: string, _b: Object) => Promise.resolve({}),
      }),
    );
  },

  mockCreatableDirectory: (dirname: string) => {
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(
      Promise.resolve({
        getFileHandle: (_a: string, _b: Object) => {
          throw new MockError(constants.WASI_ENOENT);
        },
        getDirectoryHandle: (_a: string, b: { create?: boolean }) => {
          if (b !== undefined) {
            if (b.create === true) return Promise.resolve({});
          }
          throw new MockError(constants.WASI_ENOENT);
        },
      }),
    );
  },

  mockGetFileStoredData: (filename: string, fs: Filesystem) => {
    jest.spyOn(metadata, "getStoredData").mockReturnValue(
      Promise.resolve({
        dev: 0n,
        ino: 0n,
        filetype: constants.WASI_FILETYPE_REGULAR_FILE,
        nlink: 1n,
        size: 0n,
        mtim: 0n,
        atim: 0n,
        ctim: 0n,
      }),
    );
  },

  mockGetUndefinedStoredData: () => {
    jest
      .spyOn(metadata, "getStoredData")
      .mockReturnValue(Promise.resolve(undefined));
  },

  mockDirectoryNotEmpty: (dirname: string) => {
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(
      Promise.resolve({
        getFileHandle: (_a: string, _b: Object) => {
          throw new MockError(constants.WASI_ENOENT);
        },
        getDirectoryHandle: (_a: string, _b: Object) => Promise.resolve({}),
        removeEntry: (_a: string, _b: Object) => {
          throw new MockError(constants.WASI_ENOTEMPTY);
        },
      }),
    );
  },

  mockRemoveFileEntry: (filename: string) => {
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(
      Promise.resolve({
        getFileHandle: (_a: string, _b: Object) => Promise.resolve({}),
        getDirectoryHandle: (_a: string, _b: Object) => {
          throw new MockError(constants.WASI_ENOENT);
        },
        removeEntry: (_a: string, _b: Object) => Promise.resolve(),
      }),
    );
  },
};

runFilesystemTests("fsa", fsaAdapter);

describe("Test FsaFilesystem logic", () => {
  let fs: FsaFilesystem;

  beforeEach(() => {
    fs = new FsaFilesystem();
    jest.spyOn(fsaUtils, "mapErr").mockImplementation((e: DOMException) => {
      return (e as MockError).errno;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test("Indexeddb should not be searched if keepMetadata is disabled", async () => {
    jest.spyOn(metadata, "getStoredData").mockReturnValue(Promise.resolve({}));
    jest.spyOn(fsaUtils, "getTopLevelHandle").mockReturnValue(
      Promise.resolve({
        getFileHandle: (_a: string, _b: Object) => {
          throw new MockError(constants.WASI_EISDIR);
        },
        getDirectoryHandle: (_a: string, _b: Object) => Promise.resolve({}),
      }),
    );

    const fileName = "dirname";

    await fs.initialize({
      prompt: "false",
      name: "test",
      keepMetadata: "false",
    });

    const getFilestatErr = await fs.getFilestat(fileName);
    expect(getFilestatErr.err).toBe(constants.WASI_ESUCCESS);
    expect(metadata.getStoredData).toBeCalledTimes(0);
  });

  test("Initialization without metadata should not call getStoredData", async () => {
    jest
      .spyOn(metadata, "getStoredData")
      .mockReturnValue(Promise.resolve(undefined));

    await fs.initialize({ name: "test", keepMetadata: "false" });
    expect(metadata.getStoredData).toBeCalledTimes(0);
  });

  test("Initialization with metadata should call getStoredData", async () => {
    jest.spyOn(metadata, "getStoredData").mockReturnValue(Promise.resolve({}));

    await fs.initialize({ name: "test", keepMetadata: "true" });
    expect(metadata.getStoredData).toBeCalled();
  });

  test("Initialization without metadata should not call getStoredData", async () => {
    jest
      .spyOn(metadata, "getStoredData")
      .mockReturnValue(Promise.resolve(undefined));

    await fs.initialize({ name: "test", keepMetadata: "false" });
    expect(metadata.getStoredData).toBeCalledTimes(0);
  });
});

describe("Test FsaFilesystem initialize", () => {
  let fs: FsaFilesystem;
  beforeEach(() => {
    fs = new FsaFilesystem();
    jest
      .spyOn(fsaUtils, "getTopLevelHandle")
      .mockReturnValue(Promise.resolve(jest.fn()));
    jest
      .spyOn(fsaUtils, "getHostDirectoryHandle")
      .mockReturnValue(
        Promise.resolve({ err: constants.WASI_ESUCCESS, handle: jest.fn() }),
      );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test.each([
    ["Prompt with name", { prompt: "true", name: "test" }],
    [
      "Prompt with create",
      { prompt: "true", keepMetadata: "false", create: "true" },
    ],
    ["Prompt with metadata", { prompt: "true", keepMetadata: "true" }],
    ["Without prompt and name", { prompt: "false" }],
  ])(
    "%s initialization should be invalid",
    async (_name: string, opts: Record<string, string>) => {
      const err = await fs.initialize(opts);
      expect(err).toBe(constants.WASI_EINVAL);
    },
  );

  test.each([
    ["Prompt without metadata", { prompt: "true", keepMetadata: "false" }],
    ["Normal with metadata", { name: "test", keepMetadata: "false" }],
    ["Normal with create", { name: "test", create: "true" }],
    ["Normal without metadata", { name: "test", keepMetadata: "false" }],
  ])(
    "%s initialization should work",
    async (_s: string, opts: Record<string, string>) => {
      const err = await fs.initialize(opts);
      expect(err).toBe(constants.WASI_ESUCCESS);
    },
  );
});
