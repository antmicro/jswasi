export const enum FileOrDir {
    File = 1,
    Directory = 2,
    Any = 3,
}

export const enum OpenFlags {
    Create = 1, // constants.WASI_O_CREAT,
    Directory = 2, // constants.WASI_O_DIRECTORY,
    Exclusive = 4, // constants.WASI_O_EXCL,
    Truncate = 8, // constants.WASI_O_TRUNC,
}

export function parsePath(path: string): {parts: string[], name: string} {
    const parts = path.split("/").filter(part => part !== "");
    const name = parts.pop();
    return {parts, name};
}

// TODO: we can use dynamic import() expression to export different filesystem classes
//  under the same name depending on the platform (browser/node)
