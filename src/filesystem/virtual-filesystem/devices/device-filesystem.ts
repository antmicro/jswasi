import * as constants from "../../../constants.js";
// @ts-ignore
import * as vfs from "../../../third_party/vfs.js";
import ProcessManager from "../../../process-manager.js";

import {
  VirtualFilesystem,
  VirtualFilesystemDirectoryDescriptor,
} from "./../virtual-filesystem.js";

import { basename } from "../../../utils.js";
import { minor as memMinor } from "./mem-devices.js";
import {
  OpenFlags,
  LookupFlags,
  Rights,
  Fdflags,
  Descriptor,
} from "../../filesystem.js";
import { FifoDescriptor } from "./fifo.js";
import { DriverManager, major } from "./driver-manager.js";

type DeviceFilesystemOpts = {
  driverManager: DriverManager;
};

export class DeviceFilesystem extends VirtualFilesystem {
  private driverManager: DriverManager;

  override async initialize(opts: Object): Promise<number> {
    const __opts = opts as DeviceFilesystemOpts;
    this.driverManager = __opts.driverManager;
    return constants.WASI_ESUCCESS;
  }

  override fsname(): string {
    return "DeviceFilesystem";
  }

  override async mknodat(
    desc: Descriptor,
    path: string,
    dev: number,
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

    if (dev < 0) {
      const [_, index] = this.virtualFs._iNodeMgr.createINode(vfs.Fifo, {
        mode: vfs.DEFAULT_FILE_PERM,
        uid: 0,
        gid: 0,
        parent: navigated.dir._dir["."],
      });
      navigated.dir.addEntry(path, index);
    } else {
      const [_, index] = this.virtualFs._iNodeMgr.createINode(vfs.CharacterDev, {
        mode: vfs.DEFAULT_FILE_PERM,
        uid: 0,
        gid: 0,
        rdev: dev,
        parent: navigated.dir._dir["."],
      });
      navigated.dir.addEntry(path, index);
    }

    return constants.WASI_ESUCCESS;
  }

  override async open(
    path: string,
    dirflags: LookupFlags,
    oflags: OpenFlags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    fdflags: Fdflags,
    workerId: number
  ): Promise<{ err: number; index: number; desc: Descriptor }> {
    let result = await super.open(
      path,
      dirflags,
      oflags,
      fs_rights_base,
      fs_rights_inheriting,
      fdflags,
      workerId
    );

    if (result.err !== constants.WASI_ENODEV)
      return result;

    const navigated = this.virtualFs._navigateFrom(
      (result.desc as VirtualFilesystemDirectoryDescriptor).dir,
      basename(path),
      false
    );

    const remover = () => {
      try {
        (result.desc as VirtualFilesystemDirectoryDescriptor)
          .dir.deleteEntry(basename(path));
      } catch (e: vfs.VirtualFSError) {}
    }

    if (navigated.target._metadata.isCharacterDevice()) {
      const [major_, minor_] = vfs.unmkDev(navigated.target._metadata.rdev);

      const driver = this.driverManager.getDriver(major_ as major);
      const { err, desc } = await driver.getDesc(
        minor_ as memMinor,
        fdflags,
        fs_rights_base,
        fs_rights_inheriting,
        navigated.target
      );
      if (err !== constants.WASI_ESUCCESS)
        return result;

      return {
        err: constants.WASI_ESUCCESS,
        index: -1,
        desc,
      };
    } else {
      if (
        workerId !== -1 &&
        (navigated.target.isKernW() && (fs_rights_base & constants.WASI_RIGHT_FD_WRITE) !== 0n ||
        navigated.target.isKernR() && (fs_rights_base & constants.WASI_RIGHT_FD_READ) !== 0n)
      ) {
        return {
          err: constants.WASI_EACCES,
          index: -1,
          desc: undefined,
        }
      };

      return {
        err: constants.WASI_ESUCCESS,
        index: -1,
        desc: new FifoDescriptor(
          fdflags,
          fs_rights_base,
          fs_rights_inheriting,
          navigated.target,
          remover
        ),
      }
    }
  }
}

export async function createDeviceFilesystem(
  driverManager: DriverManager,
  processManager: ProcessManager,
): Promise<DeviceFilesystem> {
  let devfs = new DeviceFilesystem();

  await driverManager.initialize(processManager, devfs);
  await devfs.initialize({ driverManager });

  await devfs.mknodat(
    undefined,
    "null",
    vfs.mkDev(major.MAJ_MEMORY, memMinor.DEV_NULL),
  );
  await devfs.mknodat(
    undefined,
    "zero",
    vfs.mkDev(major.MAJ_MEMORY, memMinor.DEV_ZERO),
  );
  await devfs.mknodat(
    undefined,
    "urandom",
    vfs.mkDev(major.MAJ_MEMORY, memMinor.DEV_URANDOM),
  );
  await devfs.mknodat(undefined, "ttyH0", vfs.mkDev(major.MAJ_HTERM, 0));
  await devfs.mknodat(undefined, "ttyH1", vfs.mkDev(major.MAJ_HTERM, 1));
  await devfs.mknodat(
    undefined,
    "wget0",
    vfs.mkDev(major.MAJ_WGET, 0),
  );
  await devfs.mknodat(
    undefined,
    "ws0",
    vfs.mkDev(major.MAJ_WEBSOCKET, 0),
  );

  return devfs;
}
