const {
  Worker, isMainThread, parentPort, workerData
} = require('worker_threads');

if (process.argv.length < 3) {
  console.log("Not enough arguments");
  process.exit(1);
}

let myWorker = new Worker('./index.js');

let terminated = false;

let ev = (event) => {
            //connsole.log("on message: ", event);
            const action = event.data[0];
            console.log("action = ", action);
            if (action === "buffer") {
                const lck = new Int32Array(event.data[1], 0, 1);
                const len = new Int32Array(event.data[1], 4, 1);
                if (buffer.length != 0) {
                    console.log("got buffer request of len "+len[0]+", notifying");
                    const sbuf = new Uint16Array(event.data[1], 8, len[0]);
                    len[0] = (buffer.length > len[0]) ? len[0] : buffer.length;
                    console.log("current buffer is " + buffer + ", copying len " + len[0]);
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
                console.log(event.data[1]);
            } else if (action === "stderr") {
                console.log(event.data[1]);
            } else if (action === "exit") {
                console.log("We got exit command");
                myWorker.terminate();
                terminated = true;
            }
        }


myWorker.on('message', ev);
//myWorker.onmessage = ev;

console.log('sending message!');
myWorker.postMessage(["start", process.argv[2]]);
console.log('message sent!');

function heartbeat() {
     console.log("bip");
     if (terminated) {
       console.log("Thread finished.");
     } else {
         setTimeout(heartbeat, 2000);
     }
}

heartbeat();
