import { Rights, Fdflags, AbstractDeviceDescriptor } from "../filesystem.js";

import { VirtualNull, VirtualZero, VirtualRandom } from "./chr-devices.js";
// @ts-ignore
import { CharacterDev } from "../vendor/vfs.js";

export const enum major {
  DEV_NULL = 0,
  DEV_ZERO = 1,
  DEV_RANDOM = 2,
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
  [major.DEV_ZERO]: VirtualZero,
  [major.DEV_RANDOM]: VirtualRandom,
};
