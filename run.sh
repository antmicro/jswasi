#! /usr/bin/bash

trap "kill 0" EXIT

cd output
python3 ../custom_server.py $1 &
cd ..
tsc --watch

wait
