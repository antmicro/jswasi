import * as utils from "../../output/utils.js";

test("parsePath on regular path", () => {
  expect(utils.parsePath("/usr/bin/shell")).toStrictEqual({
    parts: ["usr", "bin"],
    name: "shell",
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
