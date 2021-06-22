You must have `wasm-pack` installed (curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh, I will provide Dockerfile with it in short future).

Run
```
wasm-pack build --target web
python -m http.server
```
and go to http://localhost:8000.

`wasm-pack` builds wasm file and js bindings to `/pkg` folder.
There are `index.html` and `hterm-all.js` files in main folder that provide the terminal.