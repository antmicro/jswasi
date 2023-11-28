# JSWASI

Copyright (c) 2022-2023 [Antmicro](https://www.antmicro.com)

This project is a `wasi` browser runtime that supports [wasi_ext_lib](https://github.com/antmicro/wasi_ext_lib) api.
`JSWASI` is just a _kernel_ -- complete applications that can be served or embedded can be created by providing the root filesystem with `wasm32-wasi` executables or building the project in standalone mode which serves minimal programs for command line usage.

# Building

To build the project, you're going to need `nodejs` installed (preferably `v18`).
The kernel can be built in two modes:

- Standalone mode (default): `make standalone` - build kernel and provide it with the default index, init system and minimal userspace applications
- Embed mode: `make embed` - build just the kernel

Both of these commands produce the output in `dist/` directory

# Running

The project can be run in the standalone mode by serving the `dist/` directory with the HTTP server of your choice that supports [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS).
In this mode, additional executables will be served:

- [wash](https://github.com/antmicro/wash) - shell
- [coreutils](https://github.com/antmicro/coreutils) - basic tools like `ls` or `cat`
- [wasibox](https://github.com/antmicro/wasibox) - basic tools utilizing [wasi_ext_lib](https://github.com/antmicro/wasi_ext_lib), extended WASI standard

As for the embed mode, the `dist/terminal.js` module exposes two functions that allow to control the kernel:

- `init`: this function accepts one parameter - an [hterm](https://chromium.googlesource.com/apps/libapps/+/HEAD/hterm) object that is going to serve a purpose of a terminal for interacting with the init system. Note that efforts to make the `init` function independent from `hterm` are in progress
- `tearDown`: this function accepts one parameter - a print feedback callback. This function can be used to clean all persistent elements of the application without interracting with the kernel in case the kernel enters an unrecoverable state.

# Configuration

The kernel supports a basic configuration that allows to configure the root filesystem and the init system:

- `init`: a list of arguments to execute the init system
- `fsType`: the type of the filesystem to mount at `/`
- `opts`: options specific to the chosen filesystem.

To review available filesystems, read our [documentation](https://antmicro.com). TODO
An example of such configuration file is avaliable in `src/assets/config.json` in the project source tree.

The configuration is read from the `fsa0/config.json` file in the device filesystem.
If no such file is in this location, the default configuration from `dist/resources/config.json` is going to be saved there.

More configuration options like choosing the init system or root filesystem image are going to be implemented soon.

# Testing

This repository contains two sets of tests: unit tests and syscalls tests.
The first set can be run using `npm run test:unit` command and it tests the integrity of internal kernel structures.
The latter is an userspace rust program that invokes raw syscalls to check whether the kernel responds to them correctly.
Note that for syscalls tests executable to work properly, it needs to be compiled with a custom rust toolchain that implements `canonicalize`.
For instructions on how to build such toolchain, see [wasi_ext_lib](https://github.com/antmicro/wasi_ext_lib#build).
These tests can be ran by using the executable as an init system to the kernel or by just executing it using a shell.
