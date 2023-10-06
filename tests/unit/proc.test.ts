import * as constants from "../../src/constants";
import { ProcFilesystem } from "../../src/filesystem/proc-filesystem/proc-filesystem";
import ProcessManager from "../../src/process-manager";
import { ProcessInfo, FdTable } from "../../src/process-manager";
import { DriverManager } from "../../src/filesystem/virtual-filesystem/driver-manager";
import { TopLevelFs } from "../../src/filesystem/top-level-fs";
import { Filesystem } from "../../src/filesystem/filesystem";

jest.mock("../../vendor/idb-keyval.js");
jest.mock("../../src/process-manager");
jest.mock("../../src/filesystem/top-level-fs");

// @ts-ignore
class DummyFilesystem implements Filesystem {}

describe("Test Proc filesystem", () => {
  const driverManager = new DriverManager();
  const topLevelFs = new TopLevelFs();
  const processManager = new ProcessManager("foo", topLevelFs, driverManager);
  let procFilesystem: ProcFilesystem;

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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("MountInfoFile", async () => {
    jest.spyOn(processManager, "filesystem", "get").mockReturnValue(topLevelFs);
    jest.spyOn(processManager, "processInfos", "get").mockReturnValue({
      0: new ProcessInfo(
        0,
        "foo",
        undefined,
        new FdTable({}),
        null,
        null,
        async () => {},
        {},
        "bar",
        false,
        null
      ),
    });

    jest.spyOn(topLevelFs, "getMounts").mockImplementation(() => {
      // @ts-ignore
      const x: Record<string, Filesystem> = { foo: new DummyFilesystem() };
      return x;
    });

    const desc = await procFilesystem.open("/0/mountinfo", 0, 0, 0n, 0n, 0, 0);

    expect(desc.err).toBe(constants.WASI_ESUCCESS);
    expect(desc.index).toBe(-1);

    const read_stat = await desc.desc.read_str();

    expect(read_stat.err).toBe(constants.WASI_ESUCCESS);
    expect(read_stat.content).toBe("foo DummyFilesystem\n");
  });
});
