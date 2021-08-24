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
