import * as constants from "../../src/constants";
import { ProcFilesystem } from "../../src/filesystem/proc-filesystem/proc-filesystem";
import {
  ProcDirectoryDescriptor,
  ProcFileDescriptor,
} from "../../src/filesystem/proc-filesystem/proc-descriptors";
import ProcessManager from "../../src/process-manager";
import { DriverManager } from "../../src/filesystem/virtual-filesystem/devices/driver-manager";
import { TopLevelFs } from "../../src/filesystem/top-level-fs";
import { Filestat } from "../../src/filesystem/filesystem";
import * as proc from "../../src/filesystem/proc-filesystem/proc-tree";

// This import fails if there is no jest cache available. It could be caused by
// some misconfiguration or a bug in jest. ts-ignore works as an ad-hoc solution
// @ts-ignore
import { jest, test, expect, describe, afterEach, beforeEach, beforeAll } from "@jest/globals";

jest.mock("../../src/process-manager");
jest.mock("../../src/filesystem/top-level-fs");
jest.mock("../../src/filesystem/proc-filesystem/proc-tree");
jest.mock("../../src/filesystem/virtual-filesystem/devices/driver-manager");
jest.mock("../../src/filesystem/proc-filesystem/proc-descriptors");

class DummyProcFile implements proc.ProcFile {
  static filestat = {
    dev: 0n,
    ino: 0n,
    filetype: constants.WASI_FILETYPE_REGULAR_FILE,
    nlink: 1n,
    size: 0n,
    mtim: 0n,
    atim: 0n,
    ctim: 0n,
  };

  constructor(private contents: string) {}

  getFilestat(): Filestat {
    return DummyProcFile.filestat;
  }

  read(): string {
    return this.contents;
  }
}

class DummyProcDirectory implements proc.ProcDirectory {
  static filestat = {
    dev: 0n,
    ino: 0n,
    filetype: constants.WASI_FILETYPE_DIRECTORY,
    nlink: 1n,
    size: 0n,
    mtim: 0n,
    atim: 0n,
    ctim: 0n,
  };

  constructor(private contents: Record<string, proc.ProcNode>) {}

  getFilestat(): Filestat {
    return DummyProcDirectory.filestat;
  }

  listNodes(): { err: number; nodes: Record<string, proc.ProcNode> } {
    return {
      err: constants.WASI_ESUCCESS,
      nodes: this.contents,
    };
  }

  getNode(name: string): { err: number; node?: proc.ProcNode } {
    const node = this.contents[name];
    return {
      err: node === undefined ? constants.WASI_ENOENT : constants.WASI_ESUCCESS,
      node,
    };
  }
}

class DummyProcSymlink implements proc.ProcSymlink {
  static filestat = {
    dev: 0n,
    ino: 0n,
    filetype: constants.WASI_FILETYPE_SYMBOLIC_LINK,
    nlink: 1n,
    size: 0n,
    mtim: 0n,
    atim: 0n,
    ctim: 0n,
  };

  constructor(private target: string) {}

  getFilestat(): Filestat {
    return DummyProcSymlink.filestat;
  }

  read(): string {
    return this.target;
  }
}

describe("Test Proc filesystem", () => {
  const driverManager = new DriverManager();
  const topLevelFs = new TopLevelFs();
  const processManager = new ProcessManager("foo", topLevelFs, driverManager);
  let procFilesystem: ProcFilesystem;

  function simpleTLDMockFile(filename: string) {
    jest
      .spyOn(proc.TopLevelDirectory.prototype, "getNode")
      .mockImplementation(
        (name: string): { err: number; node: proc.ProcNode } => {
          if (name === filename) {
            return {
              err: constants.WASI_ESUCCESS,
              node: new DummyProcFile("foo"),
            };
          }
          return {
            err: constants.WASI_ENOENT,
            node: undefined,
          };
        }
      );
  }

  function simpleTLDMockDirectory(filename: string) {
    jest
      .spyOn(proc.TopLevelDirectory.prototype, "getNode")
      .mockImplementation(
        (name: string): { err: number; node: proc.ProcNode } => {
          if (name === filename) {
            return {
              err: constants.WASI_ESUCCESS,
              node: new DummyProcDirectory({}),
            };
          }
          return {
            err: constants.WASI_ENOENT,
            node: undefined,
          };
        }
      );
  }

  function simpleTLDMockSymlink(filename: string) {
    jest
      .spyOn(proc.TopLevelDirectory.prototype, "getNode")
      .mockImplementation(
        (name: string): { err: number; node: proc.ProcNode } => {
          if (name === filename) {
            return {
              err: constants.WASI_ESUCCESS,
              node: new DummyProcSymlink("target"),
            };
          }
          return {
            err: constants.WASI_ENOENT,
            node: undefined,
          };
        }
      );
  }

  beforeAll(() => {
    Object.defineProperty(processManager, "filesystem", {
      configurable: true,
      get() {
        return undefined;
      },
    });
    Object.defineProperty(processManager, "processInfos", {
      configurable: true,
      get() {
        return undefined;
      },
    });
  });

  beforeEach(() => {
    procFilesystem = new ProcFilesystem(processManager);

    jest.spyOn(proc, "getTopLevelNode").mockImplementation((pid: number) => {
      return new proc.TopLevelDirectory(pid);
    });

    jest
      .spyOn(proc.TopLevelDirectory.prototype, "getFilestat")
      .mockImplementation(() => {
        return {
          dev: 0n,
          ino: 0n,
          filetype: constants.WASI_FILETYPE_DIRECTORY,
          nlink: 1n,
          size: 0n,
          mtim: 0n,
          atim: 0n,
          ctim: 0n,
        };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Special files should yield proper filestats", async () => {
    const specialFileName = "super_special_file";
    simpleTLDMockFile(specialFileName);

    const getFilestatErr = await procFilesystem.getFilestat(specialFileName);
    // TODO: fix this once getFilestat is implemented
    expect(getFilestatErr.err).toBe(constants.WASI_ENOTSUP);
    // expect(getFilestatErr.filestat).toBe(DummyProcFile.filestat);
  });

  test("Special files should be openable", async () => {
    const specialFileName = "super_special_file";
    simpleTLDMockFile(specialFileName);

    const openErr = await procFilesystem.open(
      specialFileName,
      0,
      0,
      0n,
      0n,
      0,
      0
    );
    expect(openErr.err).toBe(constants.WASI_ESUCCESS);
    expect(openErr.index).toBe(-1);
    expect(ProcFileDescriptor).toHaveBeenCalled();
  });

  test("Special files should not be unlinkable", async () => {
    const specialFileName = "super_special_file";
    simpleTLDMockFile(specialFileName);

    const unlinkErr = await procFilesystem.unlinkat(
      undefined,
      specialFileName,
      false
    );
    expect(unlinkErr).toBe(constants.WASI_EACCES);
  });

  test("Files should not be creatable", async () => {
    const openErr = await procFilesystem.open(
      "file",
      0,
      constants.WASI_O_CREAT,
      0n,
      0n,
      0,
      0
    );
    expect(openErr.index).toBe(-1);
    expect(openErr.err).toBe(constants.WASI_EACCES);
  });

  test("Symlinks should be openable", async () => {
    const linkName = "special_symlink";
    simpleTLDMockSymlink(linkName);

    const openErr = await procFilesystem.open(linkName, 0, 0, 0n, 0n, 0, 0);
    expect(openErr.err).toBe(constants.WASI_ESUCCESS);
    expect(openErr.index).toBe(-1);
    expect(ProcDirectoryDescriptor).toHaveBeenCalled();
  });

  test("Symlinks should not be creatable", async () => {
    const symlinkErr = await procFilesystem.symlinkat(
      "super_special_file",
      undefined,
      "symlink"
    );
    expect(symlinkErr).toBe(constants.WASI_EACCES);
  });

  test("Symlinks should not be unlinkable", async () => {
    const symlinkName = "symlink";
    simpleTLDMockSymlink(symlinkName);

    const unlinkErr = await procFilesystem.unlinkat(
      undefined,
      symlinkName,
      false
    );
    expect(unlinkErr).toBe(constants.WASI_EACCES);
  });

  test("Open should return proper index when symlink found", async () => {
    const symlinkName = "symlink";
    simpleTLDMockSymlink(symlinkName);

    const openErr = await procFilesystem.open(
      `${symlinkName}/something/else`,
      0,
      0,
      0n,
      0n,
      0,
      0
    );

    expect(openErr.err).toBe(constants.WASI_ENOTDIR);
    expect(openErr.index).toBe(symlinkName.length);
    expect(ProcFileDescriptor).toHaveBeenCalled();
    expect(openErr).not.toBeUndefined();
  });

  test("Directories should be openable", async () => {
    const dirName = "special_directory";
    simpleTLDMockDirectory(dirName);

    const openErr = await procFilesystem.open(
      dirName,
      0,
      constants.WASI_O_DIRECTORY,
      0n,
      0n,
      0,
      0
    );
    expect(openErr.err).toBe(constants.WASI_ESUCCESS);
    expect(openErr.index).toBe(-1);
    expect(ProcDirectoryDescriptor).toHaveBeenCalled();
  });

  test("Directories should not be creatable", async () => {
    const mkdirErr = await procFilesystem.mkdirat(undefined, "directory");
    expect(mkdirErr).toBe(constants.WASI_EACCES);
  });

  test("Directories should not be removable", async () => {
    const directoryName = "special_directory";
    simpleTLDMockDirectory(directoryName);

    const rmdirErr = await procFilesystem.unlinkat(
      undefined,
      directoryName,
      true
    );
    expect(rmdirErr).toBe(constants.WASI_EACCES);
  });

  test("Devices should not be creatable", async () => {
    const mkdirErr = await procFilesystem.mknodat(undefined, "device", 0, {});
    expect(mkdirErr).toBe(constants.WASI_EACCES);
  });
});
