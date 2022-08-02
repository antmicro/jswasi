# Installation

Make sure you have Rust and `wasm32-wasi` target installed, as well as node.
Otherwise, run:

```
# install rustc, rustup, cargo
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# install wasm32-wasi target
rustup target add wasm32-wasi

# install newest node via nvm
url -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install node
```

Once you're done, make sure you're in the project root directory and run once:

```
npm install
./setup.sh build
```

Note: This is not the complete build and needs to be updated. The CI works so it should be a reference. Possibly we can use `tuttest` to keep the CI and README in sync.

## Local run

Now if you want to run the project at a specific port run:

```
./setup start 8000
```

and go to http://localhost:8000 (make sure you have localhost mapped to 0.0.0.0 in /etc/hosts).

## Running tests

Install prerequisites:

```
pip install robotframework PexpectLibrary
```

Run:

```
export PATH=$PATH:$(pwd)/wash/target/release/
cd tests/robot
robot --variable platform:native -i native test-shell.robot
```

## Embedding

If you only want to embed wash run:

```
./setup.sh embedded
```

All necessary files will be generated to `dist` directory.
