const {
  Worker, isMainThread, parentPort, workerData
} = require('worker_threads');

if (process.argv.length < 3) {
  console.log("Not enough arguments");
  process.exit(1);
}

let debug = false;

let workers = [];
workers[0] = { id: 0, worker: new Worker('./worker.js') };
if (debug) workers[1] = { id: 1, worker: new Worker('./worker.js') };

let terminated = false;
let buffer = "";

let ev = (event) => {
            //connsole.log("on message: ", event);
            const action = event.data[1];
            if (action === "buffer") {
                const lck = new Int32Array(event.data[2], 0, 1);
                const len = new Int32Array(event.data[2], 4, 1);
                if (buffer.length != 0) {
                    if (debug) console.log("got buffer request of len "+len[0]+", notifying");
                    const sbuf = new Uint16Array(event.data[2], 8, len[0]);
                    len[0] = (buffer.length > len[0]) ? len[0] : buffer.length;
                    if (debug) console.log("current buffer is " + buffer + ", copying len " + len[0]);
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
                process.stdout.write(event.data[2]);
            } else if (action === "stderr") {
                process.stderr.write(event.data[2]);
            } else if (action === "exit") {
                if (debug) console.log("We got exit command, result = " + event.data[2]);
                workers[event.data[0]].worker.terminate();
                terminated = true;
            } else if (action === "console") {
                if (debug) console.log("WORKER "+event.data[0]+": " + event.data[2]);
            }
        }


workers[0].worker.on('message', ev);
if (debug) workers[1].worker.on('message', ev);

//myWorker.onmessage = ev;

if (debug) console.log('sending message!');
workers[0].worker.postMessage(["start", process.argv[2], 0]);
if (debug) workers[1].worker.postMessage(["start", process.argv[2], 1]);
if (debug) console.log('message sent!');

function heartbeat() {
     if (!debug) {
         while (1) {
             c = process.stdin.read(1);
             console.log(c);
         }
     }
     if (debug) console.log("bip");
     if (terminated) {
       if (debug) console.log("Thread finished.");
     } else {
         setTimeout(heartbeat, 2000);
     }
}

heartbeat();
