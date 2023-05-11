import * as constants from "../../constants.js";
// @ts-ignore
import * as vfs from "../../vendor/vfs.js";

import {
  VirtualFilesystem,
  VirtualFilesystemDirectoryDescriptor,
} from "./virtual-filesystem.js";

import { Descriptor } from "../filesystem.js";

import { major } from "./dev-table.js";

export class DeviceFilesystem extends VirtualFilesystem {
  override async mknodat(
    desc: Descriptor,
    path: string,
    dev: number
  ): Promise<number> {
    let navigated;
    let __desc;
    if (desc === undefined) {
      navigated = this.virtualFs._navigate(path, false);
    } else {
      if (desc instanceof VirtualFilesystemDirectoryDescriptor) {
        __desc = desc as VirtualFilesystemDirectoryDescriptor;
        navigated = this.virtualFs._navigateFrom(__desc.dir, path, false);
      } else {
        return constants.WASI_EINVAL;
      }
    }

    if (navigated.target) {
      return constants.WASI_EEXIST;
    }

    const [_, index] = this.virtualFs._iNodeMgr.createINode(vfs.CharacterDev, {
      mode: vfs.DEFAULT_FILE_PERM,
      uid: 0,
      gid: 0,
      minor: 0,
      major: dev,
      parent: navigated.dir._dir["."],
    });
    navigated.dir.addEntry(path, index);

    return constants.WASI_ESUCCESS;
  }
}

export async function createDeviceFilesystem(): Promise<DeviceFilesystem> {
  let devfs = new DeviceFilesystem();

  devfs.mknodat(undefined, "null", major.DEV_NULL);
  devfs.mknodat(undefined, "zero", major.DEV_ZERO);
  devfs.mknodat(undefined, "random", major.DEV_RANDOM);

  return devfs;
}
