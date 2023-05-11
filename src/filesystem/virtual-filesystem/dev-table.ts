import { Rights, Fdflags, AbstractDeviceDescriptor } from "../filesystem.js";

import { VirtualNull } from "./chr-devices.js";
// @ts-ignore
import { CharacterDev } from "../vendor/vfs.js";

export const enum major {
  DEV_NULL = 0,
}

export const DEV_MAP: {
  [key in major]: new (
    fs_flags: Fdflags,
    fs_rights_base: Rights,
    fs_rights_inheriting: Rights,
    ino: CharacterDev
  ) => AbstractDeviceDescriptor;
} = {
  [major.DEV_NULL]: VirtualNull,
};
