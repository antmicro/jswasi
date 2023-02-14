# Rust Shell

Copyright (c) 2022-2023 [Antmicro](https://www.antmicro.com)

This project is a `wasi` browser runtime that supports [wasi_ext_lib](https://github.com/antmicro/wasi_ext_lib) api.
Along with [wash](https://github.com/antmicro/wash) shell and some terminal apps, it tries to mimic a linux terminal experience.

# Dependencies

Make sure you have Rust and `cargo` installed, as well as node.

To install rust, you can use the following commands:

```
# install rustc, rustup, cargo
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh # proceed with defaults here
source $HOME/.cargo/env
```

To install node, you can use the following commands:

```
# install newest node via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install node
```

# Installation

To build the project use:

```
npm install
npm run build
```

This will package all necessary files in `dist/` directory.

# Running

Once the project is built, it can be ran using:

```
npm run start
```

This will setup a `http` server that listens on `8000` port.
To choose a different port, you can use:

```
PORT=<port> npm run start
```

# Running tests

`rust-shell` uses `robot framework` and `pexpect` library for organizing a wide variety of end-to-end tests.
Install dependencies (you need `python3` and `pip3` installed for that):

```
pip3 install robotframework PexpectLibrary
```

To run tests against the browser runtime use:

```
npm run test
```
