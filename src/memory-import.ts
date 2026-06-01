import { WASM_EXECUTABLE_MAGICNUMBER } from "./process-manager.js";
import { readLEB128 } from "./utils.js";

export type ModuleMemoryInfo = {
  pages: number;
  isShared: boolean;
};

function parseLimits(
  bytes: Uint8Array,
  offset: number = 0,
): {
  flags: number;
  initial: number;
  maximum?: number;
  bytesRead: number;
} {
  const flags = bytes[offset++];

  const initialData = readLEB128(bytes, offset);
  const initial = initialData.value;
  offset += initialData.bytesRead;

  let bytesRead = 0;

  let maximum = null;
  if ((flags & 1) === 1) {
    const maxData = readLEB128(bytes, offset);
    maximum = maxData.value;
    bytesRead = maxData.bytesRead;
  }

  return { flags, initial, maximum, bytesRead };
}

/*
We need to know required initial memory when spawning modules that import memory from JS.
Unfortunately, API to fetch that is stuck in proposals,
see: https://github.com/WebAssembly/js-types/blob/main/proposals/js-types/Overview.md
type MemoryType = {limits: Limits}

For now this method is used as a substitute.
It reads the beginning of the WASM binary up until the imports section and looks for memtype import
and tries to parse it.
This check takes less than 0.1ms.
*/
export function getWasmImportedMemoryInfo(
  buffer: ArrayBuffer,
): ModuleMemoryInfo {
  const IMPORTS_SECTION_ID = 2;

  const bytes = new Uint8Array(buffer);
  const magic = new DataView(buffer).getUint32(0, true);
  if (magic !== WASM_EXECUTABLE_MAGICNUMBER)
    throw new Error("Not a valid WASM file");

  let offset = 8; // skip magic and version numbers

  while (offset < bytes.length) {
    const sectionId = bytes[offset++];
    const sizeData = readLEB128(bytes, offset);
    const sectionSize = sizeData.value;
    offset += sizeData.bytesRead;

    if (sectionId === IMPORTS_SECTION_ID) {
      let impOffset = offset;

      const countData = readLEB128(bytes, impOffset);
      const importCount = countData.value;
      impOffset += countData.bytesRead;

      for (let i = 0; i < importCount; i++) {
        const modLenData = readLEB128(bytes, impOffset);
        impOffset += modLenData.bytesRead + modLenData.value;

        const fieldLenData = readLEB128(bytes, impOffset);
        impOffset += fieldLenData.bytesRead + fieldLenData.value;

        const kind = bytes[impOffset++];

        if (kind === 0) {
          // func
          const typeIdx = readLEB128(bytes, impOffset);
          impOffset += typeIdx.bytesRead;
        } else if (kind === 1) {
          // table
          impOffset++;
          const limits = parseLimits(bytes, impOffset);
          impOffset += limits.bytesRead;
        } else if (kind === 2) {
          // mem
          const limits = parseLimits(bytes, impOffset);
          return {
            pages: limits.initial,
            isShared: (limits.flags & 2) === 2,
          };
        } else if (kind === 3) {
          // global
          impOffset += 2;
        }
      }
    } else if (sectionId > IMPORTS_SECTION_ID) break;

    offset += sectionSize;
  }

  return null;
}
