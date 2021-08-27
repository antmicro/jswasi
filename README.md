Run

```
# CORS Anywhere server fixes policy that disallows using above headers with cross-origin fetch requests
git clone https://github.com/Rob--W/cors-anywhere.git 
cd cors-anywhere
npm install
PORT=8001 node server.js &

make # builds wasm binary and copies necesssary files to `output` directory
cd output
python3 ../custom_server.py // must use custom server to add headers required by usage of SharedArrayBuffer
```

and go to http://localhost:8000.

If you only want to embed rust-shell run

```
make embedded # builds wasm binary and copies necesssary files to `output` directory
```
