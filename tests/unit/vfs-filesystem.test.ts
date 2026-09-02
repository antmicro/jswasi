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

  mockCreatableSymlink: async (_linkname: string) => {},

  mockSymlinkExists: async (linkname: string, fs: Filesystem) => {
    await fs.symlinkat("target", undefined, linkname);
  },
};

runFilesystemTests("vfs", vfsAdapter);

import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";

describe("Test VirtualFilesystem Descriptor I/O", () => {
  let fs: VirtualFilesystem;

  beforeEach(async () => {
    fs = new VirtualFilesystem();
    await fs.initialize({});
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test("Writing and reading data sequentially should advance the cursor", async () => {
    const openRes = await fs.open(
      "test_io.txt",
      0,
      constants.WASI_O_CREAT,
      0n,
      0n,
      0,
      0,
    );
    expect(openRes.err).toBe(constants.WASI_ESUCCESS);
    const desc = openRes.desc;

    const testData = new TextEncoder().encode("Hello, World!");
    const writeRes = await desc.write(testData.buffer);
    expect(writeRes.err).toBe(constants.WASI_ESUCCESS);
    expect(writeRes.written).toBe(BigInt(testData.byteLength));

    // Rewind cursor to beginning
    const seekRes = await desc.seek(0n, constants.WASI_WHENCE_SET);
    expect(seekRes.err).toBe(constants.WASI_ESUCCESS);
    expect(seekRes.offset).toBe(0n);

    // Read first 5 bytes ("Hello")
    const read1 = await desc.read(5);
    expect(read1.err).toBe(constants.WASI_ESUCCESS);
    expect(new TextDecoder().decode(read1.buffer)).toBe("Hello");

    // Read next 2 bytes (", ")
    const read2 = await desc.read(2);
    expect(read2.err).toBe(constants.WASI_ESUCCESS);
    expect(new TextDecoder().decode(read2.buffer)).toBe(", ");

    // Read remaining bytes
    const read3 = await desc.read(100);
    expect(read3.err).toBe(constants.WASI_ESUCCESS);
    expect(new TextDecoder().decode(read3.buffer)).toBe("World!");

    // Read at EOF should return 0 bytes
    const readEof = await desc.read(10);
    expect(readEof.err).toBe(constants.WASI_ESUCCESS);
    expect(readEof.buffer.byteLength).toBe(0);

    await desc.close();
  });

  test("read_str and arrayBuffer should return complete content", async () => {
    const openRes = await fs.open(
      "test_str.txt",
      0,
      constants.WASI_O_CREAT,
      0n,
      0n,
      0,
      0,
    );
    const desc = openRes.desc;

    const content = "Full string content 12345";
    await desc.write(new TextEncoder().encode(content).buffer);

    const strRes = await desc.read_str();
    expect(strRes.err).toBe(constants.WASI_ESUCCESS);
    expect(strRes.content).toBe(content);

    const bufRes = await desc.arrayBuffer();
    expect(bufRes.err).toBe(constants.WASI_ESUCCESS);
    expect(new TextDecoder().decode(bufRes.buffer)).toBe(content);

    await desc.close();
  });

  test("pread and pwrite should perform positional I/O without moving the cursor", async () => {
    const openRes = await fs.open(
      "test_pos.txt",
      0,
      constants.WASI_O_CREAT,
      0n,
      0n,
      0,
      0,
    );
    const desc = openRes.desc;

    await desc.write(new TextEncoder().encode("AAAAABBBBB").buffer);

    // Position cursor at 3
    await desc.seek(3n, constants.WASI_WHENCE_SET);

    // pwrite "XXXX" at offset 5
    const pwriteRes = await desc.pwrite(
      new TextEncoder().encode("XXXX").buffer,
      5n,
    );
    expect(pwriteRes.err).toBe(constants.WASI_ESUCCESS);
    expect(pwriteRes.written).toBe(4n);

    // pread 4 bytes at offset 5
    const preadRes = await desc.pread(4, 5n);
    expect(preadRes.err).toBe(constants.WASI_ESUCCESS);
    expect(new TextDecoder().decode(preadRes.buffer)).toBe("XXXX");

    // Sequential read should still continue from cursor position 3
    const seqRead = await desc.read(4);
    expect(seqRead.err).toBe(constants.WASI_ESUCCESS);
    expect(new TextDecoder().decode(seqRead.buffer)).toBe("AAXX");

    await desc.close();
  });

  test("Directory descriptors should reject read and write with WASI_EISDIR", async () => {
    await fs.mkdirat(undefined, "dir_io");
    const openRes = await fs.open(
      "dir_io",
      0,
      constants.WASI_O_DIRECTORY,
      0n,
      0n,
      0,
      0,
    );
    expect(openRes.err).toBe(constants.WASI_ESUCCESS);
    const desc = openRes.desc;

    const readRes = await desc.read(10);
    expect(readRes.err).toBe(constants.WASI_EISDIR);

    const writeRes = await desc.write(new ArrayBuffer(10));
    expect(writeRes.err).toBe(constants.WASI_EISDIR);

    const preadRes = await desc.pread(10, 0n);
    expect(preadRes.err).toBe(constants.WASI_EISDIR);

    const pwriteRes = await desc.pwrite(new ArrayBuffer(10), 0n);
    expect(pwriteRes.err).toBe(constants.WASI_EISDIR);

    const readStrRes = await desc.read_str();
    expect(readStrRes.err).toBe(constants.WASI_EISDIR);

    const arrayBufRes = await desc.arrayBuffer();
    expect(arrayBufRes.err).toBe(constants.WASI_EISDIR);

    await desc.close();
  });
});

describe("Test VirtualFilesystem Descriptor Seek", () => {
  let fs: VirtualFilesystem;

  beforeEach(async () => {
    fs = new VirtualFilesystem();
    await fs.initialize({});
  });

  test("seek with WASI_WHENCE_SET", async () => {
    const openRes = await fs.open("seek_test.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    const desc = openRes.desc;
    await desc.write(new TextEncoder().encode("0123456789").buffer);

    // Seek to 5
    const res1 = await desc.seek(5n, constants.WASI_WHENCE_SET);
    expect(res1.err).toBe(constants.WASI_ESUCCESS);
    expect(res1.offset).toBe(5n);

    const readRes = await desc.read(2);
    expect(new TextDecoder().decode(readRes.buffer)).toBe("56");

    // Seek to negative offset should fail
    const resNegative = await desc.seek(-1n, constants.WASI_WHENCE_SET);
    expect(resNegative.err).toBe(constants.WASI_EINVAL);

    await desc.close();
  });

  test("seek with WASI_WHENCE_CUR", async () => {
    const openRes = await fs.open("seek_cur.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    const desc = openRes.desc;
    await desc.write(new TextEncoder().encode("0123456789").buffer);

    // Initial position at 10 (after write), move to 4
    await desc.seek(4n, constants.WASI_WHENCE_SET);

    // Move forward by 3 -> 7
    const res1 = await desc.seek(3n, constants.WASI_WHENCE_CUR);
    expect(res1.err).toBe(constants.WASI_ESUCCESS);
    expect(res1.offset).toBe(7n);

    // Move backward by 2 -> 5
    const res2 = await desc.seek(-2n, constants.WASI_WHENCE_CUR);
    expect(res2.err).toBe(constants.WASI_ESUCCESS);
    expect(res2.offset).toBe(5n);

    // Move backward past start -> EINVAL
    const resUnderflow = await desc.seek(-10n, constants.WASI_WHENCE_CUR);
    expect(resUnderflow.err).toBe(constants.WASI_EINVAL);

    await desc.close();
  });

  test("seek with WASI_WHENCE_END", async () => {
    const openRes = await fs.open("seek_end.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    const desc = openRes.desc;
    await desc.write(new TextEncoder().encode("0123456789").buffer); // length 10

    // Seek to end - 3 -> 7
    const res1 = await desc.seek(-3n, constants.WASI_WHENCE_END);
    expect(res1.err).toBe(constants.WASI_ESUCCESS);
    expect(res1.offset).toBe(7n);

    const readRes = await desc.read(3);
    expect(new TextDecoder().decode(readRes.buffer)).toBe("789");

    // Seek before start (less than -10) -> EINVAL
    const resInvalid = await desc.seek(-15n, constants.WASI_WHENCE_END);
    expect(resInvalid.err).toBe(constants.WASI_EINVAL);

    await desc.close();
  });
});

describe("Test VirtualFilesystem Descriptor Truncate", () => {
  let fs: VirtualFilesystem;

  beforeEach(async () => {
    fs = new VirtualFilesystem();
    await fs.initialize({});
  });

  test("Truncating file to smaller size should shorten data and update filestat", async () => {
    const openRes = await fs.open("trunc.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    const desc = openRes.desc;
    await desc.write(new TextEncoder().encode("Hello, World!").buffer); // 12 bytes

    const truncRes = await desc.truncate(5n);
    expect(truncRes).toBe(constants.WASI_ESUCCESS);

    const stat = await desc.getFilestat();
    expect(stat.err).toBe(constants.WASI_ESUCCESS);
    expect(stat.filestat.size).toBe(5n);

    await desc.seek(0n, constants.WASI_WHENCE_SET);
    const readRes = await desc.read(100);
    expect(new TextDecoder().decode(readRes.buffer)).toBe("Hello");

    await desc.close();
  });

  test("Truncating directory descriptor should return WASI_EISDIR", async () => {
    await fs.mkdirat(undefined, "trunc_dir");
    const openRes = await fs.open("trunc_dir", 0, constants.WASI_O_DIRECTORY, 0n, 0n, 0, 0);
    const desc = openRes.desc;

    const truncRes = await desc.truncate(0n);
    expect(truncRes).toBe(constants.WASI_EISDIR);

    await desc.close();
  });
});

describe("Test VirtualFilesystem Directory readdir", () => {
  let fs: VirtualFilesystem;

  beforeEach(async () => {
    fs = new VirtualFilesystem();
    await fs.initialize({});
  });

  test("readdir should list directory entries without . and ..", async () => {
    await fs.mkdirat(undefined, "test_dir");
    const f1 = await fs.open("test_dir/alpha.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f1.desc.close();
    const f2 = await fs.open("test_dir/beta.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f2.desc.close();
    await fs.mkdirat(undefined, "test_dir/sub");

    const dirRes = await fs.open("test_dir", 0, constants.WASI_O_DIRECTORY, 0n, 0n, 0, 0);
    expect(dirRes.err).toBe(constants.WASI_ESUCCESS);
    const dirDesc = dirRes.desc;

    const readdirRes = await dirDesc.readdir(false);
    expect(readdirRes.err).toBe(constants.WASI_ESUCCESS);

    const names = readdirRes.dirents.map((d) => d.name);
    expect(names).toContain("alpha.txt");
    expect(names).toContain("beta.txt");
    expect(names).toContain("sub");
    expect(names).not.toContain(".");
    expect(names).not.toContain("..");

    // Check d_type
    const alphaDirent = readdirRes.dirents.find((d) => d.name === "alpha.txt");
    expect(alphaDirent?.d_type).toBe(constants.WASI_FILETYPE_REGULAR_FILE);

    const subDirent = readdirRes.dirents.find((d) => d.name === "sub");
    expect(subDirent?.d_type).toBe(constants.WASI_FILETYPE_DIRECTORY);

    // Refresh readdir after adding another file
    const f3 = await fs.open("test_dir/gamma.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f3.desc.close();

    const cachedRes = await dirDesc.readdir(false);
    expect(cachedRes.dirents.map((d) => d.name)).not.toContain("gamma.txt");

    const refreshedRes = await dirDesc.readdir(true);
    expect(refreshedRes.dirents.map((d) => d.name)).toContain("gamma.txt");

    await dirDesc.close();
  });

  test("Calling readdir on a file descriptor should return WASI_ENOTDIR", async () => {
    const f = await fs.open("file.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    const readdirRes = await f.desc.readdir(false);
    expect(readdirRes.err).toBe(constants.WASI_ENOTDIR);
    await f.desc.close();
  });
});

describe("Test VirtualFilesystem symlinkat and Symlinks", () => {
  let fs: VirtualFilesystem;

  beforeEach(async () => {
    fs = new VirtualFilesystem();
    await fs.initialize({});
  });

  test("symlinkat creates symbolic link that can be read", async () => {
    // Create target file
    const target = await fs.open("target.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await target.desc.write(new TextEncoder().encode("target content").buffer);
    await target.desc.close();

    // Create symlink
    const symlinkErr = await fs.symlinkat("target.txt", undefined, "link.txt");
    expect(symlinkErr).toBe(constants.WASI_ESUCCESS);

    // Open symlink
    const linkRes = await fs.open("link.txt", 0, 0, 0n, 0n, 0, 0);
    expect(linkRes.err).toBe(constants.WASI_ESUCCESS);
    const linkDesc = linkRes.desc;
    expect(linkDesc.getFdstat().fs_filetype).toBe(constants.WASI_FILETYPE_SYMBOLIC_LINK);

    const readLink = await linkDesc.read_str();
    expect(readLink.err).toBe(constants.WASI_ESUCCESS);
    expect(readLink.content).toBe("target.txt");
    await linkDesc.close();
  });

  test("symlinkat should fail if linkpath already exists", async () => {
    const f = await fs.open("existing.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f.desc.close();

    const err = await fs.symlinkat("some_target", undefined, "existing.txt");
    expect(err).toBe(constants.WASI_EEXIST);
  });
});

describe("Test VirtualFilesystem Extended unlinkat and renameat", () => {
  let fs: VirtualFilesystem;

  beforeEach(async () => {
    fs = new VirtualFilesystem();
    await fs.initialize({});
  });

  test("unlinkat removes empty directory with is_dir true and fails if not empty", async () => {
    await fs.mkdirat(undefined, "parent");
    await fs.mkdirat(undefined, "parent/empty_dir");
    await fs.mkdirat(undefined, "parent/non_empty_dir");
    const f = await fs.open("parent/non_empty_dir/child.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f.desc.close();

    // Removing non-empty directory should fail
    const notEmptyErr = await fs.unlinkat(undefined, "parent/non_empty_dir", true);
    expect(notEmptyErr).toBe(constants.WASI_ENOTEMPTY);

    // Removing empty directory should succeed
    const emptyErr = await fs.unlinkat(undefined, "parent/empty_dir", true);
    expect(emptyErr).toBe(constants.WASI_ESUCCESS);

    // Removing regular file with is_dir true should fail with ENOTDIR
    const fileRes = await fs.open("regular.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await fileRes.desc.close();
    const enotdirErr = await fs.unlinkat(undefined, "regular.txt", true);
    expect(enotdirErr).toBe(constants.WASI_ENOTDIR);
  });

  test("unlinkat with parent directory descriptor", async () => {
    await fs.mkdirat(undefined, "my_dir");
    const f = await fs.open("my_dir/item.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f.desc.close();

    const dirRes = await fs.open("my_dir", 0, constants.WASI_O_DIRECTORY, 0n, 0n, 0, 0);
    const dirDesc = dirRes.desc;

    const unlinkRes = await fs.unlinkat(dirDesc, "item.txt", false);
    expect(unlinkRes).toBe(constants.WASI_ESUCCESS);

    const readdirRes = await dirDesc.readdir(true);
    expect(readdirRes.dirents.length).toBe(0);

    await dirDesc.close();
  });

  test("renameat overwriting existing destination file", async () => {
    const f1 = await fs.open("source.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f1.desc.write(new TextEncoder().encode("source data").buffer);
    await f1.desc.close();

    const f2 = await fs.open("dest.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f2.desc.write(new TextEncoder().encode("old dest data").buffer);
    await f2.desc.close();

    const renameErr = await fs.renameat(undefined, "source.txt", undefined, "dest.txt");
    expect(renameErr).toBe(constants.WASI_ESUCCESS);

    // source.txt should no longer exist
    const sourceStat = await fs.getFilestat("source.txt");
    expect(sourceStat.err).toBe(constants.WASI_ENOENT);

    // dest.txt should contain "source data"
    const destRes = await fs.open("dest.txt", 0, 0, 0n, 0n, 0, 0);
    expect(destRes.err).toBe(constants.WASI_ESUCCESS);
    const readRes = await destRes.desc.read_str();
    expect(readRes.content).toBe("source data");
    await destRes.desc.close();
  });

  test("renameat renaming directory and cross-directory move", async () => {
    await fs.mkdirat(undefined, "dir1");
    await fs.mkdirat(undefined, "dir2");
    const f = await fs.open("dir1/file.txt", 0, constants.WASI_O_CREAT, 0n, 0n, 0, 0);
    await f.desc.close();

    const renameErr = await fs.renameat(undefined, "dir1/file.txt", undefined, "dir2/moved.txt");
    expect(renameErr).toBe(constants.WASI_ESUCCESS);

    const oldStat = await fs.getFilestat("dir1/file.txt");
    expect(oldStat.err).toBe(constants.WASI_ENOENT);

    const newStat = await fs.getFilestat("dir2/moved.txt");
    expect(newStat.err).toBe(constants.WASI_ESUCCESS);
  });
});
