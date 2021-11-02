#! /usr/bin/bash

trap "kill 0" EXIT

cd dist
python3 ../custom_server.py $1 &
cd ..
tsc --watch

wait
