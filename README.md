# jswasi

Copyright (c) 2022-2024 [Antmicro](https://www.antmicro.com)

This project is a `wasi` browser runtime that supports [wasi_ext_lib](https://github.com/antmicro/wasi_ext_lib) api.
`JSWASI` is just a _kernel_ -- complete applications that can be served or embedded can be created by providing a root filesystem with `wasm32-wasi` executables and configurations.

# Building

To build the project, you're going to need to have `typescript` installed.
On Debian-like distributions it is as simple as running `apt install node-typescript`.
The project can be built in two modes:

- Standalone mode (default): `make standalone` - build the kernel and provide it with a kernel config and a default index with an in-browser terminal emulator that can be used to interface with the app
- Embed mode: `make embed` - build just the kernel

Both of these commands produce the output in `dist/` directory.

There is also a `MINIFY` variable which can be set to `1` in the `make` invocation to indicate that the runtime should be built into a single `jswasi.js` script.
To build the project this way, you also need to have `esbuild` installed.
On Debian-like distributions you can install it by running `apt install esbuild`.
Note that the minified version of the project is a _script_ rather than a _module_.

# Running

The project can be run in the standalone mode by serving the `dist/` directory with an HTTP server of your choice.
The default kernel config uses rootfs archives built using [jswasi-rootfs](https://github.com/antmicro/jswasi-rootfs).
This archive contains some essential executables like:

- [wash](https://github.com/antmicro/wash) - shell
- [coreutils](https://github.com/antmicro/coreutils) - basic tools like `ls` or `cat`
- [wasibox](https://github.com/antmicro/wasibox) - basic tools utilizing [wasi_ext_lib](https://github.com/antmicro/wasi_ext_lib), extended WASI standard

as well as some additional programs like:

- [ox](https://github.com/antmicro/ox) - a minimal text editor
- [space-invaders](https://github.com/mia1024/space-invaders/) - a demo terminal space invaders game
- [python](https://github.com/python/cpython) - a Python interpreter (built using [python-wasi](https://github.com/antmicro/python-wasi))

As for the embed mode, the `dist/jswasi.js` module exposes two functions that allow to control the kernel:

- `init`: this function accepts one parameter - an [hterm](https://chromium.googlesource.com/apps/libapps/+/HEAD/hterm) object that is going to serve a purpose of a terminal for interacting with the init system. Note that efforts to make the `init` function independent from `hterm` are in progress
- `tearDown`: this function accepts one parameter - a print feedback callback. This function can be used to clean all persistent elements of the application without interracting with the kernel in case the kernel enters an unrecoverable state.

In the minified mode, these functions are defined as `window` object properties and are called `jswasiInit` and `jswasiTeardown` instead.

# Configuration

The kernel supports a basic configuration that allows to configure the root filesystem and the init system:

- `init`: a list of arguments to execute the init system
- `rootfs`: the url of the rootfs archive to use
- `fsType`: the type of the filesystem to mount at `/`
- `opts`: options specific to the chosen filesystem.

An example of such configuration file is avaliable in `src/assets/config.json` in the project source tree.

The configuration is read from the `fsa0/config.json` file in the device filesystem.
If no such file is in this location, the default configuration from `dist/resources/config.json` is going to be saved there.

## Filesystems

### Virtual filesystem

Virtual filesystem (`vfs`) contained in memory and is backed by a fork of [js-virtualfs](https://github.com/antmicro/js-virtualfs)
By default, it is mounted on `/tmp`.
Note that currently, this filesystem doesn't work on Firefox.
There is an ongoing effort to fix that.
This filesystem doesn't support any configuration yet.

### Fsa filesystem

Fsa filesystem (`fsa`) is backed by the [Filesystem API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) and is persistent.
The default kernel configuration mounts this filesystem type on `/`.
The following options are available:

- `name`: Label of the filesystem _partition_. For instance, this could be `fsa0` for the partition that holds the kernel config. The default label of the root partition is `fsa1`.
- `keepMetadata`: Filesystem metadata is kept in [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).
  This option disables saving metadata.
  It is useful for mounting local directories in `jswasi` and for mounting corrupted filesystems for recovery purposes.
- `prompt`: Setting this to `true` makes the kernel open a directory picker which allows to choose a local directory to mount.
- `create`: Creates a directory for the partition label if it doesn't exist.

### Device filesystem

Device filesystem (`devfs`) is an extension of the virtual filesystem and supports character devices.
This filesystem doesn't support any configuration options yet.
It is mounted on `/dev` by default and contains 4 character devices: `null`, `zero`, `urandom` and `ttyH0`.
The first three devices work similarly to it's Linux counterparts.
The last one, `ttyH0`, is an interface to the `hterm` object (the one passed to the `init` function), it can be used to interact with it.
Once attaching multiple terminals to the same kernel is implemented, each of them is going to have it's device analoguous to this one.
This filesystem is rather limited and should not be used in the kernel configuration.

### Proc filesystem

Proc filesystem is now an read only interface to internal kernel structures used for managing processes.
This filesystem doesn't support any configuration options.
It is mounted on `/proc` by default and supports process directories and the `mountinfo` special file.
For now, it doesn't expose much information.
More special files are going to be implemented soon.
This filesystem is read-only and it's usage is rather limited and cannot be mounted manually.

All of these filesystems, except for proc filesystem, can be mounted using the `mount` syscall or `wasibox` applet with the same name.

# Testing

This repository contains two sets of tests: unit tests and syscalls tests.
The first set can be run using `make test` command and it tests the integrity of the internal kernel structures.
Note that `nodejs` (preferably `v18`) is required in order to run the unit tests.
The latter is an userspace rust program that invokes raw syscalls to check whether the kernel responds to them correctly.
Note that for syscalls tests executable to work properly, it needs to be compiled with a custom rust toolchain that implements `canonicalize`.
For instructions on how to build such toolchain, see [wasi_ext_lib](https://github.com/antmicro/wasi_ext_lib#build).
These tests can be ran by using the executable as an init system to the kernel or by just executing it using a shell.
