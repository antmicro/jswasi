// Specifies open mode for getting a filesystem entry
export const enum FileOrDir {
  // Only open if it's a file
  File = 1,
  // Only open if it's a directory
  Directory = 2,
  // Open either file or directory
  Any = 3,
}

// Open flags used by path_open.
export const enum OpenFlags {
  // If none of the flags shouldn't be set
  None = 0,
  // Create file if it doesn't exist. Value of constants.WASI_O_CREAT.
  Create = 1,
  // Fail if not a directory. Value of constants.WASI_O_DIRECTORY.
  Directory = 2,
  // Fail if file already exists. Value of constants.WASI_O_EXCL.
  Exclusive = 4,
  // Truncate file to size 0. Value of constants.WASI_O_TRUNC.
  Truncate = 8,
}

// Flags determining the method of how paths are resolved.
export const enum LookupFlags {
  // Don't follow symbolic links, return symbolic file itself
  NoFollow = 0,
  // As long as the resolved path corresponds to a symbolic link, it is expanded.
  SymlinkFollow = 1,
}

// File descriptor rights, determining which actions may be performed.
export const enum Rights {
  None = 0,
  // The right to invoke fd_datasync. If path_open is set, includes the right to invoke path_open with fdflags::dsync.
  FdDatasync = 1 << 0,
  // The right to invoke fd_read and sock_recv. If rights::fd_seek is set, includes the right to invoke fd_pread.
  FdRead = 1 << 1,
  // The right to invoke fd_seek. This flag implies rights::fd_tell.
  FdSeek = 1 << 2,
  // The right to invoke fd_fdstat_set_flags.
  FdFdstatSetFlags = 1 << 3,
  // The right to invoke fd_sync. If path_open is set, includes the right to invoke path_open with fdflags::rsync and fdflags::dsync.
  FdSync = 1 << 4,
  // The right to invoke fd_seek in such a way that the file offset remains unaltered (i.e., whence::cur with offset zero), or to invoke fd_tell.
  FdTell = 1 << 5,
  // The right to invoke fd_write and sock_send. If rights::fd_seek is set, includes the right to invoke fd_pwrite.
  FdWrite = 1 << 6,
  // The right to invoke fd_advise.
  FdAdvise = 1 << 7,
  // The right to invoke fd_allocate.
  FdAllocate = 1 << 8,
  // The right to invoke path_create_directory.
  PathCreateDirectory = 1 << 9,
  // If path_open is set, the right to invoke path_open with oflags::creat.
  PathCreateFile = 1 << 10,
  // The right to invoke path_link with the file descriptor as the source directory.
  PathLinkSource = 1 << 11,
  // The right to invoke path_link with the file descriptor as the target directory.
  PathLinkTarget = 1 << 12,
  // The right to invoke path_open.
  PathOpen = 1 << 13,
  // The right to invoke fd_readdir.
  FdReadDir = 1 << 14,
  // The right to invoke path_readlink.
  PathReadLink = 1 << 15,
  // The right to invoke path_rename with the file descriptor as the source directory.
  PathRenameSource = 1 << 16,
  // The right to invoke path_rename with the file descriptor as the target directory.
  PathRenameTarget = 1 << 17,
  // The right to invoke path_filestat_get.
  PathFilestatGet = 1 << 18,
  // The right to change a file's size (there is no path_filestat_set_size).
  // If path_open is set, includes the right to invoke path_open with oflags::trunc.
  PathFilestatSetSize = 1 << 19,
  // The right to invoke path_filestat_set_times.
  PathFilestatSetTimes = 1 << 20,
  // The right to invoke fd_filestat_get.
  FdFilestatGet = 1 << 21,
  // The right to invoke fd_filestat_set_size.
  FdFilestatSetSize = 1 << 22,
  // The right to invoke fd_filestat_set_times.
  FdFilestatSetTimes = 1 << 23,
  // The right to invoke path_symlink.
  PathSymlink = 1 << 24,
  //  The right to invoke path_remove_directory.
  PathRemoveDirectory = 1 << 25,
  // The right to invoke path_unlink_file.
  PathUnlinkFile = 1 << 26,
  // If rights::fd_read is set, includes the right to invoke poll_oneoff to subscribe to eventtype::fd_read.
  // If rights::fd_write is set, includes the right to invoke poll_oneoff to subscribe to eventtype::fd_write.
  PollFdReadWrite = 1 << 27,
  // The right to invoke sock_shutdown.
  SockShutdown = 1 << 28,
}

// File descriptor flags.
export const enum FdFlags {
  None = 0,
  // Append mode: Data written to the file is always appended to the file's end.
  Append = 1 << 0,
  // Write according to synchronized I/O data integrity completion. Only the data stored in the file is synchronized.
  DSync = 1 << 1,
  // Non-blocking mode.
  NonBlock = 1 << 2,
  // Synchronized read I/O operations.
  RSync = 1 << 3,
  // Write according to synchronized I/O file integrity completion.
  // In addition to synchronizing the data stored in the file, the implementation may also synchronously update the file's metadata.
  Sync = 1 << 4,
}

// Data about a file or directory that must be stored persistently
export type StoredData = {
  // file type
  fileType: number;
  // read-write-execute permissions of user
  userMode: number;
  // read-write-execute permissions of group
  groupMode: number;
  // user ID of owner
  uid: number;
  // group ID of owner
  gid: number;
  // access time
  atim: bigint;
  // modification time
  mtim: bigint;
  // change time
  ctim: bigint;
};

// All metadata about a file or directory
export type Metadata = {
  // ID of device containing file
  dev: bigint;
  // inode number (always 0)
  ino: bigint;
  // file type
  fileType: number;
  // read-write-execute permissions of user
  userMode: number;
  // read-write-execute permissions of group
  groupMode: number;
  // number of hard links (always 0)
  nlink: bigint;
  // user ID of owner
  uid: number;
  // group ID of owner
  gid: number;
  // device ID (if special file)
  rdev: number;
  // total size, in bytes
  size: bigint;
  // block size for filesystem I/O
  blockSize: number;
  // number of 512B blocks allocated
  blocks: number;
  // access time
  atim: bigint;
  // modification time
  mtim: bigint;
  // change time
  ctim: bigint;
};

// Data returned about a file or directory in various syscalls
export type Stat = {
  dev: bigint;
  ino: bigint;
  fileType: number;
  nlink: bigint;
  size: bigint;
  atim: bigint;
  mtim: bigint;
  ctim: bigint;
};
