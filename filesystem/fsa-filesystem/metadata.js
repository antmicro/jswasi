// @ts-ignore TODO: port idb-keyval to Typescript with no implicit any
import { del, get, set, keys } from "../../third_party/idb-keyval.js";
export async function delStoredData(path) {
    del(path);
}
export async function getStoredData(path) {
    return get(path);
}
export async function setStoredData(path, storedData) {
    set(path, storedData);
}
export async function listStoredKeys() {
    return keys();
}
