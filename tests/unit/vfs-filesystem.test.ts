import { VirtualFilesystem } from "../../src/filesystem/virtual-filesystem/virtual-filesystem";
import { runFilesystemTests, FsTestAdapter } from "./filesystem-gen";
import * as constants from "../../src/constants";
import { Filesystem } from "../../src/filesystem/filesystem";

const vfsAdapter: FsTestAdapter = {
  getFilesystem: () => new VirtualFilesystem(),

  defaultInitialize: async (
    fs: Filesystem,
    mergeOpts: Record<string, string>,
  ) => {
    await fs.initialize({ ...mergeOpts });
  },

  setup: () => {},

  teardown: () => {},

  mockEmptyDisk: () => {},

  mockCreateFile: (filename: string) => {},

  mockFileExists: (filename: string, fs: Filesystem) => {
    fs.open(filename, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
  },

  mockDirectoryExists: (dirname: string, fs: Filesystem) => {
    fs.mkdirat(undefined, dirname);
  },

  mockCreatableDirectory: (dirname: string) => {
    // e.g., vfsMock.mkdir(dirname);
  },

  mockGetFileStoredData: (filename: string, fs: Filesystem) => {
    fs.open(filename, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
  },

  mockGetUndefinedStoredData: () => {
    // Ensure that the VFS returns undefined for non-existent files
    // e.g., vfsMock.clearDisk();
  },

  mockDirectoryNotEmpty: (dirname: string, fs: Filesystem) => {
    fs.mkdirat(undefined, dirname);
    fs.open(`${dirname}/file`, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
  },

  mockRemoveFileEntry: (filename: string, fs: Filesystem) => {
    fs.open(filename, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
  },
};

runFilesystemTests("vfs", vfsAdapter);
