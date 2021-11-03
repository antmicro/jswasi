import * as constants from "./constants.js";
import * as utils from "./utils.js";
import { FileOrDir } from "./browser-fs.js";
import { filesystem, fetchFile } from "./browser-shell.js";
import { ProcessManager } from "./process-manager";

export async function mount(
  processManager: ProcessManager,
  process_id: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  console.log(`mount(${process_id}, ${args})`);

  switch (args.length) {
    case 1: {
      processManager.terminal.io.println("wasmfs on /");
      for (const mount of filesystem.mounts) {
        processManager.terminal.io.println(
          `fsapi on /${`${mount.parts.join("/")}/${mount.name}`}`
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

      let mount_point;
      try {
        mount_point = await showDirectoryPicker();
      } catch (e) {
        processManager.terminal.io.println(
          "mount: failed to open local directory"
        );
        return 1; // TODO: what would be a proper error here?
      }

      await filesystem.addMount(path, mount_point);
      return 0;
    }
    default: {
      processManager.terminal.io.println("mount: help: mount [<mountpoint>]");
      return 1;
    }
  }
}

export function umount(
  processManager: ProcessManager,
  process_id: number,
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
  process_id: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  let path: string;
  let address: string;
  if (args.length == 2) {
    address = args[1];
    path = address.split("/").slice(-1)[0];
  } else if (args.length == 3) {
    address = args[1];
    path = args[2];
  } else {
    processManager.terminal.io.println("wget: help: wget <address> [<path>]");
    return 1;
  }
  if (!path.startsWith("/")) {
    path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
  }
  const { err, name, dir } = await filesystem.resolveAbsolute(path);
  await fetchFile(dir, path, address);
  return 0;
}

export async function download(
  processManager: ProcessManager,
  process_id: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  if (args.length === 1) {
    processManager.terminal.io.println(
      "download: help: download <address> [<path>]"
    );
    return 1;
  }
  for (let path of args.slice(1)) {
    if (!path.startsWith("/")) {
      path = `${env.PWD === "/" ? "" : env.PWD}/${path}`;
    }

    const { err, entry } = await (
      await filesystem.rootDir
    ).getEntry(path, FileOrDir.File);
    if (err !== constants.WASI_ESUCCESS) {
      processManager.terminal.io.println(`download: no such file: ${path}`);
    } else {
      const stream = (await entry._handle.getFile()).stream();
      let local_handle;
      try {
        local_handle = await window.showSaveFilePicker({
          // @ts-ignore 'suggestedName' does not exist in type 'SaveFilePickerOptions' (it does)
          suggestedName: path.split("/").slice(-1)[0],
        });
      } catch (e) {
        processManager.terminal.io.println(
          "download: unable to save file locally"
        );
        return 1; // TODO: what would be a proper error here?
      }
      const writable = await local_handle.createWritable();
      await stream.pipeTo(writable);
    }
  }
  return 0;
}

export async function ps(
  processManager: ProcessManager,
  process_id: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  let ps_data = "  PID TTY          TIME CMD\n\r";
  for (const [id, workerInfo] of Object.entries(processManager.processInfos)) {
    const now = new Date();
    // @ts-ignore Property 'timestamp' does not exits on type unknown (workerInfo type is not recognised)
    const time = Math.floor(now.getTime() / 1000) - workerInfo.timestamp;
    const seconds = time % 60;
    const minutes = ((time - seconds) / 60) % 60;
    const hours = (time - seconds - minutes * 60) / 60 / 60;
    ps_data += `${`     ${id}`.slice(-5)} pts/0    ${`00${hours}`.slice(
      -2
    )}:${`00${minutes}`.slice(-2)}:${`00${seconds}`.slice(-2)} ${
      // @ts-ignore Property 'cmd' does not exits on type unknown (workerInfo type is not recognised)
      workerInfo.cmd.split("/").slice(-1)[0]
    }\n\r`;
  }
  processManager.terminalOutputCallback(ps_data);
  return 0;
}

export async function free(
  processManager: ProcessManager,
  process_id: number,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  // @ts-ignore memory is non-standard API available only in Chrome
  const total_mem_raw = performance.memory.jsHeapSizeLimit;
  // @ts-ignore
  const used_mem_raw = performance.memory.usedJSHeapSize;
  let total_mem = "";
  let used_mem = "";
  let avail_mem = "";
  if (args.length > 1 && args[1] == "-h") {
    total_mem = utils.human_readable(total_mem_raw);
    used_mem = utils.human_readable(used_mem_raw);
    avail_mem = utils.human_readable(total_mem_raw - used_mem_raw);
  } else {
    total_mem = `${Math.round(total_mem_raw / 1024)}`;
    used_mem = `${Math.round(used_mem_raw / 1024)}`;
    avail_mem = `${Math.round((total_mem_raw - used_mem_raw) / 1024)}`;
  }
  let free_data = "               total        used   available\n\r";
  free_data += `Mem:      ${`          ${total_mem}`.slice(
    -10
  )}  ${`          ${used_mem}`.slice(-10)}  ${`          ${avail_mem}`.slice(
    -10
  )}\n\r`;
  processManager.terminalOutputCallback(free_data);
  return 0;
}
