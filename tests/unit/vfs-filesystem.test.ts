import { VirtualFilesystem } from "../../src/filesystem/virtual-filesystem/virtual-filesystem";
import { runFilesystemTests, FsTestAdapter } from "./filesystem-gen";
import * as constants from "../../src/constants";
import { Filesystem } from "../../src/filesystem/filesystem";

const vfsAdapter: FsTestAdapter = {
  getFilesystem: () => new VirtualFilesystem(),

  defaultInitialize: async (
    fs: Filesystem,
    mergeOpts?: Record<string, string>,
  ) => {
    await fs.initialize({ ...mergeOpts });
  },

  setup: async () => {},

  teardown: async () => {},

  mockEmptyDisk: async () => {},

  mockCreateFile: async (_filename: string) => {},

  mockFileExists: async (filename: string, fs: Filesystem) => {
    const res = await fs.open(filename, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await res.desc?.close();
  },

  mockDirectoryExists: async (dirname: string, fs: Filesystem) => {
    await fs.mkdirat(undefined, dirname);
  },

  mockCreatableDirectory: async (_dirname: string) => {
    // e.g., vfsMock.mkdir(dirname);
  },

  mockGetFileStoredData: async (filename: string, fs: Filesystem) => {
    const res = await fs.open(filename, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await res.desc?.close();
  },

  mockGetUndefinedStoredData: async () => {
    // Ensure that the VFS returns undefined for non-existent files
    // e.g., vfsMock.clearDisk();
  },

  mockDirectoryNotEmpty: async (dirname: string, fs: Filesystem) => {
    await fs.mkdirat(undefined, dirname);
    const res = await fs.open(`${dirname}/file`, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await res.desc?.close();
  },

  mockRemoveFileEntry: async (filename: string, fs: Filesystem) => {
    const res = await fs.open(filename, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await res.desc?.close();
  },

  mockRenameFile: async (oldName: string, _newName: string, fs: Filesystem) => {
    const res = await fs.open(oldName, 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await res.desc?.close();
  },
};

runFilesystemTests("vfs", vfsAdapter);

