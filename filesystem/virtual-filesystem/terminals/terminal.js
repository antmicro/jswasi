import * as termios from "./termios.js";
import * as constants from "../../../constants.js";
export class AbstractTermiosTerminal {
    foregroundPid;
    bufRequestQueue;
    subs;
    termios;
    driverBuffer;
    driverBufferCursor;
    userBuffer;
    constructor(termios) {
        this.bufRequestQueue = [];
        this.subs = [];
        this.termios = termios;
        this.driverBuffer = "";
        this.driverBufferCursor = 0;
        this.userBuffer = "";
    }
    splitBuf(len) {
        let out = this.userBuffer.slice(0, len);
        this.userBuffer = this.userBuffer.slice(len);
        return out;
    }
    detectBreakCondition(data) {
        for (let i = 2; i < data.length; ++i) {
            if (data.charCodeAt(i) !== 0) {
                return i;
            }
        }
        return data.length;
    }
    stripOffBytes(data) {
        let stripped = "";
        for (let i = 0; i < data.length; ++i) {
            let c = data.charCodeAt(i);
            stripped += String.fromCharCode(c & 0x7f)[0];
        }
        return stripped;
    }
    pushDriverInputBuffer(data) {
        if ((this.termios.lFlag & termios.ECHO) !== 0) {
            this.printTerminal(data);
        }
        this.driverBuffer =
            this.driverBuffer.slice(0, this.driverBufferCursor) +
                data +
                this.driverBuffer.slice(this.driverBufferCursor);
        this.driverBufferCursor += data.length;
    }
    pushNLDriverInputBuffer() {
        this.driverBuffer += "\n";
        if ((this.termios.lFlag & termios.ICANON) !== 0) {
            if ((this.termios.lFlag & termios.ECHO) !== 0 ||
                (this.termios.lFlag & termios.ECHONL) !== 0) {
                this.printTerminal("\r\n");
            }
            this.flushDriverInputBuffer();
        }
    }
    flushDriverInputBuffer() {
        this.userBuffer += this.driverBuffer;
        this.driverBuffer = "";
        this.driverBufferCursor = 0;
    }
    resolveUserReadRequests() {
        if (this.userBuffer.length > 0) {
            // In case EOF arrives when line is not empty flush requests
            // until there are data in user buffer
            while (this.userBuffer.length > 0 && this.bufRequestQueue.length > 0) {
                let req = this.bufRequestQueue.shift();
                let buff = this.userBuffer.slice(0, req.len);
                this.userBuffer = this.userBuffer.slice(req.len);
                req.resolve({
                    err: constants.WASI_ESUCCESS,
                    buffer: new TextEncoder().encode(buff),
                });
            }
        }
        else {
            // Resolve all foreground process requests with empty buffers
            let foreground_reqs = this.bufRequestQueue.filter((req) => req.pid === this.foregroundPid);
            this.bufRequestQueue = this.bufRequestQueue.filter((req) => req.pid !== this.foregroundPid);
            foreground_reqs.forEach((req) => req.resolve({
                err: constants.WASI_ESUCCESS,
                buffer: new ArrayBuffer(0),
            }));
        }
    }
    processTerminalInput(processManager, data) {
        let iFlag = this.termios.iFlag;
        let cFlag = this.termios.cFlag;
        let lFlag = this.termios.lFlag;
        if ((cFlag & termios.CREAD) === 0) {
            // Discard input
            return;
        }
        if ((iFlag & termios.ISTRIP) !== 0) {
            data = this.stripOffBytes(data);
        }
        while (data.length > 0) {
            let code = data.charCodeAt(0);
            if (code === 0 && data.length > 1 && data.charCodeAt(1) === 0) {
                const breakOffset = this.detectBreakCondition(data);
                if ((iFlag & termios.IGNBRK) === 0) {
                    // Do not ignore break condition
                    if ((iFlag & termios.BRKINT) === 0) {
                        if ((iFlag & termios.PARMRK) === 0) {
                            this.driverBuffer += "\x00";
                        }
                        else {
                            this.driverBuffer += "\xFF\x00\x00";
                        }
                    }
                    else {
                        this.flushDriverInputBuffer();
                        // TODO: Send SIGINT to foreground process group
                    }
                }
                data = data.slice(breakOffset);
                continue;
            }
            switch (code) {
                // 0x0a - LN
                case 0x0a: {
                    if ((lFlag & termios.ICANON) !== 0) {
                        if ((iFlag & termios.INLCR) !== 0) {
                            if ((iFlag & termios.IGNCR) === 0) {
                                if ((iFlag & termios.ICRNL) !== 0) {
                                    this.pushNLDriverInputBuffer();
                                }
                                else {
                                    this.pushDriverInputBuffer("\r");
                                }
                            }
                        }
                        else {
                            this.pushNLDriverInputBuffer();
                        }
                    }
                    else {
                        this.pushNLDriverInputBuffer();
                    }
                    break;
                }
                // 0x0d - CR
                case 0x0d: {
                    if ((lFlag & termios.ICANON) !== 0) {
                        if ((iFlag & termios.IGNCR) === 0) {
                            if ((iFlag & termios.ICRNL) !== 0) {
                                this.pushNLDriverInputBuffer();
                            }
                            else {
                                this.pushDriverInputBuffer("\r");
                            }
                        }
                    }
                    else {
                        this.pushDriverInputBuffer("\r");
                    }
                    break;
                }
                // 0x11 - START, 0x13 - STOP
                case 0x11:
                case 0x13: {
                    if ((iFlag & termios.IXON) !== 0) {
                        // ignore for now...
                    }
                    else {
                        this.pushDriverInputBuffer(data[0]);
                    }
                    break;
                }
                // 0x03 - INTR, 0x1a - SUSP, 0x1c - QUIT
                case 0x03:
                case 0x1a:
                case 0x1c: {
                    if ((lFlag & termios.ISIG) !== 0) {
                        if (code === 0x03) {
                            if (this.foregroundPid !== null) {
                                processManager.publishEvent(constants.WASI_EXT_EVENT_SIGINT, this.foregroundPid);
                            }
                        }
                        // ingore 0x1a, 0x1c for now...
                    }
                    else {
                        this.pushDriverInputBuffer(data[0]);
                    }
                    break;
                }
                // EOT - end of transmission
                case 0x04: {
                    if ((lFlag & termios.ICANON) !== 0) {
                        this.flushDriverInputBuffer();
                        this.resolveUserReadRequests();
                    }
                    else {
                        this.pushDriverInputBuffer(data[0]);
                    }
                    break;
                }
                // KILL - remove line
                case 0x15: {
                    if ((lFlag & termios.ICANON) !== 0 && (lFlag & termios.ECHOK) !== 0) {
                        // Remove all characters from driver buffer to the left from the cursor
                        this.removeFromCursorToLeft(this.driverBufferCursor);
                    }
                    else {
                        this.pushDriverInputBuffer(data[0]);
                    }
                    break;
                }
                // DEL
                case 0x7f: {
                    if ((lFlag & termios.ICANON) !== 0 && (lFlag & termios.ECHOE) !== 0) {
                        this.removeFromCursorToLeft(1);
                    }
                    else {
                        this.pushDriverInputBuffer(data[0]);
                    }
                    break;
                }
                // Start of escape sequence
                case 0x1b: {
                    if ((lFlag & termios.ICANON) !== 0) {
                        if (data[1] === "[") {
                            switch (data[2]) {
                                // Move cursor right
                                case "C": {
                                    this.moveCursorRight(1);
                                    break;
                                }
                                // Move cursor left
                                case "D": {
                                    this.moveCursorLeft(1);
                                    break;
                                }
                                default: {
                                    break;
                                }
                            }
                            // ignore rest of CSIs, for now...
                            data = data.slice(3);
                            continue;
                        }
                        else {
                            // ignore, for now...
                            data = data.slice(2);
                            continue;
                        }
                    }
                    else {
                        this.pushDriverInputBuffer(data[0]);
                    }
                    break;
                }
                default: {
                    this.pushDriverInputBuffer(data[0]);
                    break;
                }
            }
            data = data.slice(1);
        }
        if ((lFlag & termios.ICANON) === 0) {
            this.flushDriverInputBuffer();
        }
        if (this.userBuffer.length > 0) {
            this.resolveUserReadRequests();
        }
        if (this.userBuffer.length > 0) {
            for (const sub of this.subs) {
                sub.resolve({
                    userdata: sub.userdata,
                    error: constants.WASI_ESUCCESS,
                    nbytes: BigInt(this.userBuffer.length),
                    eventType: constants.WASI_EVENTTYPE_FD_READ,
                });
            }
            this.subs.length = 0;
        }
    }
    dataForUser() {
        return this.userBuffer.length;
    }
    readToUser(len) {
        return new TextEncoder().encode(this.splitBuf(len));
    }
    sendTerminalOutput(data) {
        if ((this.termios.oFlag & termios.ONLCR) !== 0) {
            data = data.replaceAll("\n", "\r\n");
        }
        this.printTerminal(data);
        return data;
    }
}
