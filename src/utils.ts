import * as constants from "./constants.js";

export function arraysEqual(a: any[], b: any[]) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

export function parsePath(path: string): { parts: string[]; name: string } {
  const parts = path.split("/").filter((part) => part !== "");
  const name = parts.pop() || "";
  return { parts, name };
}

export function realpath(path: string): string {
  /* if (!path.startsWith("/")) {
    throw Error("path must be absolute");
  }*/
  const result = [];
  let resultPath = "";
  let tmpPath = path;
  let part = "";
  let level = 0;
  while (tmpPath !== "") {
    if (tmpPath.indexOf("/") !== -1) {
      part = tmpPath.substr(0, tmpPath.indexOf("/"));
    } else part = tmpPath;
    tmpPath = tmpPath.substr(part.length + 1);
    if (part === "..") {
      if (level > 0) level -= 1;
    } else if (part === ".") {
      // do nothing
    } else {
      if (part != "") {
        result[level] = part;
        level += 1;
      }
    }
  }
  resultPath = `/${result.slice(0, level).join("/")}`;
  resultPath = resultPath.replace("/./", "/");
  return resultPath;
}

export function msToNs(ms: number): bigint {
  const msInt = Math.trunc(ms);
  const decimal = BigInt(Math.round((ms - msInt) * 1000000));
  const ns = BigInt(msInt) * BigInt(1000000);
  return ns + decimal;
}

export function now(clockId: number, cpuTimeStart: bigint): bigint {
  switch (clockId) {
    case constants.WASI_CLOCK_MONOTONIC:
      return msToNs(performance.now());
    case constants.WASI_CLOCK_REALTIME:
      return msToNs(Date.now());
    case constants.WASI_CLOCK_PROCESS_CPUTIME_ID:
    case constants.WASI_CLOCK_THREAD_CPUTIME_ID:
      return msToNs(performance.now()) - cpuTimeStart;
    default:
      // TODO: that a temporary fix as we get clockId = 10^9
      return msToNs(performance.now()) - cpuTimeStart;
  }
}

export function basename(path: string): string {
  if (path == "/") {
    return "/";
  }
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirname(path: string): string {
  let last_index = path.lastIndexOf("/");
  if (last_index < 1) {
    last_index++;
  }
  return path.slice(0, last_index);
}

// These constants are compliant with the following
// description of ioctl magic number:
// https://docs.kernel.org/userspace-api/ioctl/ioctl-decoding.html
const IOCTL_RW_MASK = 0xc0000000n;
const IOCTL_RW_OFFSET = 30n;

const IOCTL_SIZE_MASK = 0x3fff0000n;
const IOCTL_SIZE_OFFSET = 16n;

const IOCTL_DRIVER_MASK = 0x0000ff00n;
const IOCTL_DRIVER_OFFSET = 8n;

const IOCTL_FUNC_MASK = 0x000000ffn;
const IOCTL_FUNC_OFFSET = 0n;

export const enum ioc {
  IO = 0,
  IOW = 1,
  IOR = 2,
  IOWR = 3,
}

export function decodeIoctlRequest(magicNum: bigint): {
  rw: number;
  size: number;
  func: number;
  driver: number;
} {
  return {
    rw: Number((magicNum & IOCTL_RW_MASK) >> IOCTL_RW_OFFSET),
    size: Number((magicNum & IOCTL_SIZE_MASK) >> IOCTL_SIZE_OFFSET),
    func: Number((magicNum & IOCTL_FUNC_MASK) >> IOCTL_FUNC_OFFSET),
    driver: Number((magicNum & IOCTL_DRIVER_MASK) >> IOCTL_DRIVER_OFFSET),
  };
}

export function encodeIoctlRequest(
  rw: number,
  size: number,
  func: number,
  driver: number
): bigint {
  const rw_shifted = BigInt(rw) << IOCTL_RW_OFFSET;
  const size_shifted = BigInt(size) << IOCTL_SIZE_OFFSET;
  const func_shifted = BigInt(func) << IOCTL_FUNC_OFFSET;
  const driver_shifted = BigInt(driver) << IOCTL_DRIVER_OFFSET;

  if (
    (rw_shifted & IOCTL_RW_MASK) != rw_shifted ||
    (size_shifted & IOCTL_SIZE_MASK) != size_shifted ||
    (func_shifted & IOCTL_FUNC_MASK) != func_shifted ||
    (driver_shifted & IOCTL_DRIVER_MASK) != driver_shifted
  )
    return -1n;

  return rw_shifted | size_shifted | func_shifted | driver_shifted;
}

export function stringToBool(str: string): boolean {
  switch (str.toLowerCase().trim()) {
    case "yes":
    case "on":
    case "true":
      return true;
    case "no":
    case "off":
    case "false":
      return false;
    default:
      return undefined;
  }
}
export function printk(msg: string): string {
  const time = String((window.performance.now() / 1000).toFixed(6)).padStart(12, " ");
  return `[${time}] ${msg}`;
}

export function humanReadable(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  let result = bytes;
  let unit = 0;
  while (result >= 1024 && unit + 1 < units.length) {
    result /= 1024;
    unit += 1;
  }

  return `${result.toFixed(1)}${units[unit]}`;
}
