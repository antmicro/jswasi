import { Descriptor } from "./filesystem/filesystem.js";
import * as constants from "./constants.js";
import { TopLevelFs } from "./filesystem/top-level-fs";
// @ts-ignore
import * as vfs from "./third_party/vfs.js";
import { major } from "./filesystem/virtual-filesystem/devices/driver-manager.js";
import { dirname } from "./utils.js";

// Result types
export type JswasiError = { readonly code: number; readonly msg: string };
export type Success<T> = { readonly ok: true; readonly value: T };
export type Failure = { readonly ok: false; readonly error: JswasiError };
export type Result<T> = Success<T> | Failure;
export const success = <T>(value: T): Success<T> => ({ ok: true, value });
export const failure = (error: JswasiError): Failure => ({ ok: false, error });

export type ProcessStream = {
  stdin: Descriptor,
  stdout: Descriptor,
  stderr: Descriptor,
  pid: number;
};

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

const WRITE_FIFO_PATH = "/dev/initr.kfifo";
const READ_FIFO_PATH = "/dev/initw.kfifo";

export class JsInterface {
  private fifow: Descriptor;
  private fifor: Descriptor;
  private tfs: TopLevelFs;

  public async initialize(tfs: TopLevelFs): Promise<Result<void>> {
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
      return failure({ code: _res.err, msg: "Could not open read FIFO" });

    this.fifor = _res.desc;

    _res = await tfs.open(
      WRITE_FIFO_PATH,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      0, 0,
      constants.WASI_EXT_RIGHTS_STDOUT,
      constants.WASI_EXT_RIGHTS_STDOUT,
    );
    if (_res.err !== constants.WASI_ESUCCESS)
      return failure({ code: _res.err, msg: "Could not open write FIFO" });

    this.fifow = _res.desc;

    return success(undefined);
  }

  private async startProcess(operation: Operation): Promise<Result<{id: number, pid: number}>> {
    const arr = new TextEncoder().encode(JSON.stringify(operation));

    const { err: writeErr } = await this.fifow.write(arr.buffer as ArrayBuffer);
    if (writeErr !== constants.WASI_ESUCCESS)
      return failure({code: writeErr, msg: "Could not spawn process"});

    const { err: readErr, buffer } = await this.fifor.read(64);
    if (readErr !== constants.WASI_ESUCCESS)
      return failure({code: readErr, msg: "Could not spawn process"});

    try {
      const _split = new TextDecoder().decode(buffer).split(" ");
      const id = Number(_split[0]);
      const pid = Number(_split[1]);
      return success({ id, pid });
    } catch (e) {
      return failure({code: constants.WASI_EINVAL, msg: "Could not read process ID and PID"});
    }
  }

  public async spawn(cmd: string, args: string[], env?: Record<string, string>): Promise<Result<ProcessStream>> {
    const operation: Operation = {
      Spawn: {
        cmd,
        args,
        env,
        kern: true,
      },
    };
    const process = await this.startProcess(operation);
    if (!process.ok) return process as Failure;

    let resp = await this.tfs.open(`/dev/spawn_stdin.${process.value.id}`, 0, 0, 0, constants.WASI_EXT_RIGHTS_STDOUT);
    if (resp.err !== constants.WASI_ESUCCESS)
      return failure({code: resp.err, msg: "Could not open stdin descriptor"});
    const stdin = resp.desc;

    resp = await this.tfs.open(`/dev/spawn_stdout.${process.value.id}`, 0, 0, 0, constants.WASI_EXT_RIGHTS_STDIN);
    if (resp.err !== constants.WASI_ESUCCESS)
      return failure({code: resp.err, msg: "Could not open stdout descriptor"});
    const stdout = resp.desc;

    resp = await this.tfs.open(`/dev/spawn_stderr.${process.value.id}`, 0, 0, 0, constants.WASI_EXT_RIGHTS_STDIN);
    if (resp.err !== constants.WASI_ESUCCESS)
      return failure({code: resp.err, msg: "Could not open stderr descriptor"});
    const stderr = resp.desc;

    return success({ stdin, stdout, stderr, pid: process.value.pid });
  }

  public async startTerminalProcess(cmd: string , args: string[], min: number, env?: Record<string, string>): Promise<Result<number>> {
    const ttyPath = `/dev/ttyH${min}`
    const err = await this.tfs.mknodat(undefined, ttyPath, vfs.mkDev(major.MAJ_HTERM, min), -1);
    if (err !== constants.WASI_ESUCCESS && err !== constants.WASI_EEXIST)
      return failure({ code: err, msg: "Could not setup terminal" });

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
    const process = await this.startProcess(operation);
    if (!process.ok) return process as Failure;

    return success(process.value.pid);
  }

  public async fileExists(path: string): Promise<Result<boolean>> {
    const res = await this.tfs.open(path, constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW);
    if (res.desc) {
      await res.desc.close();
    }
    if (res.err === constants.WASI_ESUCCESS) {
      return success(true);
    } else if (res.err === constants.WASI_ENOENT || res.err === constants.WASI_ENOTDIR) {
      return success(false);
    } else {
      return failure({ code: res.err, msg: "Could not check if file exists" });
    }
  }

  public async createTextFile(path: string, content: string): Promise<Result<void>> {
    const result = await this.createDirectory(dirname(path));
    if (!result.ok) return result as Failure;

    const { err, desc } = await this.tfs.open(
      path,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      constants.WASI_O_CREAT | constants.WASI_O_TRUNC
    );
    if (err !== constants.WASI_ESUCCESS)
      return failure({ code: err, msg: "Could not create file"});

    try {
      const arr = new TextEncoder().encode(content);
      const {err: writeErr } = await desc.write(arr.buffer as ArrayBuffer);
      if (writeErr !== constants.WASI_ESUCCESS)
        return failure({ code: writeErr, msg: "Could not write to file" });

      return success(undefined);
    } finally {
      await desc.close();
    }
  }

  public async createDirectory(path: string): Promise<Result<boolean>> {
    const subdirs = path.split("/").filter((dir) => dir !== "");
    if (subdirs.length === 0) {
      return success(false);
    }

    let created = false;
    let p = "";
    for (let i = 0; i < subdirs.length; i++) {
      const dir = subdirs[i];
      p = `${p}/${dir}`;
      const err = await this.tfs.createDir(p);
      const isLast = i === subdirs.length - 1;

      if (err === constants.WASI_ESUCCESS) {
        if (isLast) created = true;
      } else if (err !== constants.WASI_EEXIST) {
        return failure({ code: err, msg: `Could not create directory ${p}` });
      }
    }

    return success(created);
  }
}
