import { Filesystem, OpenFile, OpenDirectory } from "./interfaces";
import { FdFlags, LookupFlags, OpenFlags } from "./enums";
import { In, Out, EventSource } from "../devices";

export type FileDescriptor = In | Out | OpenFile | OpenDirectory | EventSource;

class TopLevelFs {
  private topLevelFilesystem: Filesystem;

  async getEntry(
    fd: OpenDirectory,
    dirflags: LookupFlags,
    path: string,
    oflags: OpenFlags,
    fdflags: FdFlags
  ): Promise<FileDescriptor> {
    return this.topLevelFilesystem.getEntry(
      fd,
      dirflags,
      path,
      oflags,
      fdflags
    );
  }
}
