Run
```
make # builds wasm binary and copies necesssary files to `output` directory
python3 -m http.server 8000 --dir output # or use any static server you like
```
and go to http://localhost:8000.
