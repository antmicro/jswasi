import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { JsInterface, success } from "../../src/js-interface";
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
    test("should return failure if FIFOs do not exist", async () => {
      const freshJsInterface = new JsInterface();
      const freshTfs = new TopLevelFs();
      const vfs = new VirtualFilesystem();
      await vfs.initialize({});
      await freshTfs.addMountFs("/", vfs);

      const result = await freshJsInterface.initialize(freshTfs);
      expect(result).toMatchObject({
        ok: false,
      });
    });

    test("should initialize successfully when FIFOs exist", async () => {
      const freshJsInterface = new JsInterface();
      const result = await freshJsInterface.initialize(tfs);
      expect(result).toEqual(success(undefined));
    });
  });

  describe("createTextFile", () => {
    test("should successfully create a text file with content", async () => {
      const path = "/hello.txt";
      const content = "Hello World!";

      const result = await jsInterface.createTextFile(path, content);
      expect(result).toEqual(success(undefined));

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

      const result = await jsInterface.createTextFile(path, content);
      expect(result).toEqual(success(undefined));

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
      const result = await jsInterface.createTextFile(path, newContent);
      expect(result).toEqual(success(undefined));

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

      const result = await jsInterface.createTextFile(path, content);
      expect(result).toEqual(success(undefined));

      const openRes = await tfs.open(path);
      expect(openRes.err).toBe(constants.WASI_ESUCCESS);

      const readRes = await openRes.desc.read_str();
      expect(readRes.err).toBe(constants.WASI_ESUCCESS);
      expect(readRes.content).toBe(content);

      await openRes.desc.close();
    });

    test("should fail if path is a directory", async () => {
      const dirPath = "/testdir";
      await tfs.createDir(dirPath);

      const result = await jsInterface.createTextFile(dirPath, "content");
      expect(result).toMatchObject({
        ok: false,
        error: { code: constants.WASI_EISDIR },
      });
    });

    test("should create parent directories and add multiple files", async () => {
      const file1 = "/auto/nested/file1.txt";
      const file2 = "/auto/nested/file2.txt";

      expect(await jsInterface.createTextFile(file1, "content1")).toEqual(success(undefined));
      expect(await jsInterface.createTextFile(file2, "content2")).toEqual(success(undefined));

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
      expect(res).toMatchObject({
        ok: true,
        value: {
          pid: 42,
          stdin: expect.anything(),
          stdout: expect.anything(),
          stderr: expect.anything(),
        },
      });
    });

    test("spawn should fail if fifo read fails", async () => {
      const fifor = (jsInterface as any).fifor;
      jest.spyOn(fifor, "read").mockResolvedValueOnce({
        err: constants.WASI_EIO,
        buffer: undefined as any,
      });

      const res = await jsInterface.spawn("cmd", []);
      expect(res).toMatchObject({
        ok: false,
        error: { code: constants.WASI_EIO },
      });
    });

    test("startTerminalProcess should return PID", async () => {
      jest.spyOn(tfs, "mknodat").mockResolvedValueOnce(constants.WASI_ESUCCESS);

      const fifor = (jsInterface as any).fifor;
      jest.spyOn(fifor, "read").mockResolvedValueOnce({
        err: constants.WASI_ESUCCESS,
        buffer: new TextEncoder().encode("1 43").buffer as ArrayBuffer,
      });

      const res = await jsInterface.startTerminalProcess("sh", [], 0);
      expect(res).toMatchObject({
        ok: true,
        value: 43,
      });
    });
  });

  describe("createDirectory", () => {
    test("should successfully create a directory", async () => {
      const dirPath = "/new_directory";
      const result = await jsInterface.createDirectory(dirPath);
      expect(result).toEqual(success(true));

      const openRes = await tfs.open(dirPath);
      expect(openRes.err).toBe(constants.WASI_ESUCCESS);
      expect(openRes.desc.getFdstat().fs_filetype).toBe(constants.WASI_FILETYPE_DIRECTORY);
    });

    test("should return success(false) if directory already exists", async () => {
      const dirPath = "/existing_dir";
      await jsInterface.createDirectory(dirPath);

      const res = await jsInterface.createDirectory(dirPath);
      expect(res).toEqual(success(false));
    });

    test("should successfully create deeply nested subdirectories", async () => {
      const nestedPath = "/a/b/c/d";
      const result = await jsInterface.createDirectory(nestedPath);
      expect(result).toEqual(success(true));

      for (const checkPath of ["/a", "/a/b", "/a/b/c", "/a/b/c/d"]) {
        const res = await tfs.open(checkPath);
        expect(res.err).toBe(constants.WASI_ESUCCESS);
        expect(res.desc.getFdstat().fs_filetype).toBe(constants.WASI_FILETYPE_DIRECTORY);
        await res.desc.close();
      }
    });

    test("should create subdirectories when intermediate parent directories already exist", async () => {
      await jsInterface.createDirectory("/parent/sub1");
      const result = await jsInterface.createDirectory("/parent/sub1/sub2/target");
      expect(result).toEqual(success(true));

      const res = await tfs.open("/parent/sub1/sub2/target");
      expect(res.err).toBe(constants.WASI_ESUCCESS);
      expect(res.desc.getFdstat().fs_filetype).toBe(constants.WASI_FILETYPE_DIRECTORY);
      await res.desc.close();
    });

    test("should return success(false) if final target directory already exists in a nested path", async () => {
      await jsInterface.createDirectory("/parent/target");
      const result = await jsInterface.createDirectory("/parent/target");
      expect(result).toEqual(success(false));
    });

    test("should return success(false) when called on root or empty path", async () => {
      expect(await jsInterface.createDirectory("/")).toEqual(success(false));
      expect(await jsInterface.createDirectory("")).toEqual(success(false));
    });
  });
});
