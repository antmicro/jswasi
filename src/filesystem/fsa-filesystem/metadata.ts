// @ts-ignore TODO: port idb-keyval to Typescript with no implicit any
import { del, get, set, keys } from "../../third_party/idb-keyval.js";
import { Filestat } from "../filesystem";

export async function delStoredData(path: string) {
  del(path);
}

export async function getStoredData(path: string): Promise<Filestat> {
  return get(path);
}

export async function setStoredData(path: string, storedData: Filestat) {
  set(path, storedData);
}

export async function listStoredKeys(): Promise<string[]> {
  return keys();
}
