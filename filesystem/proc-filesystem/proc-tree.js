import * as constants from "../../constants.js";
let processManager;
export function initialize(pm) {
    processManager = pm;
}
export function getTopLevelNode(pid) {
    return new TopLevelDirectory(pid);
}
class AbstractProcSymlink {
    static filestat = {
        dev: 0n,
        ino: 0n,
        filetype: constants.WASI_FILETYPE_SYMBOLIC_LINK,
        nlink: 1n,
        size: 0n,
        mtim: 0n,
        atim: 0n,
        ctim: 0n,
    };
    constructor() { }
    getFilestat() {
        return AbstractProcSymlink.filestat;
    }
}
class AbstractProcFile {
    static filestat = {
        dev: 0n,
        ino: 0n,
        filetype: constants.WASI_FILETYPE_REGULAR_FILE,
        nlink: 1n,
        size: 0n,
        mtim: 0n,
        atim: 0n,
        ctim: 0n,
    };
    getFilestat() {
        return AbstractProcFile.filestat;
    }
}
class AbstractProcDirectory {
    pid;
    static filestat = {
        dev: 0n,
        ino: 0n,
        filetype: constants.WASI_FILETYPE_DIRECTORY,
        nlink: 1n,
        size: 0n,
        mtim: 0n,
        atim: 0n,
        ctim: 0n,
    };
    constructor(pid) {
        this.pid = pid;
    }
    getFilestat() {
        return AbstractProcDirectory.filestat;
    }
}
class MountinfoFile extends AbstractProcFile {
    read() {
        return (Object.entries(processManager.filesystem.getMounts())
            .map(([mountPoint, fs]) => `${mountPoint} ${fs.constructor.name}`)
            .join("\n") + "\n");
    }
}
class SelfSymlink extends AbstractProcSymlink {
    pid;
    constructor(pid) {
        super();
        this.pid = pid;
    }
    read() {
        return this.pid.toString();
    }
}
export class TopLevelDirectory extends AbstractProcDirectory {
    static specialNodes = {
        self: SelfSymlink,
    };
    listNodes() {
        let nodes = {};
        for (const [name, callback] of Object.entries(TopLevelDirectory.specialNodes))
            nodes[name] = new callback(this.pid);
        for (const pid of Object.keys(processManager.processInfos))
            nodes[pid.toString()] = new ProcessDirectory(Number(pid));
        return {
            err: constants.WASI_ESUCCESS,
            nodes,
        };
    }
    getNode(name) {
        if (name === "") {
            return { err: constants.WASI_ESUCCESS, node: this };
        }
        const num = Number(name);
        if (!isNaN(num)) {
            if (processManager.processInfos[num] !== undefined) {
                return {
                    err: constants.WASI_ESUCCESS,
                    node: new ProcessDirectory(num),
                };
            }
        }
        else if (name === "self") {
            return {
                err: constants.WASI_ESUCCESS,
                node: new SelfSymlink(this.pid),
            };
        }
        return {
            err: constants.WASI_ENOENT,
            node: undefined,
        };
    }
}
class ProcessDirectory extends AbstractProcDirectory {
    static specialNodes = {
        mountinfo: MountinfoFile,
    };
    listNodes() {
        let nodes = {};
        for (const [name, callback] of Object.entries(ProcessDirectory.specialNodes))
            nodes[name] = new callback(this.pid);
        return {
            err: constants.WASI_ESUCCESS,
            nodes,
        };
    }
    getNode(name) {
        switch (name) {
            case "mountinfo":
                return {
                    err: constants.WASI_ESUCCESS,
                    node: new MountinfoFile(),
                };
            default:
                return {
                    err: constants.WASI_ENOENT,
                    node: undefined,
                };
        }
    }
}
