// @ts-ignore TODO: port idb-keyval to Typescript with no implicit any
import { del, get, set, keys } from "../vendor/idb-keyval.js";
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

export async function listStoredKeys(): Promise<string[]> {
  return keys();
}
