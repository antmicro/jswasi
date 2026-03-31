import * as constants from "../../src/constants";
import { Filesystem } from "../../src/filesystem/filesystem";
import {
  jest,
  test,
  expect,
  describe,
  afterEach,
  beforeEach,
} from "@jest/globals";

export interface FsTestAdapter {
  getFilesystem: () => Filesystem;
  defaultInitialize: (fs: Filesystem, mergeOpts: Record<string, string>) => Promise<void>;

  setup: () => void;
  teardown: () => void;

  mockEmptyDisk: () => void;
  mockCreateFile: (filename: string) => void;
  mockFileExists: (filename: string, fs: Filesystem) => void;
  mockDirectoryExists: (dirname: string, fs: Filesystem) => void;
  mockCreatableDirectory: (dirname: string) => void;
  mockGetFileStoredData: (filename: string, fs: Filesystem) => void;
  mockGetUndefinedStoredData: () => void;
  mockDirectoryNotEmpty: (dirname: string, fs: Filesystem) => void;
  mockRemoveFileEntry: (filename: string, fs: Filesystem) => void;
}

export function runFilesystemTests(name: string, adapter: FsTestAdapter) {
  describe(`Filesystem: ${name}`, () => {
    let fs: Filesystem;

    beforeEach(() => {
      adapter.setup();
      fs = adapter.getFilesystem();
    });

    afterEach(() => {
      jest.clearAllMocks();
      jest.restoreAllMocks();
      adapter.teardown();
    });

    describe("Test filesystem open", () => {
      test("Files should be openable", async () => {
        const fileName = "filename";
        adapter.mockFileExists(fileName, fs);

        await adapter.defaultInitialize(fs);

        const openErr = await fs.open(fileName, 0, 0, 0n, 0n, 0, 0);
        expect(openErr.err).toBe(constants.WASI_ESUCCESS);
      });

      test("Files should be creatable", async () => {
        const fileName = "filename";

        adapter.mockCreateFile(fileName);

        await adapter.defaultInitialize(fs);

        const openErr = await fs.open(
          fileName,
          0,
          constants.WASI_O_CREAT,
          0n,
          0n,
          0,
          0,
        );
        expect(openErr.err).toBe(constants.WASI_ESUCCESS);
      });

      test("Files should not be openable with creat and excl", async () => {
        const fileName = "filename";

        adapter.mockFileExists(fileName, fs);

        await adapter.defaultInitialize(fs);

        const openErr = await fs.open(
          fileName,
          0,
          constants.WASI_O_CREAT | constants.WASI_O_EXCL,
          0n,
          0n,
          0,
          0,
        );
        expect(openErr.err).toBe(constants.WASI_EEXIST);
      });

      test("Directories should be openable", async () => {
        const fileName = "dirname";

        adapter.mockDirectoryExists(fileName, fs);

        await adapter.defaultInitialize(fs);

        const openErr = await fs.open(
          fileName,
          0,
          constants.WASI_O_DIRECTORY,
          0n,
          0n,
          0,
          0,
        );
        expect(openErr.err).toBe(constants.WASI_ESUCCESS);
      });

      test("Directories should not be openable with creat", async () => {
        const fileName = "dirname";

        adapter.mockDirectoryExists(fileName, fs);

        await adapter.defaultInitialize(fs);

        const openErr = await fs.open(
          fileName,
          0,
          constants.WASI_O_CREAT,
          0n,
          0n,
          0,
          0,
        );
        expect(openErr.err).toBe(constants.WASI_EISDIR);
      });
    });

    describe("Test filesystem mkdirat", () => {
      test("Directories should be creatable", async () => {
        const dirName = "directory";

        adapter.mockCreatableDirectory(dirName);

        await adapter.defaultInitialize(fs);

        const mkdiratErr = await fs.mkdirat(undefined, dirName);
        expect(mkdiratErr).toBe(constants.WASI_ESUCCESS);
      });

      test("Directory creation should fail if a directory exists", async () => {
        const fileName = "dirname";

        adapter.mockDirectoryExists(fileName, fs);

        await adapter.defaultInitialize(fs);

        const mkdiratErr = await fs.mkdirat(undefined, fileName);
        expect(mkdiratErr).toBe(constants.WASI_EEXIST);
      });

      test("Directory creation should fail if a file exists", async () => {
        const fileName = "dirname";

        adapter.mockFileExists(fileName, fs);

        await adapter.defaultInitialize(fs);

        const mkdiratErr = await fs.mkdirat(undefined, fileName);
        expect(mkdiratErr).toBe(constants.WASI_ENOTDIR);
      });
    });

    describe("Test filesystem getFilestat", () => {
      test("Filestat data should be returned for files", async () => {
        const fileName = "filename";

        adapter.mockGetFileStoredData(fileName, fs);

        await adapter.defaultInitialize(fs, {"keepMetadata": "true"});

        const getFilestatErr = await fs.getFilestat(fileName);
        expect(getFilestatErr.err).toBe(constants.WASI_ESUCCESS);
        expect(getFilestatErr.filestat.filetype).toBe(
          constants.WASI_FILETYPE_REGULAR_FILE,
        );
      });

      test("Filestat data should not be returned if file doesn't exist", async () => {
        const fileName = "filename";

        adapter.mockGetUndefinedStoredData();

        await adapter.defaultInitialize(fs, {"keepMetadata": "true"});

        const getFilestatErr = await fs.getFilestat(fileName);
        expect(getFilestatErr.err).toBe(constants.WASI_ENOENT);
      });
    });

    describe("Test filesystem unlinkat", () => {
      test("Unlinkat should fail if file doesn't exist", async () => {
        adapter.mockEmptyDisk();

        await adapter.defaultInitialize(fs);

        const err = await fs.unlinkat(undefined, "test", false);
        expect(err).toBe(constants.WASI_ENOENT);
      });

      test("Unlinkat should fail if directory doesn't exist", async () => {
        adapter.mockEmptyDisk();

        await adapter.defaultInitialize(fs);

        const err = await fs.unlinkat(undefined, "test", true);
        expect(err).toBe(constants.WASI_ENOENT);
      });

      test("Unlinkat should fail if directory is not empty", async () => {
        adapter.mockDirectoryNotEmpty("test", fs);

        await adapter.defaultInitialize(fs);

        const err = await fs.unlinkat(undefined, "test", true);
        expect(err).toBe(constants.WASI_ENOTEMPTY);
      });

      test("Unlinkat should work if file exists", async () => {
        adapter.mockRemoveFileEntry("test", fs);

        await adapter.defaultInitialize(fs);

        const err = await fs.unlinkat(undefined, "test", false);
        expect(err).toBe(constants.WASI_ESUCCESS);
      });
    });
  });
}
