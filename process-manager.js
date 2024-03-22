import * as constants from "./constants.js";
import { EventSource } from "./devices.js";
import syscallCallback from "./syscalls.js";
export const DEFAULT_WORK_DIR = "/home/ant";
export const DEFAULT_ENV = {
    PATH: "/usr/bin:/usr/local/bin",
    PWD: DEFAULT_WORK_DIR,
    OLDPWD: DEFAULT_WORK_DIR,
    TMPDIR: "/tmp",
    TERM: "xterm-256color",
    HOME: DEFAULT_WORK_DIR,
    SHELL: "/usr/bin/wash",
    LANG: "en_US.UTF-8",
    USER: "ant",
    HOSTNAME: "browser",
    PYTHONHOME: "/",
    PS1: "\x1b[1;34m\\u@\\h \x1b[1;33m\\w$\x1b[0m ",
};
export class DescriptorEntry {
    desc;
    fdFlags;
    constructor(desc) {
        if (desc === undefined) {
            throw "DescriptorEntry must not contain undefined descriptor!";
        }
        this.desc = desc;
        this.fdFlags = 0;
    }
}
export class FdTable {
    fdt = {};
    freeFds = [];
    topFd;
    constructor(fds) {
        this.fdt = { ...fds };
        this.topFd = Object.keys(fds).length - 1;
    }
    clone() {
        var fdTable = new FdTable([]);
        fdTable.freeFds = this.freeFds.slice(0);
        for (let key in this.fdt) {
            if ((this.fdt[key].fdFlags & constants.WASI_EXT_FDFLAG_CLOEXEC) === 0) {
                fdTable.fdt[key] = new DescriptorEntry(this.fdt[key].desc);
            }
            else {
                fdTable.freeFds.push(Number(key));
            }
        }
        fdTable.freeFds.sort();
        fdTable.topFd = this.topFd;
        return fdTable;
    }
    addFile(entry) {
        if (entry === undefined) {
            throw "Entry is undefined";
        }
        let descEntry = new DescriptorEntry(entry);
        let fd = this.freeFds.shift();
        if (fd !== undefined) {
            this.fdt[fd] = descEntry;
            return fd;
        }
        else {
            fd = ++this.topFd;
            // User could take arbitrary fd number above topFd before so
            // we need to find first free fd
            while (this.fdt[fd] !== undefined) {
                fd = ++this.topFd;
            }
            this.fdt[fd] = descEntry;
            return fd;
        }
    }
    freeFd(fd) {
        if (!(fd in this.fdt)) {
            throw "descriptor not present in descriptor table";
        }
        delete this.fdt[fd];
        this.freeFds.push(fd);
    }
    replaceFd(fd, entry) {
        if (!(fd in this.fdt)) {
            throw "descriptor not present in descriptor table";
        }
        if (entry === undefined) {
            throw "Entry is undefined";
        }
        this.fdt[fd] = entry;
    }
    getFdEntry(fd) {
        return this.fdt[fd];
    }
    getDesc(fd) {
        return this.fdt[fd] !== undefined ? this.fdt[fd].desc : undefined;
    }
    setFd(fd, entry) {
        this.prepareToStoreFd(fd);
        // We assume dstFd is closed!
        if (this.fdt[fd] !== undefined) {
            console.log(`setFd: overwrite opened fd = ${fd}`);
        }
        this.fdt[fd] = entry;
    }
    duplicateFd(srcFd, dstFd) {
        this.prepareToStoreFd(dstFd);
        // We assume dstFd is closed!
        if (this.fdt[dstFd] !== undefined) {
            console.log(`duplicateFd: overwrite opened fd = ${dstFd}`);
        }
        this.fdt[dstFd] = new DescriptorEntry(this.fdt[srcFd].desc);
    }
    prepareToStoreFd(fd) {
        // When user want to use arbitary fd number then we drop
        // this number from freeFds array if exists
        let idx = this.freeFds.findIndex((element) => element == fd);
        if (idx >= 0) {
            this.freeFds.splice(idx, 1);
        }
    }
    tearDown() {
        Promise.all(Object.values(this.fdt).map(async (fileDescriptor) => {
            if (fileDescriptor !== undefined) {
                if (fileDescriptor.desc !== undefined) {
                    fileDescriptor.desc.close();
                }
                else {
                    console.error("Descriptor entry has undefined descriptor!");
                }
            }
            else {
                console.error("Descriptor entry is undefined!");
            }
        }));
    }
}
export class ProcessInfo {
    id;
    cmd;
    worker;
    fds;
    parentId;
    parentLock;
    callback;
    env;
    cwd;
    isJob;
    foreground;
    shouldEcho = true;
    terminationNotifier = null;
    timestamp;
    children;
    constructor(id, cmd, worker, fds, parentId, parentLock, callback, env, cwd, isJob, foreground) {
        this.id = id;
        this.cmd = cmd;
        this.worker = worker;
        this.fds = fds;
        this.parentId = parentId;
        this.parentLock = parentLock;
        this.callback = callback;
        this.env = env;
        this.cwd = cwd;
        this.isJob = isJob;
        this.foreground = foreground;
        this.timestamp = Math.floor(new Date().getTime() / 1000);
        this.children = [];
    }
}
export default class ProcessManager {
    scriptName;
    filesystem;
    driverManager;
    processInfos;
    nextProcessId = 0;
    compiledModules = {};
    constructor(scriptName, filesystem, driverManager, processInfos = {}) {
        this.scriptName = scriptName;
        this.filesystem = filesystem;
        this.driverManager = driverManager;
        this.processInfos = processInfos;
    }
    // This method wraps syscallCallback with HtermDeviceDriver.wrapCallback method that
    // prints the error message to all terminals upon catching a exception so that user knows
    // what caused the kernel panic
    async syscallCallback(event, processManager) {
        if (this.driverManager !== undefined) {
            const driver = this.driverManager.getDriver(1 /* major.MAJ_HTERM */);
            if (driver !== undefined) {
                driver.wrapCallback(async () => {
                    await syscallCallback(event, processManager);
                });
                return;
            }
        }
        syscallCallback;
    }
    async spawnProcess(parentId, parentLock, command, fds, args, env, isJob, workingDir, foreground = null) {
        const id = this.nextProcessId;
        this.nextProcessId += 1;
        const worker = new Worker(this.scriptName, { type: "module" });
        if (foreground === null)
            foreground = this.processInfos[parentId].foreground;
        if (parentId !== null) {
            this.processInfos[parentId].children.push(id);
            if (parentLock !== null)
                this.processInfos[parentId].foreground = null;
        }
        this.processInfos[id] = new ProcessInfo(id, command, worker, fds, parentId, parentLock, this.syscallCallback, env, workingDir, isJob, foreground);
        worker.onmessage = (event) => this.syscallCallback(event, this);
        if (foreground !== null) {
            const __driver = this.driverManager.getDriver(foreground.maj);
            __driver.terminals[foreground.min].foregroundPid = id;
        }
        // save compiled module to cache
        // TODO: this will run into trouble if file is replaced after first usage (cached version will be invalid)
        try {
            if (!this.compiledModules[command]) {
                const { err, desc } = await this.filesystem.open(command, constants.WASI_LOOKUPFLAGS_SYMLINK_FOLLOW);
                if (err !== constants.WASI_ESUCCESS) {
                    console.error(`No such binary: ${command}`);
                    await this.terminateProcess(id, err);
                    return err;
                }
                this.compiledModules[command] = await WebAssembly.compile((await desc.arrayBuffer()).buffer);
            }
        }
        catch (e) {
            let errno;
            if (e.message ===
                "WebAssembly.compile(): BufferSource argument is empty") {
                errno = constants.WASI_ESUCCESS;
            }
            else {
                errno = constants.WASI_ENOEXEC;
            }
            await this.terminateProcess(id, errno);
            throw Error("invalid binary");
        }
        if (!isJob &&
            parentId != null &&
            this.processInfos[parentId].terminationNotifier !== null &&
            this.processInfos[parentId].terminationNotifier.obtainEvents(constants.WASI_EXT_EVENT_SIGINT) != constants.WASI_EXT_NO_EVENT) {
            this.terminateProcess(id, constants.EXIT_INTERRUPTED);
        }
        else {
            // TODO: pass module through SharedArrayBuffer to save on copying time (it seems to be a big bottleneck)
            this.processInfos[id].worker.postMessage([
                "start",
                this.compiledModules[command],
                id,
                args,
                env,
            ]);
        }
        return id;
    }
    async terminateProcess(id, exitNo = 0) {
        const process = this.processInfos[id];
        // close/flush all opened files to make sure written contents are saved to persistent storage
        this.processInfos[id].fds.tearDown();
        if (process.parentId !== null) {
            this.processInfos[this.processInfos[id].parentId].foreground =
                process.foreground;
            this.processInfos[process.parentId].children.splice(process.children.indexOf(id), 1);
            // Pass foreground process id to the terminal driver
            if (process.foreground !== null) {
                const __driver = this.driverManager.getDriver(process.foreground.maj);
                __driver.terminals[process.foreground.min].foregroundPid = process.parentId;
            }
        }
        process.worker.terminate();
        process.children.forEach((child) => this.terminateProcess(child, 128 + constants.WASI_SIGKILL));
        // notify parent that they can resume operation
        if (id !== 0 && process.parentLock != null) {
            Atomics.store(process.parentLock, 0, exitNo);
            Atomics.notify(process.parentLock, 0);
        }
        // remove process from process array
        delete this.processInfos[id];
    }
    publishEvent(events, pid) {
        // If sigint is published and target process doesn't override SIGINT, terminate process
        if (events & constants.WASI_EXT_EVENT_SIGINT &&
            !this.processInfos[pid].terminationNotifier) {
            this.terminateProcess(pid, 128 + constants.WASI_EXT_EVENT_SIGINT);
            return;
        }
        // events are stored only in contexts of event source descriptors
        // if a new event source is opened, it won't be able to read events
        // that happened in the past
        for (const descEntry of Object.values(this.processInfos[pid].fds.fdt)) {
            if (descEntry.desc instanceof EventSource) {
                descEntry.desc.sendEvents(events);
            }
        }
    }
    attachSigint(fd, pid) {
        const eventDesc = this.processInfos[pid].fds.getDesc(fd);
        if (eventDesc === undefined)
            return constants.WASI_EBADF;
        if (!(eventDesc instanceof EventSource))
            return constants.WASI_EINVAL;
        let stat;
        new Promise((resolve, reject) => {
            stat = eventDesc.makeNotifier({ resolve, reject });
            if (stat === constants.WASI_ESUCCESS)
                this.processInfos[pid].terminationNotifier = eventDesc;
        }).then((ev) => {
            if (this.processInfos[pid] !== undefined &&
                this.processInfos[pid].terminationNotifier === ev)
                this.processInfos[pid].terminationNotifier = null;
        });
        return stat;
    }
}
