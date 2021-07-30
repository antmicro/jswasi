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
		// t.io.print(data);
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
    let current_worker = 0;

    const worker_onmessage = (event) => {
        const [worker_id, action, data] = event.data;
        if (action === "buffer") {
            if (worker_id !== current_worker) {
                console.log(`WORKER ${worker_id} requested buffer, ignoring. (not ${current_worker})`);
                return;
            }
            const lck = new Int32Array(data, 0, 1);
            const len = new Int32Array(data, 4, 1);
            if (buffer.length !== 0) {
                console.log("got buffer request of len " + len[0] + ", notifying");
                const sbuf = new Uint8Array(data, 8, len[0]);
                len[0] = (buffer.length > len[0]) ? len[0] : buffer.length;
                console.log("current buffer is '" + buffer + "', copying len " + len[0]);
                for (let j = 0; j < len[0]; j++) {
                    sbuf[j] = buffer.charCodeAt(j);
                }
                buffer = buffer.slice(len[0]);
            } else {
                len[0] = 0;
            }
            lck[0] = 1; //current_worker + 1;
            Atomics.notify(lck, 0);
        } else if (action === "stdout") {
            // let output = new TextDecoder().decode(data).replace("\n", "\n\r");
            let output = data.replace("\n", "\n\r");
            terminal.io.print(output);
        } else if (action === "stderr") {
            console.log(`STDERR ${worker_id}: ${data}`);
        } else if (action === "console") {
            console.log("WORKER " + worker_id + ": " + data);
        } else if (action === "exit") {
            current_worker -= 1; // TODO: workers stack/tree
            console.log(`WORKER ${worker_id} exited with result code: ${data}`);
	    console.log(`Awaiting input from WORKER ${current_worker}`);
        } else if (action === "spawn") {
	    const args = event.data[3];
            const id = workers.length;
            workers.push({id: id, worker: new Worker('worker.js')});
            workers[id].worker.onmessage = worker_onmessage;
            workers[id].worker.postMessage(["start", `${data}.wasm`, id, args]);
            console.log("WORKER " + worker_id + " spawned: " + data);
            current_worker = id;
        }
    }

    workers[0].worker.onmessage = worker_onmessage;
    workers[0].worker.postMessage(["start", "shell.wasm", 0]);
}

window.onload = init_all;
