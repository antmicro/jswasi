// @ts-ignore TODO: port idb-keyval to Typescript with no implicit any
import { del, get, set } from "../vendor/idb-keyval.js";
import { StoredData } from "./enums.js";

export async function delStoredData(path: string) {
  del(path);
}

export async function getStoredData(path: string): Promise<StoredData> {
  return get(path);
}

export async function setStoredData(path: string, storedData: StoredData) {
  set(path, storedData);
}
