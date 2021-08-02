Run
```
make # builds wasm binary and copies necesssary files to `output` directory

wget https://registry-cdn.wapm.io/contents/_/duktape/0.0.3/build/duk.wasm
wget https://registry-cdn.wapm.io/contents/_/cowsay/0.2.0/target/wasm32-wasi/release/cowsay.wasm
wget https://registry-cdn.wapm.io/contents/adamz/quickjs/0.20210327.0/build/qjs.wasm
wget https://registry-cdn.wapm.io/contents/_/rustpython/0.1.3/target/wasm32-wasi/release/rustpython.wasm
mv *.wasm output

python3 -m http.server 8000 --dir output # or use any static server you like
```
and go to http://localhost:8000.
