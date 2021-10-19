import * as constants from './constants';

export function arraysEqual(a: any[], b: any[]) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

export function parsePath(path: string): {parts: string[], name: string} {
  const parts = path.split('/').filter((part) => part !== '');
  const name = parts.pop();
  return { parts, name };
}

export function realpath(path): string {
  const result = [];
  let result_path = '';
  let tmp_path = path;
  let part = '';
  let level = 0;
  const root_path = (path[0] == '/');
  while (tmp_path != '') {
    if (tmp_path.indexOf('/') != -1) {
      part = tmp_path.substr(0, tmp_path.indexOf('/'));
    } else part = tmp_path;
    tmp_path = tmp_path.substr(part.length + 1);
    if (part == '..') {
      if (level > 0) level -= 1;
    } else if (part == '.') {
      continue;
    } else {
      result[level] = part;
      level++;
    }
  }
  result_path = result.slice(0, level).join('/');
  if (root_path) if (result_path == '') return '/';
  result_path = result_path.replace('/./', '/');
  return result_path;
}

export function msToNs(ms: number): BigInt {
  const msInt = Math.trunc(ms);
  const decimal = BigInt(Math.round((ms - msInt) * 1000000));
  const ns = BigInt(msInt) * BigInt(1000000);
  return ns + decimal;
}

// FIXME: I don't like these now() calls in utils file
const baseNow = Math.floor((Date.now() - performance.now()) * 1e-3);
export function hrtime(previousTimestamp: any=null): [number, number] {
  // initilaize our variables
  let clocktime = performance.now() * 1e-3;
  let seconds = Math.floor(clocktime) + baseNow;
  let nanoseconds = Math.floor((clocktime % 1) * 1e9);

  // Compare to the prvious timestamp if we have one
  if (previousTimestamp) {
    seconds = seconds - previousTimestamp[0];
    nanoseconds = nanoseconds - previousTimestamp[1];
    if (nanoseconds < 0) {
      seconds--;
      nanoseconds += 1e9;
    }
  }
  // Return our seconds tuple
  return [seconds, nanoseconds];
}
