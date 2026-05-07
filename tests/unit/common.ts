import { ProcessInfo, FdTable } from "../../src/process-manager";
import { Filesystem } from "../../src/filesystem/filesystem"

// @ts-ignore
export class DummyFilesystem implements Filesystem {
  fsname(): string {
    return "DummyFilesystem";
  }
}

export function dummyProcessInfos(pid: number): Record<number, ProcessInfo> {
  let pinfos: Record<number, ProcessInfo> = {};

  pinfos[pid] = {
    pid: pid,
    cmd: "foo",
    // @ts-ignore
    worker: undefined,
    fds: new FdTable({}),
    parentId: null,
    parentLock: null,
    callback: async () => {},
    env: {
      foo: "bar",
      bar: "baz",
    },
    cwd: "bar",
    isJob: false,
    foreground: null,
    children: [],
  };

  return pinfos;
}
