#! /usr/bin/bash

trap "kill 0" EXIT

cd ../cors-anywhere
PORT=8001 node server.js &
cd ../rust-shell/output
python3 ../custom_server.py &
cd ..
tsc --watch

wait
