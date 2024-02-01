import * as utils from "../../src/utils";

// @ts-ignore
import { test, expect } from "@jest/globals";

test("parsePath on regular path", () => {
  expect(utils.parsePath("/usr/bin/wash")).toStrictEqual({
    parts: ["usr", "bin"],
    name: "wash",
  });
});

test("parsePath on top level dir", () => {
  expect(utils.parsePath("/usr")).toStrictEqual({
    parts: [],
    name: "usr",
  });
});

test("parsePath on root dir", () => {
  expect(utils.parsePath("/")).toStrictEqual({
    parts: [],
    name: "",
  });
});
