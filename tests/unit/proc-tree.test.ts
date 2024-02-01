import ProcessManager from "../../src/process-manager";
import { TopLevelFs } from "../../src/filesystem/top-level-fs";
import { DriverManager } from "../../src/filesystem/virtual-filesystem/driver-manager";
import * as proc from "../../src/filesystem/proc-filesystem/proc-tree";
import * as constants from "../../src/constants";
import { Filesystem } from "../../src/filesystem/filesystem";

// @ts-ignore
import { jest, test, expect, describe, afterEach, beforeEach, beforeAll } from "@jest/globals";

import { dummyProcessInfos, DummyFilesystem } from "./common";

jest.mock("../../src/process-manager");
jest.mock("../../src/filesystem/top-level-fs");
jest.mock("../../src/filesystem/virtual-filesystem/driver-manager");

describe("Test proc tree", () => {
  const topLevelFs = new TopLevelFs();
  const driverManager = new DriverManager();
  const processManager = new ProcessManager("foo", topLevelFs, driverManager);

  const pid = 1;
  let topLevelNode: proc.ProcDirectory;

  beforeAll(() => {
    topLevelNode = proc.getTopLevelNode(pid);
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
    proc.initialize(processManager);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("Self symlink should work", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const nodes = topLevelNode.listNodes();
    expect(nodes.err).toBe(constants.WASI_ESUCCESS);
    expect(Object.keys(nodes.nodes)).toContain("self");

    const procSymlink = topLevelNode.getNode("self");
    expect(procSymlink.err).toBe(constants.WASI_ESUCCESS);

    const filestat = procSymlink.node!.getFilestat();
    expect(filestat.filetype).toBe(constants.WASI_FILETYPE_SYMBOLIC_LINK);

    const contents = (procSymlink.node! as proc.ProcSymlink).read();

    expect(contents).toBe(String(pid));
  });

  test("Process directories should work", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const nodes = topLevelNode.listNodes();

    expect(nodes.err).toBe(constants.WASI_ESUCCESS);
    expect(Object.keys(nodes.nodes)).toContain(String(pid));

    const procDirectory = topLevelNode.getNode(String(pid));
    expect(procDirectory.err).toBe(constants.WASI_ESUCCESS);

    const filestat = procDirectory.node!.getFilestat();
    expect(filestat.filetype).toBe(constants.WASI_FILETYPE_DIRECTORY);
  });

  test("Mountinfo file should work", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));
    jest.spyOn(processManager, "filesystem", "get").mockReturnValue(topLevelFs);
    jest.spyOn(topLevelFs, "getMounts").mockImplementation(() => {
      // @ts-ignore
      const x: Record<string, Filesystem> = { foo: new DummyFilesystem() };
      return x;
    });

    const procDirectory = topLevelNode.getNode(String(pid))
      .node! as proc.ProcDirectory;

    const mountinfoFile = procDirectory.getNode("mountinfo");
    expect(mountinfoFile.err).toBe(constants.WASI_ESUCCESS);

    const filestat = mountinfoFile.node!.getFilestat();
    expect(filestat.filetype).toBe(constants.WASI_FILETYPE_REGULAR_FILE);

    const content = (mountinfoFile.node! as proc.ProcFile).read();
    expect(content).toBe("foo DummyFilesystem\n");
  });

  test("Reading invalid process directory should return proper error", () => {
    const wrongPid = 123;

    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const nodes = topLevelNode.listNodes();
    expect(nodes.err).toBe(constants.WASI_ESUCCESS);
    expect(Object.keys(nodes.nodes)).not.toContain(String(wrongPid));

    const wrongNode = topLevelNode.getNode(String(wrongPid));
    expect(wrongNode.err).toBe(constants.WASI_ENOENT);
  });

  test("Reading invalid special file should return proper error", () => {
    const wrongSpecialFile = "im_not_here";

    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const nodes = topLevelNode.listNodes();
    expect(nodes.err).toBe(constants.WASI_ESUCCESS);
    expect(Object.keys(nodes.nodes)).not.toContain(wrongSpecialFile);

    const wrongNode = topLevelNode.getNode(wrongSpecialFile);
    expect(wrongNode.err).toBe(constants.WASI_ENOENT);
  });
});
