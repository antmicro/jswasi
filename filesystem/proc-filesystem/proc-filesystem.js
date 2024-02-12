import * as constants from "../../constants.js";
import { ProcFileDescriptor, ProcDirectoryDescriptor, } from "./proc-descriptors.js";
import * as proc from "./proc-tree.js";
export class ProcFilesystem {
    processManager;
    constructor(processManager) {
        this.processManager = processManager;
        proc.initialize(this.processManager);
    }
    mkdirat(_desc, _path) {
        return Promise.resolve(constants.WASI_EACCES);
    }
    getFilestat(_path) {
        return Promise.resolve({
            err: constants.WASI_ENOTSUP,
            filestat: undefined,
        });
    }
    open(path, _dirflags, oflags, fs_rights_base, fs_rights_inheriting, fdflags, workerId) {
        let currentNode = proc.getTopLevelNode(workerId);
        let err = constants.WASI_ESUCCESS, index = -1;
        let start = path.startsWith("/") ? 0 : -1, stop = path.indexOf("/", start + 1);
        do {
            const __path = stop === -1 ? path.slice(start + 1) : path.slice(start + 1, stop);
            if (currentNode.getFilestat().filetype !== constants.WASI_FILETYPE_DIRECTORY) {
                err = constants.WASI_ENOTDIR;
                index = start;
                break;
            }
            const nextNode = currentNode.getNode(__path);
            if (nextNode.err !== constants.WASI_ESUCCESS) {
                err = nextNode.err;
                index = stop;
                break;
            }
            currentNode = nextNode.node;
            const __stop = path.indexOf("/", stop + 1);
            start = stop;
            stop = __stop;
        } while (start !== -1);
        if (start === -1) {
            index = -1;
            if (err === constants.WASI_ESUCCESS) {
                if (oflags & constants.WASI_O_DIRECTORY &&
                    currentNode.getFilestat().filetype !==
                        constants.WASI_FILETYPE_DIRECTORY) {
                    err = constants.WASI_ENOTDIR;
                }
                else if (oflags & constants.WASI_O_CREAT &&
                    oflags & constants.WASI_O_EXCL) {
                    err = constants.WASI_EEXIST;
                }
            }
            else if (err === constants.WASI_ENOENT &&
                oflags & constants.WASI_O_CREAT) {
                err = constants.WASI_EACCES;
            }
        }
        let desc;
        const __ftype = currentNode.getFilestat().filetype;
        if (__ftype === constants.WASI_FILETYPE_DIRECTORY) {
            desc = new ProcDirectoryDescriptor(fdflags, fs_rights_base, fs_rights_inheriting, currentNode);
        }
        else {
            const __node = __ftype === constants.WASI_FILETYPE_REGULAR_FILE
                ? currentNode
                : currentNode;
            desc = new ProcFileDescriptor(fdflags, fs_rights_base, fs_rights_inheriting, __node);
        }
        return Promise.resolve({ err, index, desc });
    }
    unlinkat(_desc, _path, _is_dir) {
        return Promise.resolve(constants.WASI_EACCES);
    }
    renameat(_oldDesc, _oldPath, _newDesc, _newPath) {
        return Promise.resolve(constants.WASI_EACCES);
    }
    symlinkat(_target, _desc, _linkpath) {
        return Promise.resolve(constants.WASI_EACCES);
    }
    initialize(_opts) {
        return Promise.resolve(constants.WASI_ESUCCESS);
    }
    mknodat(_desc, _path, _dev, _args) {
        return Promise.resolve(constants.WASI_EACCES);
    }
}
