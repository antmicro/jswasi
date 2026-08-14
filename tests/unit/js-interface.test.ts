import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { JsInterface } from "../../src/js-interface";
import { TopLevelFs } from "../../src/filesystem/top-level-fs";
import { VirtualFilesystem } from "../../src/filesystem/virtual-filesystem/virtual-filesystem";
import * as constants from "../../src/constants";

describe("JsInterface", () => {
  let jsInterface: JsInterface;
  let tfs: TopLevelFs;

  beforeEach(async () => {
    jsInterface = new JsInterface();
    tfs = new TopLevelFs();
    const vfs = new VirtualFilesystem();
    await vfs.initialize({});
    await tfs.addMountFs("/", vfs);
    await tfs.createDir("/dev");
    await tfs.open("/dev/initr.kfifo", 0, constants.WASI_O_CREAT);
    await tfs.open("/dev/initw.kfifo", 0, constants.WASI_O_CREAT);
    await jsInterface.initialize(tfs);
  });

  describe("initialize", () => {
    test("should return error if FIFOs do not exist", async () => {
      const freshJsInterface = new JsInterface();
      const uninitTfs = new TopLevelFs();
      const vfs = new VirtualFilesystem();
      await vfs.initialize({});
      await uninitTfs.addMountFs("/", vfs);

      const err = await freshJsInterface.initialize(uninitTfs);
      expect(err).not.toBe(constants.WASI_ESUCCESS);
    });

    test("should initialize successfully when FIFOs exist", async () => {
      const freshJsInterface = new JsInterface();
      const err = await freshJsInterface.initialize(tfs);
      expect(err).toBe(constants.WASI_ESUCCESS);
    });
  });

  describe("createTextFile", () => {
    test("should successfully create a text file with content", async () => {
      const path = "/hello.txt";
      const content = "Hello World!";

      const err = await jsInterface.createTextFile(path, content);
      expect(err).toBe(constants.WASI_ESUCCESS);

      const openRes = await tfs.open(path);
      expect(openRes.err).toBe(constants.WASI_ESUCCESS);

      const readRes = await openRes.desc.read_str();
      expect(readRes.err).toBe(constants.WASI_ESUCCESS);
      expect(readRes.content).toBe(content);

      await openRes.desc.close();
    });

    test("should successfully create an empty text file", async () => {
      const path = "/empty.txt";
      const content = "";

      const err = await jsInterface.createTextFile(path, content);
      expect(err).toBe(constants.WASI_ESUCCESS);

      const openRes = await tfs.open(path);
      expect(openRes.err).toBe(constants.WASI_ESUCCESS);

      const readRes = await openRes.desc.read_str();
      expect(readRes.err).toBe(constants.WASI_ESUCCESS);
      expect(readRes.content).toBe("");

      await openRes.desc.close();
    });

    test("should overwrite an existing file when called again", async () => {
      const path = "/file.txt";
      await jsInterface.createTextFile(path, "Initial content");

      const newContent = "Updated content";
      const err = await jsInterface.createTextFile(path, newContent);
      expect(err).toBe(constants.WASI_ESUCCESS);

      const openRes = await tfs.open(path);
      expect(openRes.err).toBe(constants.WASI_ESUCCESS);

      const readRes = await openRes.desc.read_str();
      expect(readRes.err).toBe(constants.WASI_ESUCCESS);
      expect(readRes.content).toBe(newContent);

      await openRes.desc.close();
    });

    test("should create text files in nested directories", async () => {
      await tfs.createDir("/nested");
      await tfs.createDir("/nested/dir");

      const path = "/nested/dir/test.json";
      const content = JSON.stringify({ key: "value", number: 42 });

      const err = await jsInterface.createTextFile(path, content);
      expect(err).toBe(constants.WASI_ESUCCESS);

      const openRes = await tfs.open(path);
      expect(openRes.err).toBe(constants.WASI_ESUCCESS);

      const readRes = await openRes.desc.read_str();
      expect(readRes.err).toBe(constants.WASI_ESUCCESS);
      expect(readRes.content).toBe(content);

      await openRes.desc.close();
    });

    test("should return error if path is a directory", async () => {
      const dirPath = "/testdir";
      await tfs.createDir(dirPath);

      const err = await jsInterface.createTextFile(dirPath, "content");
      expect(err).toBe(constants.WASI_EISDIR);
    });

    test("should create parent directories and add multiple files", async () => {
      const file1 = "/auto/nested/file1.txt";
      const file2 = "/auto/nested/file2.txt";

      expect(await jsInterface.createTextFile(file1, "content1")).toBe(constants.WASI_ESUCCESS);
      expect(await jsInterface.createTextFile(file2, "content2")).toBe(constants.WASI_ESUCCESS);

      const res1 = await tfs.open(file1);
      expect(res1.err).toBe(constants.WASI_ESUCCESS);
      expect(await res1.desc.read_str()).toEqual({ err: constants.WASI_ESUCCESS, content: "content1" });
      await res1.desc.close();

      const res2 = await tfs.open(file2);
      expect(res2.err).toBe(constants.WASI_ESUCCESS);
      expect(await res2.desc.read_str()).toEqual({ err: constants.WASI_ESUCCESS, content: "content2" });
      await res2.desc.close();
    });
  });

  describe("spawn and startTerminalProcess", () => {
    test("spawn should send operation payload and open stdio descriptors", async () => {
      const fifor = (jsInterface as any).fifor;
      jest.spyOn(fifor, "read").mockResolvedValueOnce({
        err: constants.WASI_ESUCCESS,
        buffer: new TextEncoder().encode("1 42").buffer as ArrayBuffer,
      });

      await tfs.open("/dev/spawn_stdin.1", 0, constants.WASI_O_CREAT);
      await tfs.open("/dev/spawn_stdout.1", 0, constants.WASI_O_CREAT);
      await tfs.open("/dev/spawn_stderr.1", 0, constants.WASI_O_CREAT);

      const res = await jsInterface.spawn("ls", ["-la"], { PATH: "/bin" });
      expect(res.pid).toBe(42);
      expect(res.stdin).toBeDefined();
      expect(res.stdout).toBeDefined();
      expect(res.stderr).toBeDefined();
    });

    test("spawn should throw error if fifo read fails", async () => {
      const fifor = (jsInterface as any).fifor;
      jest.spyOn(fifor, "read").mockResolvedValueOnce({
        err: constants.WASI_EIO,
        buffer: undefined as any,
      });

      await expect(jsInterface.spawn("cmd", [])).rejects.toThrow("Could not spawn process");
    });

    test("startTerminalProcess should return PID", async () => {
      jest.spyOn(tfs, "mknodat").mockResolvedValueOnce(constants.WASI_ESUCCESS);

      const fifor = (jsInterface as any).fifor;
      jest.spyOn(fifor, "read").mockResolvedValueOnce({
        err: constants.WASI_ESUCCESS,
        buffer: new TextEncoder().encode("1 43").buffer as ArrayBuffer,
      });

      const pid = await jsInterface.startTerminalProcess("sh", [], 0);
      expect(pid).toBe(43);
    });
  });

  describe("createDirectory", () => {
    test("should successfully create a directory", async () => {
      const dirPath = "/new_directory";
      const err = await jsInterface.createDirectory(dirPath);
      expect(err).toBe(constants.WASI_ESUCCESS);

      const openRes = await tfs.open(dirPath);
      expect(openRes.err).toBe(constants.WASI_ESUCCESS);
      expect(openRes.desc.getFdstat().fs_filetype).toBe(constants.WASI_FILETYPE_DIRECTORY);
    });

    test("should return WASI_EEXIST if directory already exists", async () => {
      const dirPath = "/existing_dir";
      await jsInterface.createDirectory(dirPath);

      const err = await jsInterface.createDirectory(dirPath);
      expect(err).toBe(constants.WASI_EEXIST);
    });

    test("should successfully create deeply nested subdirectories", async () => {
      const nestedPath = "/a/b/c/d";
      const err = await jsInterface.createDirectory(nestedPath);
      expect(err).toBe(constants.WASI_ESUCCESS);

      for (const checkPath of ["/a", "/a/b", "/a/b/c", "/a/b/c/d"]) {
        const res = await tfs.open(checkPath);
        expect(res.err).toBe(constants.WASI_ESUCCESS);
        expect(res.desc.getFdstat().fs_filetype).toBe(constants.WASI_FILETYPE_DIRECTORY);
        await res.desc.close();
      }
    });

    test("should create subdirectories when intermediate parent directories already exist", async () => {
      await jsInterface.createDirectory("/parent/sub1");
      const err = await jsInterface.createDirectory("/parent/sub1/sub2/target");
      expect(err).toBe(constants.WASI_ESUCCESS);

      const res = await tfs.open("/parent/sub1/sub2/target");
      expect(res.err).toBe(constants.WASI_ESUCCESS);
      expect(res.desc.getFdstat().fs_filetype).toBe(constants.WASI_FILETYPE_DIRECTORY);
      await res.desc.close();
    });

    test("should return WASI_EEXIST if final target directory already exists in a nested path", async () => {
      await jsInterface.createDirectory("/parent/target");
      const err = await jsInterface.createDirectory("/parent/target");
      expect(err).toBe(constants.WASI_EEXIST);
    });

    test("should return WASI_ESUCCESS when called on root or empty path", async () => {
      expect(await jsInterface.createDirectory("/")).toBe(constants.WASI_ESUCCESS);
      expect(await jsInterface.createDirectory("")).toBe(constants.WASI_ESUCCESS);
    });

  });
});
