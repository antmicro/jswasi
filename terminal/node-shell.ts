import { Worker } from "worker_threads";

import * as constants from "./constants.js";
// @ts-ignore
import { WorkerTable } from "./worker-table.mjs";
import { OpenFile, OpenDirectory } from "./node-fs.js";
import { on_worker_message } from "./worker-message.js";

const debug = true;

if (!debug) {
  console.log = function () {};
}

function receive_callback(output) {
  process.stdout.write(output);
}

if (process.argv.length < 3) {
  console.log("Not enough arguments");
  process.exit(1);
}

const workerTable = new WorkerTable(
  "./worker.mjs",
  receive_callback,
  new OpenDirectory("/", null),
  true
);

workerTable.spawnWorker(
  null, // parent_id
  null, // parent_lock
  on_worker_message
);
workerTable.postMessage(0, [
  "start",
  process.argv[2],
  0,
  process.argv.slice(2),
  {
    RUST_BACKTRACE: "full",
    PATH: "/usr/bin:/usr/local/bin",
    PWD: "/",
  },
]);

function uart_loop() {
  if (workerTable.currentWorker == null) return;
  while (1) {
    const data = process.stdin.read(1);
    if (data != null) {
      workerTable.push_to_buffer(data);
    } else {
      setTimeout(uart_loop, 100);
      return;
    }
  }
}

uart_loop();
