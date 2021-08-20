Run

```
make # builds wasm binary and copies necesssary files to `output` directory

wget -P output https://registry-cdn.wapm.io/contents/_/duktape/0.0.3/build/duk.wasm
wget -P output https://registry-cdn.wapm.io/contents/_/cowsay/0.2.0/target/wasm32-wasi/release/cowsay.wasm
wget -P output https://registry-cdn.wapm.io/contents/adamz/quickjs/0.20210327.0/build/qjs.wasm
wget -P output https://registry-cdn.wapm.io/contents/_/rustpython/0.1.3/target/wasm32-wasi/release/rustpython.wasm
wget -P output https://registry-cdn.wapm.io/contents/_/coreutils/0.0.1/target/wasm32-wasi/release/uutils.wasm

cd output
python3 ../custom_server.py // must use custom server to add headers required by usage of SharedArrayBuffer
```

and go to http://localhost:8000.

If you only want to embed rust-shell run

```
make embedded # builds wasm binary and copies necesssary files to `output` directory

wget -P output https://registry-cdn.wapm.io/contents/_/duktape/0.0.3/build/duk.wasm
wget -P output https://registry-cdn.wapm.io/contents/_/cowsay/0.2.0/target/wasm32-wasi/release/cowsay.wasm
wget -P output https://registry-cdn.wapm.io/contents/adamz/quickjs/0.20210327.0/build/qjs.wasm
wget -P output https://registry-cdn.wapm.io/contents/_/rustpython/0.1.3/target/wasm32-wasi/release/rustpython.wasm
wget https://github.com/GoogleChromeLabs/wasi-fs-access/raw/main/uutils.async.wasm -O output/uutils.wasm
```
