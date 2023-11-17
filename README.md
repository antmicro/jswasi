# JSWASI

Copyright (c) 2022-2023 [Antmicro](https://www.antmicro.com)

This project is a `wasi` browser runtime that supports [wasi_ext_lib](https://github.com/antmicro/wasi_ext_lib) api.
`JSWASI` is just a _kernel_, complete applications that can be served or embedded, can be build using [jswasi-rootfs](https://github.com/antmicro/wasi_ext_lib) repository.

# Building

To build the project, you're going to need `nodejs` installed (preferably `v18`).
Before building the project, don't forget to install `npm` dependencies:

```
npm install
```

The kernel can be built in two modes:

- Standalone mode: `make build` - build kernel and provide it with default index and init system
- Embed mode: `make embed` - build just the kernel

Both of these commands produce the output in `dist/` directory

# Running

The project can be ran in the standalone mode by serving the `dist/` directory with a http server of your choice. Note that this mode is not going to work without including some essential binaries.
We are working on making the kernel more independent and flexible so that it is not necessary, fixes should be ready soon.

As for the embed mode, the `dist/terminal.js` exposes two functions that allow to controll the kernel:

- `init`: this function accepts one parameter - a hterm object that is going to serve a purpose of a terminal for interacting with the init system. Note that efforts to make the `init` function independent from `hterm` are in progress
- `tearDown`: this function accepts one parameter - a print feedback callback. This function can be used to clean all persistent elements of the application without interracting with the kernel in case the kernel enters an unrecoverable state.

# Configuration

The kernel supports a basic configuration that allows to configure the root filesystem type:

- `fsType`: type of the filesystem to mount at `/`
- `opts`: options specific to the chosen filesystem.

To review available filesystems, read our [documentation](https://antmicro.com) TODO

The configuration is read from the `fsa0/mounts.json` file in the device filesystem.
If no such file is in this location, the default configuration from `dist/resources/mounts.json` is going to be saved there.

More configuration options like choosing the init system or root filesystem image are going to be implemented soon.

# Testing

This repository contains two sets of tests: unit tests and syscalls tests.
The first set can be ran using `npm run test:unit` command and it tests the integrity of internal kernel structures.
The latter is a userspace rust program that invokes raw syscalls to check whether the kernel responds to them correctly.
These tests can be ran by using the executable as an init system to the kernel or by just executing it using the kernel.
