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
