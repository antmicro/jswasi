import {hterm, lib} from "./hterm-all.js";

let buffer = "";
let args = [];
let env = {};

async function init_all() {
    // If you are a cross-browser web app and want to use window.localStorage.
    hterm.defaultStorage = new lib.Storage.Local();

    function setupHterm() {
        // profileId is the name of the terminal profile to load, or "default" if
        // not specified.  If you're using one of the persistent storage
        // implementations then this will scope all preferences read/writes to this
        // name.
        const t = new hterm.Terminal("profile-id");

        t.onTerminalReady = function () {
            // Create a new terminal IO object and give it the foreground.
            // (The default IO object just prints warning messages about unhandled
            // things to the the JS console.)
            const io = t.io.push();

            io.onVTKeystroke = io.sendString = (data) => {
                let code = data.charCodeAt(0);
                console.log(data, code);
                // if (code === 13) {
                //     data = String.fromCharCode(10);
                //     console.log("turned to 10");
                // }
                // if (code === 10) {
                //     data = String.fromCharCode(13);
                //     console.log("turned to 13");
                // }
                buffer = buffer + data;
            };

            io.onTerminalResize = (columns, rows) => {
                // React to size changes here.
                // Secure Shell pokes at NaCl, which eventually results in
                // some ioctls on the host.
            };

            // You can call io.push() to foreground a fresh io context, which can
            // be uses to give control of the terminal to something else.  When that
            // thing is complete, should call io.pop() to restore control to the
            // previous io object.
        };

        t.decorate(document.querySelector('#terminal'));
        t.installKeyboard();

        return t;
    }

    // This will be whatever normal entry/initialization point your project uses.
    await lib.init();
    const terminal = setupHterm();

    let workers = [];
    workers[0] = {id: 0, worker: new Worker('worker.js')};

    const worker_onmessage = (event) => {
        const action = event.data[1];
        if (action === "buffer") {
            const lck = new Int32Array(event.data[2], 0, 1);
            const len = new Int32Array(event.data[2], 4, 1);
            if (buffer.length !== 0) {
                console.log("got buffer request of len " + len[0] + ", notifying");
                const sbuf = new Uint16Array(event.data[2], 8, len[0]);
                len[0] = (buffer.length > len[0]) ? len[0] : buffer.length;
                console.log("current buffer is '" + buffer + "', copying len " + len[0]);
                for (let j = 0; j < len[0]; j++) {
                    sbuf[j] = buffer.charCodeAt(j);
                }
                buffer = buffer.slice(len[0], buffer.length);
            } else {
                len[0] = 0;
            }
            lck[0] = 1;
            Atomics.notify(lck, 0);
        } else if (action === "stdout") {
            let output = event.data[2].replace("\n", "\n\r");
            terminal.io.print(output);
        } else if (action === "stderr") {
            console.log(`STDERR: ${event.data[2]}`);
        } else if (action === "console") {
            console.log("WORKER " + event.data[0] + ": " + event.data[2]);
        } else if (action === "exit") {
            console.log("WORKER " + event.data[0] + " exited with result code: " + event.data[2]);
        } else if (action === "env") {
            console.log("WORKER " + event.data[0] + " added env variable: " + event.data[2]);
            // TODO
            // let key, value = event.data[2].split(",");
            // env[key] = value;
        } else if (action === "arg") {
            console.log("WORKER " + event.data[0] + " added arg: " + event.data[2]);
            args.append(event.data[2]);
        } else if (action === "spawn") {
            const id = workers.length;
            workers.push({id: id, worker: new Worker('worker.js')});
            workers[id].worker.onmessage = worker_onmessage;
            workers[id].worker.postMessage(["start", event.data[2]+".wasm", id]);
            console.log("WORKER " + event.data[0] + " spawned: " + event.data[2]);
        }
    }

    workers[0].worker.onmessage = worker_onmessage;
    workers[0].worker.postMessage(["start", "shell.wasm", 0]);
}

window.onload = init_all;