// @ts-ignore TODO: port idb-keyval to Typescript with no implicit any
import { del, get, set } from "../vendor/idb-keyval.js";
import * as constants from "../constants.js";
import { StoredData } from "./enums.js";

export async function del_stored_data(path: string) {
    del(path);
}

export async function get_stored_data(path: string): Promise<StoredData> {
  return await get(path) || {
    // dummy values for files from locally mounted dirs
    dev: 0n,
    ino: 0n,
    nlink: 1n,
    rdev: 0,
    size: 0n,
    uid: 0,
    gid: 0,
    userMode: 7,
    groupMode: 7,
    blockSize: 0,
    blocks: 0,
    fileType: constants.WASI_PREOPENTYPE_DIR,
    atim: 0n,
    mtim: 0n,
    ctim: 0n,
  };
}

export async function set_stored_data(path: string, stored_data: StoredData) {
    set(path, stored_data);
}
