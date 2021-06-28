release:
	mkdir -p output
	cargo build --target wasm32-wasi --release
	cp target/wasm32-wasi/release/msh.wasm index.html index.js hterm-all.js output

serve:
	mkdir -p output
	cargo build --target wasm32-wasi --release
	cp target/wasm32-wasi/release/msh.wasm index.html index.js  hterm-all.js output
	python3 -m http.server --dir output