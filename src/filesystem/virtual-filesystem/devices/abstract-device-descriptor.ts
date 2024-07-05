import {
  Fdflags,
  Rights,
  Filestat,
  AbstractDeviceDescriptor,
} from "../../filesystem.js";
import { wasiFilestat } from "../virtual-filesystem.js";

// @ts-ignore
import * as vfs from "../../../third_party/vfs.js";
import * as constants from "../../../constants.js";

export abstract class AbstractVirtualDeviceDescriptor extends AbstractDeviceDescriptor {
  constructor(
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    protected ino: vfs.CharacterDev
  ) {
    super(fs_flags, fs_rights_base, fs_rights_inheriting);
  }

  override async getFilestat(): Promise<{ err: number; filestat: Filestat }> {
    return {
      err: constants.WASI_ESUCCESS,
      filestat: wasiFilestat(this.ino._metadata),
    };
  }
}
