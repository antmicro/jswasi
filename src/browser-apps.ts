import * as constants from "./constants.js";
import * as utils from "./utils.js";
import { FileOrDir } from "./filesystem.js";
import { filesystem, fetchFile } from "./terminal.js";
import ProcessManager from "./process-manager";

const ENCODER = new TextEncoder();

export async function mount(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  console.log(`mount(${processId}, ${args})`);

  const stdout = processManager.processInfos[processId].fds[1];
  const stderr = processManager.processInfos[processId].fds[2];

  switch (args.length) {
    case 1: {
      stdout.write(ENCODER.encode("wasmfs on /\n"));
      for (const mountPoint of filesystem.mounts) {
        stdout.write(
          ENCODER.encode(
            `fsapi on /${`${mountPoint.parts.join("/")}/${mountPoint.name}`}\n`
          )
        );
      }
      return constants.WASI_ESUCCESS;
    }
    case 2: {
      let path = args[1];
      if (path === "/") {
        stderr.write(ENCODER.encode(`mount: cannot mount at root directory\n`));
        return 1;
      }
      // handle relative path
      if (!path.startsWith("/")) {
        path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
      }

      // check if path exits
      if (!(await filesystem.pathExists(path, FileOrDir.Directory))) {
        stdout.write(ENCODER.encode(`mount: ${path}: no such directory\n`));
        return 1;
      }

      let mountPoint;
      try {
        // eslint-disable-next-line no-undef
        mountPoint = await showDirectoryPicker();
      } catch (e) {
        stderr.write(ENCODER.encode("mount: failed to open local directory\n"));
        return 1; // TODO: what would be a proper error here?
      }

      await filesystem.addMount(path, mountPoint);
      return 0;
    }
    default: {
      stderr.write(ENCODER.encode("mount: help: mount [<mount-point>]\n"));
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
  const stderr = processManager.processInfos[processId].fds[2];

  let path = args[1];
  // handle relative path
  if (!path.startsWith("/")) {
    path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
  }

  if (!filesystem.isMounted(path)) {
    stderr.write(ENCODER.encode(`umount: ${path}: not mounted\n`));
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
  const stderr = processManager.processInfos[processId].fds[2];

  let path: string;
  let address: string;
  if (args.length === 2) {
    [, address] = args;
    [path] = address.split("/").slice(-1);
  } else if (args.length === 3) {
    [, address, path] = args;
  } else {
    stderr.write(ENCODER.encode("wget: help: wget <address> [<path>]\n"));
    return 1;
  }
  if (!path.startsWith("/")) {
    path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
  }
  const { dir } = await filesystem.resolveAbsolute(path);
  try {
    await fetchFile(dir, path, address);
  } catch (error) {
    stderr.write(
      ENCODER.encode(
        `wget: could not get resource: ${error.message.toLowerCase()}\n`
      )
    );
    return 1;
  }
  return 0;
}

export async function download(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  const stderr = processManager.processInfos[processId].fds[2];

  if (args.length === 1) {
    stderr.write(
      ENCODER.encode("download: help: download <address> [<path>]\n")
    );
    return 1;
  }
  await Promise.all(
    args.slice(1).map(async (path: string) => {
      if (!path.startsWith("/")) {
        path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
      }

      const { err, entry } = await filesystem.rootDir.getEntry(
        path,
        FileOrDir.File
      );
      if (err !== constants.WASI_ESUCCESS) {
        stderr.write(ENCODER.encode(`download: no such file: ${path}\n`));
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
        stderr.write(ENCODER.encode("download: unable to save file locally\n"));
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  args: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  env: Record<string, string>
): Promise<number> {
  const stdout = processManager.processInfos[processId].fds[1];
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

  stdout.write(ENCODER.encode(psData));
  return 0;
}

export async function free(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  env: Record<string, string>
): Promise<number> {
  const stdout = processManager.processInfos[processId].fds[1];

  // @ts-ignore memory is non-standard API available only in Chrome
  const totalMemoryRaw = performance.memory.jsHeapSizeLimit;
  // @ts-ignore
  const usedMemoryRaw = performance.memory.usedJSHeapSize;
  let totalMemory = "";
  let usedMemory = "";
  let availableMemory = "";
  if (args.length > 1 && args[1] === "-h") {
    totalMemory = utils.humanReadable(totalMemoryRaw);
    usedMemory = utils.humanReadable(usedMemoryRaw);
    availableMemory = utils.humanReadable(totalMemoryRaw - usedMemoryRaw);
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
  stdout.write(ENCODER.encode(freeData));
  return 0;
}

export async function reset(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processManager: ProcessManager,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processId: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  args: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  env: Record<string, string>
): Promise<number> {
  location.reload();
  return 0;
}
