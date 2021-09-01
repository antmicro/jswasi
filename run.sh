#! /usr/bin/bash

trap "kill 0" EXIT

cd output
python3 ../custom_server.py &
cd ..
tsc --watch

wait
