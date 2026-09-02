import * as utils from "../../src/utils";
import { describe, test, expect } from "@jest/globals";

describe("arraysEqual", () => {
  test("returns true for identical references", () => {
    const arr = [1, 2, "a"];
    expect(utils.arraysEqual(arr, arr)).toBe(true);
  });

  test("returns true for equal contents", () => {
    expect(utils.arraysEqual([1, "x", true], [1, "x", true])).toBe(true);
    expect(utils.arraysEqual([], [])).toBe(true);
  });

  test("returns false for length mismatches", () => {
    expect(utils.arraysEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  test("returns false for element mismatches", () => {
    expect(utils.arraysEqual([1, 2], [1, 3])).toBe(false);
  });

  test("handles null or undefined correctly", () => {
    expect(utils.arraysEqual(null as any, [1])).toBe(false);
    expect(utils.arraysEqual([1], undefined as any)).toBe(false);
    expect(utils.arraysEqual(null as any, null as any)).toBe(true);
  });
});

describe("parsePath", () => {
  test("parses regular absolute path", () => {
    expect(utils.parsePath("/usr/bin/wash")).toStrictEqual({
      parts: ["usr", "bin"],
      name: "wash",
    });
  });

  test("parses top-level entry", () => {
    expect(utils.parsePath("/usr")).toStrictEqual({
      parts: [],
      name: "usr",
    });
  });

  test("parses root directory", () => {
    expect(utils.parsePath("/")).toStrictEqual({
      parts: [],
      name: "",
    });
  });

  test("ignores redundant consecutive slashes", () => {
    expect(utils.parsePath("///var///log///syslog")).toStrictEqual({
      parts: ["var", "log"],
      name: "syslog",
    });
  });

  test("handles empty string", () => {
    expect(utils.parsePath("")).toStrictEqual({
      parts: [],
      name: "",
    });
  });
});

describe("realpath", () => {
  test("resolves canonical absolute paths", () => {
    expect(utils.realpath("/a/b/c")).toBe("/a/b/c");
    expect(utils.realpath("/")).toBe("/");
  });

  test("collapses redundant slashes and . segments", () => {
    expect(utils.realpath("/a/./b///c/.")).toBe("/a/b/c");
  });

  test("evaluates .. segments within bounds", () => {
    expect(utils.realpath("/a/b/../c")).toBe("/a/c");
    expect(utils.realpath("/a/b/c/../../d")).toBe("/a/d");
  });

  test("clamps at root without escaping", () => {
    expect(utils.realpath("/../../..")).toBe("/");
    expect(utils.realpath("/a/../../b")).toBe("/b");
  });

  test("resolves relative paths against default baseDir (/)", () => {
    expect(utils.realpath("foo/bar")).toBe("/foo/bar");
    expect(utils.realpath("../foo")).toBe("/foo");
  });

  test("resolves relative paths against custom baseDir", () => {
    expect(utils.realpath("child", "/home/user")).toBe("/home/user/child");
    expect(utils.realpath("../sibling", "/home/user")).toBe("/home/sibling");
    expect(utils.realpath("../../var", "/home/user")).toBe("/var");
  });

  test("ignores baseDir when path is absolute", () => {
    expect(utils.realpath("/etc/hosts", "/home/user")).toBe("/etc/hosts");
  });
});

describe("msToNs", () => {
  test("converts exact integer milliseconds", () => {
    expect(utils.msToNs(0)).toBe(0n);
    expect(utils.msToNs(1)).toBe(1_000_000n);
    expect(utils.msToNs(1500)).toBe(1_500_000_000n);
  });

  test("converts fractional milliseconds to nanoseconds", () => {
    expect(utils.msToNs(0.5)).toBe(500_000n);
    expect(utils.msToNs(1.000001)).toBe(1_000_001n);
    expect(utils.msToNs(1234.5678)).toBe(1_234_567_800n);
  });
});

describe("basename", () => {
  test("handles root directory", () => {
    expect(utils.basename("/")).toBe("/");
  });

  test("handles empty string", () => {
    expect(utils.basename("")).toBe("");
  });

  test("extracts filename from absolute path", () => {
    expect(utils.basename("/usr/bin/wash")).toBe("wash");
  });

  test("extracts filename from relative path without slash", () => {
    expect(utils.basename("wash")).toBe("wash");
  });

  // Note: current implementation returns "" for trailing slashes (/a/b/ -> "")
  test("current behavior with trailing slash", () => {
    expect(utils.basename("/usr/bin/")).toBe("");
  });
});

describe("dirname", () => {
  test("handles empty string", () => {
    expect(utils.dirname("")).toBe("");
  });

  test("handles paths within root", () => {
    expect(utils.dirname("/wash")).toBe("/");
  });

  test("handles deep absolute paths", () => {
    expect(utils.dirname("/usr/bin/wash")).toBe("/usr/bin");
  });

  // Note: current implementation returns "" for single-component relative paths
  test("current behavior on relative path without slashes", () => {
    expect(utils.dirname("wash")).toBe("");
  });
});
