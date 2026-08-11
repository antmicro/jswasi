import { Descriptor } from "./filesystem/filesystem.js";
import * as constants from "./constants.js";
import { TopLevelFs } from "./filesystem/top-level-fs";
// @ts-ignore
import * as vfs from "./third_party/vfs.js";
import { major } from "./filesystem/virtual-filesystem/devices/driver-manager.js";

const WRITE_FIFO_PATH = "/dev/initr.kfifo";
const READ_FIFO_PATH = "/dev/initw.kfifo";

type Operation = {
  Spawn: SpawnArgs,
}

type SpawnArgs = {
  cmd: string,
  stdin?: string,
  stdout?: string,
  stderr?: string,
  args: string[],
  env?: Record<string, string>,
  kern: boolean,
}

export class JsInterface {
  private fifow: Descriptor;
  private fifor: Descriptor;
  private tfs: TopLevelFs;

  public async initialize(tfs: TopLevelFs): Promise<number> {
    this.tfs = tfs;

    let _res;
    _res = await tfs.open(
      READ_FIFO_PATH,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      0, 0,
      constants.WASI_EXT_RIGHTS_STDIN,
      constants.WASI_EXT_RIGHTS_STDIN,
    );
    if (_res.err !== constants.WASI_ESUCCESS)
      return _res.err;

    this.fifor = _res.desc;

    _res = await tfs.open(
      WRITE_FIFO_PATH,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      0, 0,
      constants.WASI_EXT_RIGHTS_STDOUT,
      constants.WASI_EXT_RIGHTS_STDOUT,
    );
    if (_res.err !== constants.WASI_ESUCCESS)
      return _res.err;

    this.fifow = _res.desc;

    return constants.WASI_ESUCCESS;
  }

  public async spawn(cmd: string, args: string[], env?: Record<string, string>): Promise<{
    stdin: Descriptor;
    stdout: Descriptor;
    stderr: Descriptor;
    pid: number;
  }> {
    const operation: Operation = {
      Spawn: {
        cmd,
        args,
        env,
        kern: true,
      },
    };
    const arr = new TextEncoder().encode(JSON.stringify(operation));
    await this.fifow.write(arr.buffer as ArrayBuffer);

    const { err, buffer } = await this.fifor.read(64);
    if (err !== constants.WASI_ESUCCESS)
      throw new Error("Could not spawn process");

    const __split = new TextDecoder().decode(buffer).split(" ");
    const id = Number(__split[0]);
    const pid = Number(__split[1]);

    let resp = await this.tfs.open(`/dev/spawn_stdin.${id}`, 0, 0, 0, constants.WASI_EXT_RIGHTS_STDOUT);
    if (resp.err !== constants.WASI_ESUCCESS)
      throw new Error("Could not open stdin descriptor");
    const stdin = resp.desc;

    resp = await this.tfs.open(`/dev/spawn_stdout.${id}`, 0, 0, 0, constants.WASI_EXT_RIGHTS_STDIN);
    if (resp.err !== constants.WASI_ESUCCESS)
      throw new Error("Could not open stdout descriptor");
    const stdout = resp.desc;

    resp = await this.tfs.open(`/dev/spawn_stderr.${id}`, 0, 0, 0, constants.WASI_EXT_RIGHTS_STDIN);
    if (resp.err !== constants.WASI_ESUCCESS)
      throw new Error("Could not open stderr descriptor");
    const stderr = resp.desc;

    return { stdin, stdout, stderr, pid };
  }

  public async startTerminalProcess(cmd: string , args: string[], min: number, env?: Record<string, string>): Promise<number> {
    const ttyPath = `/dev/ttyH${min}`
    const err = await this.tfs.mknodat(undefined, ttyPath, vfs.mkDev(major.MAJ_HTERM, min), -1);
    if (err !== constants.WASI_ESUCCESS && err !== constants.WASI_EEXIST)
      throw new Error("Could not setup terminal");

    const operation: Operation = {
      Spawn: {
        cmd,
        args,
        env,
        stdin: ttyPath,
        stdout: ttyPath,
        stderr: ttyPath,
        kern: false,
      }
    };
    const arr = new TextEncoder().encode(JSON.stringify(operation));

    let rw = await this.fifow.write(arr.buffer as ArrayBuffer);
    if (rw.err !== constants.WASI_ESUCCESS)
      throw new Error("Could not spawn process");

    let rr = await this.fifor.read(64);
    if (rr.err !== constants.WASI_ESUCCESS)
      throw new Error("Could not spawn process");

    try {
      const __split = new TextDecoder().decode(rr.buffer).split(" ");
      return Number(__split[1]);
    } catch (_) {
      throw new Error("Could not read pid");
    }
  }

  public async fileExists(path: string): Promise<boolean> {
    const res = await this.tfs.open(path, constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW);
    if (res.err !== constants.WASI_ESUCCESS)
      return false;

    await res.desc.close();

    return true;
  }

  public async createTextFile(path: string, content: string): Promise<number> {
    const { err, desc } = await this.tfs.open(
      path,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      constants.WASI_O_CREAT | constants.WASI_O_TRUNC
    );
    if (err !== constants.WASI_ESUCCESS)
      return err;

    try {
      const arr = new TextEncoder().encode(content);
      const writeRes = await desc.write(arr.buffer as ArrayBuffer);
      if (writeRes.err !== constants.WASI_ESUCCESS)
        return writeRes.err;

      return constants.WASI_ESUCCESS;
    } finally {
      await desc.close();
    }
  }
}
