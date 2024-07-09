import { Descriptor } from "./filesystem/filesystem.js";
import * as constants from "./constants.js";
import { TopLevelFs } from "./filesystem/top-level-fs";

const WRITE_FIFO_PATH = "/dev/initr.kfifo";
const READ_FIFO_PATH = "/dev/initw.kfifo";

export type Command = {
  stdin: WritableStream,
  stdout: ReadableStream,
  stderr: ReadableStream,
};

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
      constants.WASI_EXT_RIGHTS_STDOUT,
      constants.WASI_EXT_RIGHTS_STDOUT,
    );
    if (_res.err !== constants.WASI_ESUCCESS)
      return _res.err;

    this.fifor = _res.desc;

    _res = await tfs.open(
      WRITE_FIFO_PATH,
      constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW,
      0, 0,
      constants.WASI_EXT_RIGHTS_STDIN,
      constants.WASI_EXT_RIGHTS_STDIN,
    );
    if (_res.err !== constants.WASI_ESUCCESS)
      return _res.err;

    this.fifow = _res.desc;

    return constants.WASI_ESUCCESS;
  }

  public async spawn(cmd: string, args: string[]): Promise<void> {
    await this.fifow.write(new TextEncoder().encode(
      JSON.stringify({ Spawn: { cmd, args, kern: true } })));

    const { err, buffer } = await this.fifor.read(64);
    if (err !== constants.WASI_ESUCCESS)
      return;

    const resp = await this.tfs.open(`/dev/spawn_stdout.${new TextDecoder().decode(buffer)}`, 0, 0, 0, constants.WASI_EXT_RIGHTS_STDIN);
    if (resp.err !== constants.WASI_ESUCCESS)
      return;

    console.log(await resp.desc.read(64));
    await resp.desc.close();
  }
}
