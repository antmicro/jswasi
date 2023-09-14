import * as constants from "./constants.js";
import * as utils from "./utils.js";
import { fetchFile } from "./terminal.js";
import ProcessManager, { FdTable } from "./process-manager";

export async function wget(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>,
  fds: FdTable
): Promise<number> {
  const stderr = fds.getDesc(2);

  let path: string;
  let address: string;
  let operator: string;
  if (args.length === 2) {
    [, address] = args;
    [path] = address.split("/").slice(-1);
  } else if (args.length === 3) {
    [, address, path] = args;
  } else if (args.length === 4) {
    [, address, operator, path] = args;
    if (operator != "-O") {
      await stderr.write(
        new TextEncoder().encode(
          "wget: help: wget <address> [<path>] or wget <addres> -O <path>\n"
        )
      );
      return 1;
    }
  } else {
    await stderr.write(
      new TextEncoder().encode("wget: help: wget <address> [<path>]\n")
    );
    return 1;
  }
  /* if (path == "-") {
    try {
      await fetchFile(processManager.filesystem, null, address, true, stdout, stderr, true);
    } catch (error: any) {
      await stderr.write(
        new TextEncoder().encode(
          `wget: could not get resource: ${error.message.toLowerCase()}\n`
        )
      );
      return 1;
    }
    return 0;
  } */
  if (!path.startsWith("/")) {
    path = `${env["PWD"] === "/" ? "" : env["PWD"]}/${path}`;
  }
  try {
    await fetchFile(processManager.filesystem, path, address, true);
  } catch (error: any) {
    await stderr.write(
      new TextEncoder().encode(
        `wget: could not get resource: ${error.message.toLowerCase()}\n`
      )
    );
    return 1;
  }
  return 0;
}

/* export async function download(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  const stderr = processManager.processInfos[processId].fds.getFd(2) as Stderr;

  if (args.length === 1) {
    await stderr.write(
      new TextEncoder().encode("download: help: download <address> [<path>]\n")
    );
    return 1;
  }
  await Promise.all(
    args.slice(1).map(async (path: string) => {
      if (!path.startsWith("/")) {
        path = `${env["PWD"] === "/" ? "" : env["PWD"]}/${path}`;
      }

      const { err, desc } = await processManager.filesystem.open(path, constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW);
      if (err !== constants.WASI_ESUCCESS) {
        await stderr.write(
          new TextEncoder().encode(`download: no such file: ${path}\n`)
        );
        return Promise.resolve();
      }

      const stream = await desc.readableStream();
      let localHandle;
      try {
        localHandle = await window.showSaveFilePicker({
          // @ts-ignore 'suggestedName' does not exist in type 'SaveFilePickerOptions' (it does)
          suggestedName: path.split("/").slice(-1)[0],
        });
      } catch (e) {
        await stderr.write(
          new TextEncoder().encode("download: unable to save file locally\n")
        );
        return constants.EXIT_FAILURE;
      }
      const writable = await localHandle.createWritable();
      // @ts-ignore pipeTo is still experimental
      return stream.pipeTo(writable);
    })
  );
  return constants.EXIT_SUCCESS;
} */

export async function ps(
  processManager: ProcessManager,
  _processId: number,
  _args: string[],
  _env: Record<string, string>,
  fds: FdTable
): Promise<number> {
  const stdout = fds.getDesc(1);

  let psData = "  PID TTY          TIME CMD\r\n";
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
    }\r\n`;
  }

  // for now ps must be added artificially
  psData += `-1 pts/0    00:00:00 ps\r\n`;
  await stdout.write(new TextEncoder().encode(psData));
  stdout.close();
  return 0;
}

export async function free(
  processManager: ProcessManager,
  processId: number,
  args: string[],
  _env: Record<string, string>,
  fds: FdTable
): Promise<number> {
  const stdout = fds.getDesc(1);

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
  let freeData = "               total        used   available\r\n";
  freeData += `Mem:      ${`          ${totalMemory}`.slice(
    -10
  )}  ${`          ${usedMemory}`.slice(
    -10
  )}  ${`          ${availableMemory}`.slice(-10)}\r\n`;
  await stdout.write(new TextEncoder().encode(freeData));

  return constants.EXIT_SUCCESS;
}

export async function reset(
  _processManager: ProcessManager,
  _processId: number,
  _args: string[],
  _env: Record<string, string>,
  _fds: FdTable
): Promise<number> {
  location.reload();
  return constants.EXIT_SUCCESS;
}
