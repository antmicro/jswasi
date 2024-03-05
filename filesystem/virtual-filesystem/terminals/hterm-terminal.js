// import * as termios from "./termios.js";
import { AbstractTermiosTerminal, } from "./terminal.js";
import * as termios from "./termios.js";
import { DEFAULT_ENV, DEFAULT_WORK_DIR, DescriptorEntry, FdTable, } from "../../../process-manager.js";
import * as constants from "../../../constants.js";
import { getFilesystem } from "../../top-level-fs.js";
import { AbstractVirtualDeviceDescriptor } from "./../device-filesystem.js";
const DEFAULT_HTERM_TERMIOS = {
    iFlag: termios.ICRNL | termios.IXON | termios.IXOFF,
    oFlag: termios.OPOST | termios.ONLCR,
    cFlag: termios.CS8 | termios.CREAD,
    lFlag: termios.ECHOK |
        termios.ECHOE |
        termios.ECHO |
        termios.IEXTEN |
        termios.ICANON |
        termios.ISIG,
};
class Hterm extends AbstractTermiosTerminal {
    terminal;
    constructor(terminal) {
        super({ ...DEFAULT_HTERM_TERMIOS });
        this.terminal = terminal;
        this.terminal.setInsertMode(true);
    }
    printTerminal(data) {
        this.terminal.io.print(data);
    }
    moveCursorRight(shift) {
        let __shift = shift >= this.driverBuffer.length - this.driverBufferCursor
            ? this.driverBuffer.length - this.driverBufferCursor
            : shift;
        if (__shift === 0)
            return;
        // CSI Ps C  Cursor Forward Ps Times (default = 1) (CUF)
        this.terminal.io.print(`\x1b[${__shift}C`);
        this.driverBufferCursor += __shift;
    }
    moveCursorLeft(shift) {
        let __shift = shift >= this.driverBufferCursor ? this.driverBufferCursor : shift;
        if (__shift === 0)
            return;
        // CSI Ps D  Cursor Backward Ps Times (default = 1) (CUB)
        this.terminal.io.print(`\x1b[${__shift}D`);
        this.driverBufferCursor -= __shift;
    }
    removeFromCursorToLeft(toRemove) {
        let __toRemove = toRemove >= this.driverBufferCursor ? this.driverBufferCursor : toRemove;
        if (__toRemove === 0)
            return;
        this.terminal.cursorLeft(__toRemove);
        // CSI Ps P  Delete Ps Character(s) (default = 1) (DCH)
        this.terminal.io.print(`\x1b[${__toRemove}P`);
        this.driverBuffer =
            this.driverBuffer.slice(0, this.driverBufferCursor - __toRemove) +
                this.driverBuffer.slice(this.driverBufferCursor);
        this.driverBufferCursor -= __toRemove;
    }
    getScreenSize() {
        let scrollPort = this.terminal.scrollPort_.getScreenSize();
        return {
            cellsWidth: this.terminal.screenSize.width,
            cellsHeight: this.terminal.screenSize.height,
            pxWidth: scrollPort.width,
            pxHeight: scrollPort.height,
        };
    }
}
export class HtermDeviceDriver {
    maxTty;
    freedTerminals;
    processManager;
    terminals;
    async initDriver(args) {
        const __args = args;
        this.processManager = __args.processManager;
        this.terminals = [];
        this.freedTerminals = [];
        this.maxTty = 0;
        return constants.WASI_ESUCCESS;
    }
    __initFsaDropImport(min, terminalContentWindow, notifyDroppedFileSaved, processManager) {
        terminalContentWindow.addEventListener("dragover", function handleDragOver(evt) {
            evt.stopPropagation();
            evt.preventDefault();
            evt.dataTransfer.dropEffect = "copy";
        }, false);
        const __this = this;
        terminalContentWindow.addEventListener("drop", async function (evt) {
            evt.stopPropagation();
            evt.preventDefault();
            const pwd = processManager.processInfos[__this.terminals[min].foregroundPid].cwd;
            await Promise.all((Object.values(evt.dataTransfer.items) || []).map(async (item) => {
                // Caused by invalid types, can be fixed by using @types/wicg-file-system-access
                // @ts-ignore
                let handle = (await item.getAsFileSystemHandle());
                let path = `${pwd}/${handle.name}`;
                if (handle.kind === "file") {
                    const stream = (await handle.getFile()).stream();
                    const result = await processManager.filesystem.open(path, constants.WASI_O_CREAT);
                    if (result.err !== constants.WASI_ESUCCESS) {
                        return;
                    }
                    const { err: __err, stream: writableStream } = await result.desc.writableStream();
                    return new Promise(async (resolve) => {
                        // @ts-ignore
                        await stream.pipeTo(writableStream);
                        if (notifyDroppedFileSaved)
                            notifyDroppedFileSaved(path, handle.name);
                        resolve();
                    });
                }
                else if (handle.kind === "directory") {
                    // TODO: use some kind of uuid in mount point names
                    const tmp_mount = `/tmp/temp_mount_${handle.name}`;
                    await processManager.filesystem.createDir(tmp_mount);
                    let { err, filesystem } = await getFilesystem("fsa", {
                        dir: handle,
                        keepMetadata: false,
                    });
                    if (err !== constants.WASI_ESUCCESS) {
                        return;
                    }
                    await processManager.filesystem.addMountFs(tmp_mount, filesystem);
                    // this process is spawned as a child of init, this isn't very elegant
                    await processManager.spawnProcess(0, // parent_id
                    null, // parent_lock
                    "/usr/bin/wash", new FdTable({
                        // TODO: replace with /dev/null once it is implemented
                        0: undefined,
                        1: undefined,
                        2: undefined,
                        3: new DescriptorEntry((await processManager.filesystem.open("/")).desc),
                    }), [
                        "/usr/bin/wash",
                        "-c",
                        `cp -r ${tmp_mount} ${path} ; umount ${tmp_mount}`,
                    ], DEFAULT_ENV, false, DEFAULT_WORK_DIR);
                }
            }));
        });
    }
    __initTerminal(terminal) {
        const __hterm = new Hterm(terminal);
        __hterm.terminal.installKeyboard();
        __hterm.terminal.keyboard.bindings.addBindings({
            "Ctrl-R": "PASS",
        });
        const onTerminalInput = (data) => {
            __hterm.processTerminalInput(this.processManager, data);
        };
        const io = __hterm.terminal.io.push();
        io.onVTKeystroke = onTerminalInput;
        io.sendString = onTerminalInput;
        // TODO: maybe save all output and rewrite it on adjusted size?
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        io.onTerminalResize = (_columns, _rows) => {
            if (__hterm.foregroundPid !== null)
                this.processManager.publishEvent(constants.WASI_EXT_EVENT_WINCH, __hterm.foregroundPid);
        };
        return __hterm;
    }
    async initDevice(_min, args) {
        const __args = args;
        let __ttyMin = this.freedTerminals.pop();
        if (!__ttyMin) {
            __ttyMin = this.maxTty++;
        }
        const __term = this.__initTerminal(__args.terminal);
        this.terminals[__ttyMin] = __term;
        this.__initFsaDropImport(__ttyMin, __args.terminal.div_.getElementsByTagName("iframe")[0].contentWindow, () => { }, this.processManager);
        return constants.WASI_ESUCCESS;
    }
    async teardownDevice(min) {
        if (this.terminals[min]) {
            delete this.terminals[min];
            this.freedTerminals.push(min);
            return constants.WASI_ESUCCESS;
        }
        else {
            return constants.WASI_ENOENT;
        }
    }
    async teardownDriver() {
        return constants.WASI_ESUCCESS;
    }
    async getDesc(min, fs_flags, fs_rights_base, fs_rights_inheriting, ino) {
        const __term = this.terminals[min];
        if (__term === undefined) {
            return {
                err: constants.WASI_ENODEV,
                desc: undefined,
            };
        }
        return {
            err: constants.WASI_ESUCCESS,
            desc: new VirtualHtermDescriptor(fs_flags, fs_rights_base, fs_rights_inheriting, ino, this.terminals[min]),
        };
    }
    // Auxiliary function to print uncaught exceptions to all terminals
    async wrapCallback(callback) {
        try {
            await callback();
        }
        catch (e) {
            Object.values(this.terminals).forEach((terminal) => {
                terminal.terminal.io.println(`[ERROR] Unrecoverable kernel error: ${e}`);
            });
            throw e;
        }
    }
}
class VirtualHtermDescriptor extends AbstractVirtualDeviceDescriptor {
    hterm;
    constructor(fs_flags, fs_rights_base, fs_rights_inheriting, ino, hterm) {
        super(fs_flags, fs_rights_base, fs_rights_inheriting, ino);
        this.hterm = hterm;
    }
    isatty() {
        return true;
    }
    async write(buffer) {
        const data = this.hterm.sendTerminalOutput(new TextDecoder().decode(buffer));
        if (window.stdoutAttached) {
            window.buffer += data;
        }
        return { err: constants.WASI_ESUCCESS, written: BigInt(buffer.byteLength) };
    }
    async read(len, workerId) {
        if (this.hterm.dataForUser() > 0) {
            return {
                err: constants.WASI_ESUCCESS,
                buffer: this.hterm.readToUser(len),
            };
        }
        else if (this.fdstat.fs_flags & constants.WASI_FDFLAG_NONBLOCK) {
            return {
                err: constants.WASI_ESUCCESS,
                buffer: new ArrayBuffer(0),
            };
        }
        else {
            // Return custom promise which is resolved in onTerminalInput hterm callback
            return new Promise((resolve) => {
                this.hterm.bufRequestQueue.push({
                    len,
                    pid: workerId,
                    resolve,
                });
            });
        }
    }
    async ioctl(request, buf) {
        let err = constants.WASI_ENOBUFS;
        switch (request) {
            case 1 /* ioctlRequests.TCGETS */: {
                if (buf.byteLength < 16)
                    break;
                const __buf = new Int32Array(buf.buffer, buf.byteOffset);
                __buf[0] = this.hterm.termios.iFlag;
                __buf[1] = this.hterm.termios.oFlag;
                __buf[2] = this.hterm.termios.cFlag;
                __buf[3] = this.hterm.termios.lFlag;
                err = constants.WASI_ESUCCESS;
                break;
            }
            case 2 /* ioctlRequests.TCSETS */: {
                if (buf.byteLength < 16)
                    break;
                const __buf = new Int32Array(buf.buffer, buf.byteOffset);
                this.hterm.termios.iFlag = __buf[0];
                this.hterm.termios.oFlag = __buf[1];
                this.hterm.termios.cFlag = __buf[2];
                this.hterm.termios.lFlag = __buf[3];
                err = constants.WASI_ESUCCESS;
                break;
            }
            case 19 /* ioctlRequests.TIOCGWINSZ */: {
                if (buf.byteLength < 8)
                    break;
                const winsize = await this.hterm.getScreenSize();
                const __buf = new Uint16Array(buf.buffer, buf.byteOffset);
                __buf[0] = winsize.cellsHeight;
                __buf[1] = winsize.cellsWidth;
                __buf[2] = winsize.pxWidth;
                __buf[3] = winsize.pxHeight;
                err = constants.WASI_ESUCCESS;
                break;
            }
            default: {
                if (1 /* ioctlRequests.TCGETS */ <= request &&
                    request <= 96 /* ioctlRequests.FIOQSIZE */ &&
                    2147767344 /* ioctlRequests.TIOCGPTN */ <= request &&
                    request <= 2147767360 /* ioctlRequests.TIOCGEXCL */ &&
                    35073 /* ioctlRequests.FIOSETOWN */ <= request &&
                    request <= 35079 /* ioctlRequests.SIOCGSTAMPNS */) {
                    err = constants.WASI_ENOTSUP;
                }
                else {
                    err = constants.WASI_EINVAL;
                }
                break;
            }
        }
        return err;
    }
    addPollSub(userdata, eventType, workerId) {
        switch (eventType) {
            case constants.WASI_EVENTTYPE_FD_WRITE: {
                return Promise.resolve({
                    userdata,
                    error: constants.WASI_ESUCCESS,
                    eventType,
                    nbytes: 0n,
                });
            }
            case constants.WASI_EVENTTYPE_FD_READ: {
                if (this.hterm.dataForUser() === 0) {
                    return new Promise((resolve) => {
                        this.hterm.subs.push({
                            pid: workerId,
                            userdata,
                            tag: eventType,
                            resolve,
                        });
                    });
                }
                return Promise.resolve({
                    userdata,
                    error: constants.WASI_ESUCCESS,
                    eventType,
                    nbytes: BigInt(this.hterm.dataForUser()),
                });
            }
            default: {
                return Promise.resolve({
                    userdata,
                    error: constants.WASI_EINVAL,
                    eventType: constants.WASI_EXT_NO_EVENT,
                    nbytes: 0n,
                });
            }
        }
    }
}
