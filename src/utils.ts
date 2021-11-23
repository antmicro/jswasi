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
  if (!path.startsWith("/")) {
    throw Error("path must be absolute");
  }
  const result = [];
  let resultPath = "";
  let tmpPath = path;
  let part = "";
  let level = 0;
  const rootPath = path[0] === "/";
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
      result[level] = part;
      level += 1;
    }
  }
  resultPath = result.slice(0, level).join("/");
  if (rootPath) if (resultPath === "") return "/";
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
