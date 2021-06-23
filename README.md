Run
```
cargo build --target wasm32-wasi
python -m http.server
```
and go to http://localhost:8000.

Cargo builds `wasm32-wasi` target to `target/wasm32-wasi/debug/msh.wasm`
There are `index.html` and `hterm-all.js` files in main folder 
that use the wasm module and provide the terminal.