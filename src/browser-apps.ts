import * as constants from "./constants.js";
import * as utils from "./utils.js";
import { FileOrDir } from "./filesystem.js";
import { filesystem, fetchFile } from "./terminal.js";
import ProcessManager from "./process-manager";

export async function mount(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  console.log(`mount(${processId}, ${args})`);

  switch (args.length) {
    case 1: {
      processManager.terminal.io.println("wasmfs on /");
      for (const mountedDir of filesystem.mounts) {
        processManager.terminal.io.println(
          `fsapi on /${`${mountedDir.parts.join("/")}/${mountedDir.name}`}`
        );
      }
      return constants.WASI_ESUCCESS;
    }
    case 2: {
      let path = args[1];
      if (path === "/") {
        processManager.terminal.io.println(
          `mount: cannot mount at root directory`
        );
        return 1;
      }
      // handle relative path
      if (!path.startsWith("/")) {
        path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
      }

      // check if path exits
      if (!(await filesystem.pathExists(path, FileOrDir.Directory))) {
        processManager.terminal.io.println(`mount: ${path}: no such directory`);
        return 1;
      }

      let mountPoint;
      try {
        // eslint-disable-next-line no-undef
        mountPoint = await showDirectoryPicker();
      } catch (e) {
        processManager.terminal.io.println(
          "mount: failed to open local directory"
        );
        return 1; // TODO: what would be a proper error here?
      }

      await filesystem.addMount(path, mountPoint);
      return 0;
    }
    default: {
      processManager.terminal.io.println("mount: help: mount [<mount-point>]");
      return 1;
    }
  }
}

export function umount(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): number {
  let path = args[1];
  // handle relative path
  if (!path.startsWith("/")) {
    path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
  }

  if (!filesystem.isMounted(path)) {
    processManager.terminal.io.println(`umount: ${path}: not mounted`);
    return 1;
  }

  filesystem.removeMount(path);
  return 0;
}

export async function wget(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  let path: string;
  let address: string;
  if (args.length === 2) {
    address = args[1];
    path = address.split("/").slice(-1)[0];
  } else if (args.length === 3) {
    address = args[1];
    path = args[2];
  } else {
    processManager.terminal.io.println("wget: help: wget <address> [<path>]");
    return 1;
  }
  if (!path.startsWith("/")) {
    path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
  }
  const { dir } = await filesystem.resolveAbsolute(path);
  await fetchFile(dir, path, address);
  return 0;
}

export async function download(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  if (args.length === 1) {
    processManager.terminal.io.println(
      "download: help: download <address> [<path>]"
    );
    return 1;
  }
  Promise.all(
    args.slice(1).map(async (path: string) => {
      if (!path.startsWith("/")) {
        path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
      }

      const { err, entry } = await filesystem.rootDir.getEntry(
        path,
        FileOrDir.File
      );
      if (err !== constants.WASI_ESUCCESS) {
        processManager.terminal.io.println(`download: no such file: ${path}`);
        return Promise.resolve();
      }

      const stream = (await entry.handle.getFile()).stream();
      let localHandle;
      try {
        localHandle = await window.showSaveFilePicker({
          // @ts-ignore 'suggestedName' does not exist in type 'SaveFilePickerOptions' (it does)
          suggestedName: path.split("/").slice(-1)[0],
        });
      } catch (e) {
        processManager.terminal.io.println(
          "download: unable to save file locally"
        );
        return 1; // TODO: what would be a proper error here?
      }
      const writable = await localHandle.createWritable();
      // @ts-ignore pipeTo is still experimental
      return stream.pipeTo(writable);
    })
  );
  return 0;
}

export async function ps(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  let psData = "  PID TTY          TIME CMD\n\r";
  for (const [id, workerInfo] of Object.entries(processManager.processInfos)) {
    const now = new Date();
    // @ts-ignore Property 'timestamp' does not exits on type unknown (workerInfo type is not recognized)
    const time = Math.floor(now.getTime() / 1000) - workerInfo.timestamp;
    const seconds = time % 60;
    const minutes = ((time - seconds) / 60) % 60;
    const hours = (time - seconds - minutes * 60) / 60 / 60;
    psData += `${`     ${id}`.slice(-5)} pts/0    ${`00${hours}`.slice(
      -2
    )}:${`00${minutes}`.slice(-2)}:${`00${seconds}`.slice(-2)} ${
      // @ts-ignore Property 'cmd' does not exits on type unknown (workerInfo type is not recognized)
      workerInfo.cmd.split("/").slice(-1)[0]
    }\n\r`;
  }
  processManager.terminalOutputCallback(psData);
  return 0;
}

export async function free(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  // @ts-ignore memory is non-standard API available only in Chrome
  const totalMemoryRaw = performance.memory.jsHeapSizeLimit;
  // @ts-ignore
  const usedMemoryRaw = performance.memory.usedJSHeapSize;
  let totalMemory = "";
  let usedMemory = "";
  let availableMemory = "";
  if (args.length > 1 && args[1] === "-h") {
    totalMemory = utils.human_readable(totalMemoryRaw);
    usedMemory = utils.human_readable(usedMemoryRaw);
    availableMemory = utils.human_readable(totalMemoryRaw - usedMemoryRaw);
  } else {
    totalMemory = `${Math.round(totalMemoryRaw / 1024)}`;
    usedMemory = `${Math.round(usedMemoryRaw / 1024)}`;
    availableMemory = `${Math.round((totalMemoryRaw - usedMemoryRaw) / 1024)}`;
  }
  let freeData = "               total        used   available\n\r";
  freeData += `Mem:      ${`          ${totalMemory}`.slice(
    -10
  )}  ${`          ${usedMemory}`.slice(
    -10
  )}  ${`          ${availableMemory}`.slice(-10)}\n\r`;
  processManager.terminalOutputCallback(freeData);
  return 0;
}
