import ProcessManager, { type ProcessInfo } from "../../src/process-manager";
import { TopLevelFs } from "../../src/filesystem/top-level-fs";
import { DriverManager } from "../../src/filesystem/virtual-filesystem/devices/driver-manager";
import * as proc from "../../src/filesystem/proc-filesystem/proc-tree";
import * as constants from "../../src/constants";
import { Filesystem } from "../../src/filesystem/filesystem";

import { jest, test, expect, describe, afterEach, beforeEach, beforeAll } from "@jest/globals";

import { dummyProcessInfos, DummyFilesystem, dummyThreadInfos } from "./common";

jest.mock("../../src/process-manager");
jest.mock("../../src/filesystem/top-level-fs");
jest.mock("../../src/filesystem/virtual-filesystem/devices/driver-manager");

describe("Test proc tree", () => {
  const topLevelFs = new TopLevelFs();
  const driverManager = new DriverManager();
  const processManager = new ProcessManager("foo", topLevelFs, driverManager);

  const pid = 1;
  const tgid = pid;
  const tid = tgid + 1;

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

  test("Process directory should be listed but thread directory should not be listed", () => {
    const mockedProcessInfos: Record<number, ProcessInfo> = {
      ...dummyProcessInfos(tgid),
      ...dummyThreadInfos(tgid, tid),
    };
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(mockedProcessInfos);

    const nodes = topLevelNode.listNodes();

    expect(nodes.err).toBe(constants.WASI_ESUCCESS);
    expect(Object.keys(nodes.nodes)).toContain(String(tgid));
    expect(Object.keys(nodes.nodes)).not.toContain(String(tid));
  })

  test("Thread directory contents should be listable", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyThreadInfos(tgid, tid));

    const expectedNodes = ["mountinfo", "status", "cwd", "environ", "stat", "task"];
    const threadDirectory = topLevelNode.getNode(String(tid));
    expect(threadDirectory.err).toBe(constants.WASI_ESUCCESS);

    const nodes = (threadDirectory.node! as proc.ProcDirectory).listNodes();
    expect(nodes.err).toBe(constants.WASI_ESUCCESS);

    expect(Object.keys(nodes.nodes).length).toBeGreaterThan(0);
    for (const node of Object.keys(nodes.nodes)) {
      expect(expectedNodes).toContain(node);
    }
  })

  test("Task list directory should work", () => {
    const mockedTgid = 1;
    const mockedTid = 2;

    const mockedProcessInfos: Record<number, ProcessInfo> = {
      ...dummyProcessInfos(mockedTgid),
      ...dummyThreadInfos(mockedTgid, mockedTid),
    };

    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(mockedProcessInfos);

    const parentDirectory = topLevelNode.getNode(String(mockedTgid));
    expect(parentDirectory.err).toBe(constants.WASI_ESUCCESS);

    const taskListDirectory = (parentDirectory.node! as proc.ProcDirectory).getNode("task");
    expect(taskListDirectory.err).toBe(constants.WASI_ESUCCESS);

    const expectedNodes = [mockedTgid.toString(), mockedTid.toString()];
    const nodes = (taskListDirectory.node! as proc.ProcDirectory).listNodes();
    expect(nodes.err).toBe(constants.WASI_ESUCCESS);

    expect(Object.keys(nodes.nodes).length).toBeGreaterThan(0);
    for (const node of Object.keys(nodes.nodes)) {
      expect(expectedNodes).toContain(node);
    }
  })

  test("Task directory should work", () => {
    const mockedTgid = 1;
    const mockedTid = 2;

    const mockedProcessInfos: Record<number, ProcessInfo> = {
      ...dummyProcessInfos(mockedTgid),
      ...dummyThreadInfos(mockedTgid, mockedTid),
    };

    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(mockedProcessInfos);

    const parentDirectory = topLevelNode.getNode(String(mockedTgid));
    expect(parentDirectory.err).toBe(constants.WASI_ESUCCESS);

    const taskListDirectory = (parentDirectory.node! as proc.ProcDirectory).getNode("task");
    expect(taskListDirectory.err).toBe(constants.WASI_ESUCCESS);

    const taskDirectory = (taskListDirectory.node! as proc.ProcDirectory).getNode(mockedTgid.toString());
    expect(taskDirectory.err).toBe(constants.WASI_ESUCCESS);

    const expectedNodes = ["mountinfo", "status", "cwd", "environ", "stat"];
    const nodes = (taskDirectory.node! as proc.ProcDirectory).listNodes();
    expect(nodes.err).toBe(constants.WASI_ESUCCESS);

    expect(Object.keys(nodes.nodes).length).toBeGreaterThan(0);
    for (const node of Object.keys(nodes.nodes)) {
      expect(expectedNodes).toContain(node);
    }

    expect((taskDirectory.node! as proc.ProcDirectory).getNode("stat").err).toBe(constants.WASI_ESUCCESS);
  })

  test("Thread status file should have valid PID and TGID", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyThreadInfos(tgid, tid));

    const threadDirectory = topLevelNode.getNode(String(tid));
    expect(threadDirectory.err).toBe(constants.WASI_ESUCCESS);

    const statusFile = (threadDirectory.node! as proc.ProcDirectory).getNode("status");
    expect(statusFile.err).toBe(constants.WASI_ESUCCESS);

    const contents = (statusFile.node! as proc.ProcFile).read();
    expect(contents).toContain(`Pid:\t${tid}`);
    expect(contents).toContain(`Tgid:\t${tgid}`);
  })

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

  test("Cwd symlink should work", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const procDirectory = topLevelNode.getNode(String(pid))
      .node! as proc.ProcDirectory;

    const cwdFile = procDirectory.getNode("cwd");
    expect(cwdFile.err).toBe(constants.WASI_ESUCCESS);

    const filestat = cwdFile.node!.getFilestat();
    expect(filestat.filetype).toBe(constants.WASI_FILETYPE_SYMBOLIC_LINK);

    expect((cwdFile.node! as proc.ProcSymlink).read()).toBe(
      processManager.processInfos[pid].cwd,
    );
  });

  test("Environ file should work", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const procDirectory = topLevelNode.getNode(String(pid))
      .node! as proc.ProcDirectory;

    const environFile = procDirectory.getNode("environ");
    expect(environFile.err).toBe(constants.WASI_ESUCCESS);

    const filestat = environFile.node!.getFilestat();
    expect(filestat.filetype).toBe(constants.WASI_FILETYPE_REGULAR_FILE);

    const contents = (environFile.node! as proc.ProcFile).read();
    const expectedEnv = processManager.processInfos[pid].env;

    expect(Object.keys(expectedEnv).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(expectedEnv)) {
      expect(contents).toContain(`${key}=${value}\0`);
    }
  });

  test("Meminfo file should not exist on unsupported browsers", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const nodes = topLevelNode.listNodes();
    expect(nodes.err).toBe(constants.WASI_ESUCCESS);
    expect(Object.keys(nodes.nodes)).not.toContain("meminfo");

    const meminfoFile = topLevelNode.getNode("meminfo");
    expect(meminfoFile.err).toBe(constants.WASI_ENOENT);
    expect(meminfoFile.node).toBe(undefined);
  });

  test("Meminfo file should work on supported browsers", () => {
    const memoryMock = {
      jsHeapSizeLimit: 4096,
      usedJSHeapSize: 1024,
    };

    Object.defineProperty(global.performance, "memory", {
      value: memoryMock,
      configurable: true,
    });

    let topLevelNode;

    jest.isolateModules(() => {
      // Used to reload the specialNodes records with performance.memory available
      const isolatedProc = require("../../src/filesystem/proc-filesystem/proc-tree");
      isolatedProc.initialize(processManager);

      topLevelNode = isolatedProc.getTopLevelNode(pid);
    });

    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const nodes = topLevelNode!.listNodes();
    expect(nodes.err).toBe(constants.WASI_ESUCCESS);
    expect(Object.keys(nodes.nodes)).toContain("meminfo");

    const meminfoFile = topLevelNode!.getNode("meminfo");
    expect(meminfoFile.err).toBe(constants.WASI_ESUCCESS);

    const contents = (meminfoFile.node as proc.ProcFile).read();

    expect(contents).toContain("MemTotal:              4 kB");
    expect(contents).toContain("MemFree:               3 kB");
    expect(contents).toContain("MemAvailable:          3 kB");

    delete (global.performance as any).memory;
  });

  test("Status file should contain basic info", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const procDirectory = topLevelNode.getNode(String(pid))
      .node! as proc.ProcDirectory;

    const statusFile = procDirectory.getNode("status");
    expect(statusFile.err).toBe(constants.WASI_ESUCCESS);

    const filestat = statusFile.node!.getFilestat();
    expect(filestat.filetype).toBe(constants.WASI_FILETYPE_REGULAR_FILE);

    const contents = (statusFile.node! as proc.ProcFile).read();

    expect(contents).toContain(
      `Name:\t${processManager.processInfos[pid].cmd}`,
    );
    expect(contents).toContain(`Pid:\t${pid}`);
  });

  test("Stat file should exist and be not empty", () => {
    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    const procDirectory = topLevelNode.getNode(String(pid))
      .node! as proc.ProcDirectory;

    const statFile = procDirectory.getNode("stat");
    expect(statFile.err).toBe(constants.WASI_ESUCCESS);

    const filestat = statFile.node!.getFilestat();
    expect(filestat.filetype).toBe(constants.WASI_FILETYPE_REGULAR_FILE);

    const contents = (statFile.node! as proc.ProcFile).read();
    const info = processManager.processInfos[pid];

    // At least starts with process pid
    expect(contents).toMatch(new RegExp(`^${info.id}`));
  });

  test("Reset should work", () => {
    const reloadMock = jest.fn();

    jest
      .spyOn(processManager, "processInfos", "get")
      .mockReturnValue(dummyProcessInfos(pid));

    Object.defineProperty(global, "location", {
      value: { reload: reloadMock },
    });

    const sysDirectory = topLevelNode.getNode("sys");
    expect(sysDirectory.err).toBe(constants.WASI_ESUCCESS);

    const sysFilestat = sysDirectory.node!.getFilestat();
    expect(sysFilestat.filetype).toBe(constants.WASI_FILETYPE_DIRECTORY);

    const resetFile = (sysDirectory.node! as proc.ProcDirectory).getNode(
      "reset",
    );
    expect(resetFile.err).toBe(constants.WASI_ESUCCESS);

    const resetFilestat = resetFile.node!.getFilestat();
    expect(resetFilestat.filetype).toBe(constants.WASI_FILETYPE_REGULAR_FILE);

    const buffer = new TextEncoder().encode("test");
    const res = (resetFile.node! as proc.ProcFile).write(buffer.buffer);
    expect(res.err).toBe(constants.WASI_ESUCCESS);
    expect(res.written).toBe(BigInt(buffer.byteLength));

    expect(reloadMock).toHaveBeenCalled();

    Object.defineProperty(global, "location", {});
  });
});
