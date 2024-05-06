import { ProcessInfo, FdTable } from "../../src/process-manager";

// @ts-ignore
export class DummyFilesystem implements Filesystem {
  fsname(): string {
    return "DummyFilesystem";
  }
}

export function dummyProcessInfos(pid: number): Record<number, ProcessInfo> {
  let pinfos: Record<number, ProcessInfo> = {};

  pinfos[pid] = new ProcessInfo(
    pid,
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
  );

  return pinfos;
}
