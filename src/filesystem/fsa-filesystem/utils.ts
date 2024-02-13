import * as constants from "../../constants.js";

export async function initMetadataPath(handle: FileSystemHandle): Promise<string> {
  const components = await (
    await navigator.storage.getDirectory()
  // @ts-ignore
  ).resolve(handle);
  return components.join("/");
}

export async function getTopLevelHandle(name: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory().then(async dir => {
    return await dir.getDirectoryHandle(name, {
      create: create
    });
  });
}

export async function getHostDirectoryHandle(): Promise<{handle: FileSystemDirectoryHandle; err: number }> {
  try {
    // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
    // @ts-ignore
    const handle = await showDirectoryPicker();
    return { err: constants.WASI_ESUCCESS, handle };
  } catch (_) {
    // TODO: Catch error and return proper error code
    return { err: constants.WASI_ENOENT, handle: undefined };
  }
}

export function mapErr(e: DOMException, isDir: boolean): number {
  switch (e.name) {
    case "NotAllowedError":
      return constants.WASI_EACCES;
    case "TypeMismatchError":
      if (isDir)
        return constants.WASI_ENOTDIR;
      else
        return constants.WASI_EISDIR;
    case "NotFoundError":
      return constants.WASI_ENOENT;
    case "InvalidModificationError":
      return constants.WASI_ENOTEMPTY;
    case "QuotaExceededError":
      return constants.WASI_EDQUOT;
    default:
      return constants.WASI_EINVAL;
  }
}
