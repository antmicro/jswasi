#[cfg(target_os = "wasi")]
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io;
use std::io::Read;
use std::os::raw::c_int;
use std::path::PathBuf;
use std::process;

use clap::{Command, Arg};
use color_eyre::Report;
use serde_json::json;

#[cfg(target_os = "wasi")]
use wash::syscall;
use wash::Shell;

#[cfg(not(target_os = "wasi"))]
extern "C" {
    fn isatty(fd: c_int) -> c_int;
}

const STDIN: c_int = 0;

fn is_fd_tty(fd: i32) -> Result<bool, Report> {
    #[cfg(not(target_os = "wasi"))]
    return Ok(unsafe { isatty(fd) } == 1);
    #[cfg(target_os = "wasi")]
    return Ok(syscall("isatty", &[&fd.to_string()], &HashMap::new(), false, &[])?.output == "1");
}

fn main() {
    let name = {
        let mut path = PathBuf::from(env::args().next().unwrap_or_else(|| "shell".to_string()));
        path.set_extension("");
        path.file_name().unwrap().to_str().unwrap().to_string()
    };
    let matches = Command::new(name)
        .version(&*format!(
            "{}-{} ({})\nCopyright (c) 2021 Antmicro <www.antmicro.com>",
            env!("CARGO_PKG_VERSION"),
            env!("SHELL_COMMIT_HASH"),
            env!("SHELL_TARGET")
        ))
        .author("Antmicro <www.antmicro.com>")
        .arg(Arg::new("FILE").help("Execute commands from file").index(1))
        .arg(
            Arg::new("command")
                .help("Execute provided command")
                .short('c')
                .long("command")
                .value_name("COMMAND")
                .takes_value(true),
        )
        .get_matches();

    let mut pwd = String::from("/");
    let should_echo;

    #[cfg(target_os = "wasi")] {
        let cmd = json!({
            "command": "get_cwd",
        });
        if let Ok(cwd) = fs::read_link(format!("/!{}", cmd)){
            pwd = cwd.display().to_string();
            env::set_current_dir(cwd).unwrap_or_else(|e| {
                eprintln!("Could not set current working dir: {}", e);
            });
        }
        should_echo = true;
    }
    #[cfg(not(target_os = "wasi"))] {
        pwd = env::var("PWD").unwrap();
        env::set_current_dir(&pwd).unwrap();
        should_echo = false;
    }

    if env::var("PWD").is_err() {
        env::set_var("PWD", &pwd);
    }
    if env::var("HOME").is_err() {
        env::set_var("HOME", "/");
    }

    let mut shell = Shell::new(should_echo, &pwd);

    let result = if let Some(command) = matches.value_of("command") {
        shell.run_command(command)
    } else if let Some(file) = matches.value_of("FILE") {
        shell.run_script(file)
    // is_fd_tty will fail in WASI runtimes (wasmtime/wasmer/wasiwasm), just run interpreter then
    } else if is_fd_tty(STDIN).unwrap_or(true) {
        shell.run_interpreter()
    } else {
        let mut input = String::new();
        let stdin = io::stdin();
        stdin.lock().read_to_string(&mut input).unwrap();
        shell.run_command(&input)
    };

    let exit_code = match result {
        Ok(exit_code) => exit_code,
        Err(e) => {
            eprintln!("shell: error occurred: {}", e);
            2
        }
    };

    process::exit(exit_code);
}
