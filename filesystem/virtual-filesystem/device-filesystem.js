import * as constants from "../../constants.js";
// @ts-ignore
import * as vfs from "../../third_party/vfs.js";
import { VirtualFilesystem, VirtualFilesystemDirectoryDescriptor, wasiFilestat, } from "./virtual-filesystem.js";
import { basename } from "../../utils.js";
import { AbstractDeviceDescriptor, } from "../filesystem.js";
export class DeviceFilesystem extends VirtualFilesystem {
    driverManager;
    async initialize(opts) {
        const __opts = opts;
        this.driverManager = __opts.driverManager;
        return constants.WASI_ESUCCESS;
    }
    async mknodat(desc, path, dev, opts) {
        let navigated;
        let __desc;
        if (desc === undefined) {
            navigated = this.virtualFs._navigate(path, false);
        }
        else {
            if (desc instanceof VirtualFilesystemDirectoryDescriptor) {
                __desc = desc;
                navigated = this.virtualFs._navigateFrom(__desc.dir, path, false);
            }
            else {
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
            rdev: dev,
            parent: navigated.dir._dir["."],
        });
        navigated.dir.addEntry(path, index);
        const [major_, minor_] = vfs.unmkDev(dev);
        const __driver = this.driverManager.getDriver(major_);
        __driver.initDevice(minor_, opts);
        return constants.WASI_ESUCCESS;
    }
    async open(path, dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags, workerId) {
        let result = await super.open(path, dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags, workerId);
        if (result.err !== constants.WASI_ENODEV) {
            return result;
        }
        const navigated = this.virtualFs._navigateFrom(result.desc.dir, basename(path), false);
        const [major_, minor_] = vfs.unmkDev(navigated.target._metadata.rdev);
        const driver = this.driverManager.getDriver(major_);
        const { err, desc } = await driver.getDesc(minor_, fdflags, fs_rights_base, fs_rights_inheriting, navigated.target);
        if (err !== constants.WASI_ESUCCESS) {
            return result;
        }
        return {
            err: constants.WASI_ESUCCESS,
            index: -1,
            desc,
        };
    }
}
export class AbstractVirtualDeviceDescriptor extends AbstractDeviceDescriptor {
    ino;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, ino) {
        super(fs_flags, fs_rights_base, fs_rights_inheriting);
        this.ino = ino;
    }
    async getFilestat() {
        return {
            err: constants.WASI_ESUCCESS,
            filestat: wasiFilestat(this.ino._metadata),
        };
    }
}
export async function createDeviceFilesystem(driverManager, processManager, args) {
    let devfs = new DeviceFilesystem();
    await driverManager.initialize(processManager);
    await devfs.initialize({ driverManager });
    await devfs.mknodat(undefined, "null", vfs.mkDev(0 /* major.MAJ_MEMORY */, 0 /* memMinor.DEV_NULL */), {});
    await devfs.mknodat(undefined, "zero", vfs.mkDev(0 /* major.MAJ_MEMORY */, 1 /* memMinor.DEV_ZERO */), {});
    await devfs.mknodat(undefined, "urandom", vfs.mkDev(0 /* major.MAJ_MEMORY */, 2 /* memMinor.DEV_URANDOM */), {});
    await devfs.mknodat(undefined, "ttyH0", vfs.mkDev(1 /* major.MAJ_HTERM */, 0), args);
    return devfs;
}
