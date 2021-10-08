use std::env;
use std::fs;
use std::io;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::thread;
use std::time::Duration;
use substring::Substring;

use conch_parser::lexer::Lexer;
use conch_parser::parse::DefaultParser;

use crate::interpreter::interpret;

#[cfg(not(target_os = "wasi"))]
use std::process::Command;

use std::collections::HashMap;

// communicate with the worker thread
pub fn syscall(command: &str, args: &[&str], env: &HashMap<&str, &str>, background: bool) -> Result<String, Box<dyn std::error::Error>> {
    #[cfg(target_os = "wasi")]
    let result = fs::read_link(format!(
        "/!{}\x1b\x1b{}\x1b\x1b{}\x1b\x1b{}",
        command,
        args.join("\x1b"),
        env.iter().map(|(key, val)| format!("{}={}", key, val)).collect::<Vec<_>>().join("\x1b"),
        background
    ))?;
    #[cfg(not(target_os = "wasi"))]
    let result = {
        if command == "spawn" {
            let mut iter = args.iter();
            let mut cmd = Command::new(iter.next().unwrap());
            for arg in iter {
                cmd.arg(arg);
            }
            let mut app = cmd.spawn().unwrap();
            app.wait()?;
        }
        PathBuf::from("")
    };
    Ok(result
        .to_str()
        .unwrap()
        .trim_matches(char::from(0))
        .to_string())
}

pub struct Shell {
    pub pwd: String,
    pub history: Vec<String>,
    pub vars: HashMap<String, String>,
}

impl Shell {
    pub fn new(pwd: &str) -> Self {
        Shell {
            pwd: pwd.to_string(),
            history: Vec::new(),
            vars: HashMap::new(),
        }
    }

    pub fn run_command(&mut self, command: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.handle_input(command)
    }

    pub fn run_script(&mut self, script_name: impl Into<PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
        self.handle_input(&fs::read_to_string(script_name.into())?)
    }

    pub fn run_interpreter(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        // TODO: see https://github.com/WebAssembly/wasi-filesystem/issues/24
        env::set_current_dir(env::var("PWD")?)?;

        let motd_path = PathBuf::from("/etc/motd");
        if motd_path.exists() {
            println!("{}", fs::read_to_string(motd_path)?);
        }

        loop {
            let mut input = String::new();
            let mut input_stash = String::new();
            let mut display_path = String::new();

            // prompt for input
            if self.pwd.substring(0, env::var("HOME")?.len()) == env::var("HOME")? {
                display_path.push('~');
                display_path.push_str(self.pwd.substring(env::var("HOME")?.len(), 4096));
            } else {
                display_path.push_str(&self.pwd);
            }
            print!("\x1b[1;34mant@webshell \x1b[1;33m{}$ \x1b[0m", display_path);
            io::stdout().flush()?;
            let mut c = [0];
            let mut escaped = false;
            let mut history_entry_to_display: i32 = -1;
            // read line
            loop {
                io::stdin().read_exact(&mut c)?;
                if escaped {
                    match c[0] {
                        0x5b => {
                            io::stdout().flush()?;
                            let mut c2 = [0];
                            io::stdin().read_exact(&mut c2)?;
                            match c2[0] {
                                0x32 | 0x33 | 0x35 | 0x36 => {
                                    io::stdout().flush()?;
                                    let mut c3 = [0];
                                    io::stdin().read_exact(&mut c3)?;
                                    match [c2[0], c3[0]] {
                                        [0x35, 0x7e] => {
                                            println!("TODO: PAGE UP");
                                            escaped = false;
                                        }
                                        [0x36, 0x7e] => {
                                            println!("TODO: PAGE DOWN");
                                            escaped = false;
                                        }
                                        [0x32, 0x7e] => {
                                            println!("TODO: INSERT");
                                            escaped = false;
                                        }
                                        [0x33, 0x7e] => {
                                            println!("TODO: DELETE");
                                            escaped = false;
                                        }
                                        [0x33, 0x3b] => {
                                            println!("TODO: SHIFT + DELETE");
                                            io::stdout().flush()?;
                                            let mut c4 = [0];
                                            // TWO MORE! TODO: improve!
                                            io::stdin().read_exact(&mut c4)?;
                                            io::stdin().read_exact(&mut c4)?;
                                            escaped = false;
                                        }
                                        _ => {
                                            println!(
                                                "TODO: [ + 0x{:02x} + 0x{:02x}",
                                                c2[0] as u8, c3[0] as u8
                                            );
                                            escaped = false;
                                        }
                                    }
                                }
                                0x41 => {
                                    if !self.history.is_empty() {
                                        if history_entry_to_display == -1 {
                                            history_entry_to_display = (self.history.len() - 1) as i32;
                                            input_stash.clear();
                                            input_stash.push_str(&input);
                                        } else if history_entry_to_display > 0 {
                                            history_entry_to_display -= 1;
                                        }
                                        let to_delete = input.len();
                                        for _ in 0..to_delete {
                                            print!("{} {}", 8 as char, 8 as char);
                                            // '\b \b', clear left of cursor
                                        }
                                        input.clear();
                                        input.push_str(&self.history[history_entry_to_display as usize]);
                                        print!("{}", input);
                                    }
                                    escaped = false;
                                }
                                0x42 => {
                                    if history_entry_to_display != -1 {
                                        let to_delete = input.len();
                                        for _ in 0..to_delete {
                                            print!("{} {}", 8 as char, 8 as char);
                                            // '\b \b', clear left of cursor
                                        }
                                        input.clear();
                                        if self.history.len() - 1 > (history_entry_to_display as usize) {
                                            history_entry_to_display += 1;
                                            input.push_str(
                                                &self.history[history_entry_to_display as usize],
                                            );
                                        } else {
                                            input.push_str(&input_stash);
                                            history_entry_to_display = -1;
                                        }
                                        print!("{}", input);
                                    }
                                    escaped = false;
                                }
                                0x43 => {
                                    println!("TODO: RIGHT");
                                    escaped = false;
                                }
                                0x44 => {
                                    println!("TODO: LEFT");
                                    escaped = false;
                                }
                                0x46 => {
                                    println!("TODO: END");
                                    escaped = false;
                                }
                                0x48 => {
                                    println!("TODO: HOME");
                                    escaped = false;
                                }
                                _ => {
                                    println!("WE HAVE UNKNOWN CONTROL CODE '[' + {}", c2[0] as u8);
                                    escaped = false;
                                }
                            }
                        }
                        _ => {
                            escaped = false;
                        }
                    }
                } else {
                    if c[0] != 0x1b {
                        history_entry_to_display = -1;
                    }
                    match c[0] {
                        // enter
                        10 => {
                            input = input.trim().to_string();
                            break;
                        }
                        // backspace
                        127 => {
                            if !input.is_empty() {
                                input.remove(input.len() - 1);
                                print!("{} {}", 8 as char, 8 as char); // '\b \b', clear left of cursor
                            }
                        }
                        // control codes
                        code if code < 32 => {
                            if code == 0x1b {
                                escaped = true;
                            }
                            // ignore rest for now
                        }
                        // regular characters
                        _ => {
                            input.push(c[0] as char);
                            // echo
                            // print!("{}", c[0] as char);
                        }
                    }
                }
                io::stdout().flush()?;
            }

            // handle line

            // TODO: incorporate this into interpreter of parsed input

            if input.is_empty() {
                continue;
            }

            // handle '!' history
            if input.starts_with('!') {
                let sbstr = input
                    .split_whitespace()
                    .next()
                    .unwrap()
                    .substring(1, 64)
                    .split_whitespace()
                    .next()
                    .unwrap();
                let history_entry_id: usize = sbstr.parse().unwrap_or_else(|_| {
                    if sbstr.is_empty() {
                        return 0;
                    }
                    let mut j = 0;
                    let mut found = 0;
                    for entry in &self.history {
                        j += 1;
                        if entry.substring(0, sbstr.len()) == sbstr {
                            found = j;
                            break;
                        }
                    }
                    found
                });
                if history_entry_id == 0 || self.history.len() < history_entry_id {
                    if sbstr.is_empty() {
                        println!("!{}: event not found", sbstr);
                    }
                    input.clear();
                    continue;
                } else {
                    let mut iter = self.history[history_entry_id - 1].clone();
                    let prefix = format!("!{}", sbstr);
                    iter.push_str(input.strip_prefix(&prefix).unwrap());
                    input.clear();
                    input.push_str(&iter);
                }
            }

            if input.substring(0, 1) != "!" && !input.replace(" ", "").is_empty() {
                self.history.push(input.clone());
            }

            if let Err(error) = self.handle_input(&input) {
                println!("{:#?}", error);
            };
        }
    }

    fn execute_command(&mut self, command: String, mut args: Vec<String>, env: &HashMap<&str, &str>, background: bool) -> Result<(), Box<dyn std::error::Error>> {
        match command.as_str() {
            // built in commands
            "history" => {
                for (i, history_entry) in self.history.iter().enumerate() {
                    println!("{}: {}", i, history_entry);
                }
            }
            "cd" => {
                let path = if args.is_empty() {
                    PathBuf::from(env::var("HOME")?)
                } else if args[0] == "-" {
                    PathBuf::from(env::var("OLDPWD")?)
                } else if args[0].starts_with('/') {
                    PathBuf::from(&args[0])
                } else {
                    PathBuf::from(&self.pwd).join(&args[0])
                };

                // simply including this in source breaks shell
                if !Path::new(&path).exists() {
                    println!(
                        "cd: no such file or directory: {}",
                        path.display()
                    );
                } else {
                    env::set_var(
                        "OLDPWD",
                        env::current_dir()?.to_str().unwrap(),
                    ); // TODO: WASI does not support this
                    syscall(
                        "set_env",
                        &["OLDPWD", env::current_dir()?.to_str().unwrap()],
                        env,
                        false,
                    )?;
                    #[cfg(not(target_os = "wasi"))]
                    let pwd_path =
                        PathBuf::from(fs::canonicalize(path).unwrap());
                    #[cfg(target_os = "wasi")]
                    let pwd_path = PathBuf::from(syscall(
                        "set_env",
                        &["PWD", path.to_str().unwrap()],
                        env,
                        false,
                    )?);
                    env::set_var("PWD", pwd_path.to_str().unwrap());
                    env::set_current_dir(&pwd_path)?;
                }
            }
            "pwd" => println!("{}", env::current_dir()?.display()),
            "sleep" => {
                // TODO: requires poll_oneoff implementation
                if let Some(sec_str) = &args.get(0) {
                    if let Ok(sec) = sec_str.parse() {
                        thread::sleep(Duration::new(sec, 0));
                    } else {
                        println!(
                            "sleep: invalid time interval `{}`",
                            sec_str
                        );
                    }
                } else {
                    println!("sleep: missing operand");
                }
            }
            "mkdir" | "rmdir" | "touch" | "rm" | "mv" | "cp" | "echo"
            | "ls" | "date" | "printf" | "env" | "cat" | "realpath" => {
                args.insert(0, command.as_str().to_string());
                #[cfg(target_os = "wasi")]
                args.insert(0, String::from("/usr/bin/uutils"));
                #[cfg(not(target_os = "wasi"))]
                args.insert(0, String::from("/bin/busybox"));
                let args_: Vec<&str> = args.iter().map(|s| &**s).collect();
                syscall("spawn", &args_[..], env, false)?;
            }
            "ln" | "printenv" | "md5sum" => {
                args.insert(0, command.as_str().to_string());
                #[cfg(target_os = "wasi")]
                args.insert(0, String::from("/usr/bin/coreutils"));
                #[cfg(not(target_os = "wasi"))]
                args.insert(0, String::from("/bin/busybox"));
                let args_: Vec<&str> = args.iter().map(|s| &**s).collect();
                syscall("spawn", &args_[..], env, false)?;
            }
            "write" => {
                if args.len() < 2 {
                    println!("write: help: write <filename> <contents>");
                } else {
                    match fs::write(args.remove(0), args.join(" ")) {
                        Ok(_) => {}
                        Err(error) => {
                            println!(
                                "write: failed to write to file: {}",
                                error
                            )
                        }
                    }
                }
            }
            "clear" => {
                print!("\x1b[2J\x1b[H");
            }
            "unset" => {
                if args.len() < 1 {
                    println!("unset: help: unset <VAR> [<VAR>] ...");
                }
                for arg in args {
                    if arg == "PWD" || arg == "HOME" {
                        println!("unset: cannot unset {}", &arg);
                    } else {
                        self.vars.remove(&arg);
                        if !env::var(&arg).is_err() {
                            env::remove_var(&arg);
                            syscall("set_env", &[&arg], env, false)?;
                        }
                    }
                }
            }
            "declare" => {
                if args.is_empty() {
                    // TODO: check some stuff?
                    for (key, value) in self.vars.iter() {
                        println!("{}={}", key, value);
                    }
                } else {
                    for arg in args {
                        if arg.contains("=") {
                            let mut args_ = arg.split("=");
                            let key = args_.next().unwrap();
                            let value = args_.next().unwrap();
                            // TODO: check if exists etc
                            self.vars.insert(key.to_string(), value.to_string());
                        }
                    }
                }
            }
            "export" => {
                // export creates an env value if A=B notation is used, or just
                // copies a local var to env if no "=" is used. export on
                // unexisting local var does nothing.
                // to implement it fully we need local vars support.
                if args.is_empty() {
                    println!("export: help: export <VAR>[=<VALUE>] [<VAR>[=<VALUE>]] ...");
                }
                for arg in args {
                    if arg.contains("=") {
                        let mut args_ = arg.split("=");
                        let key = args_.next().unwrap();
                        let value = args_.next().unwrap();
                        env::set_var(&key, &value);
                        syscall("set_env", &[&key, &value], env, false)?;
                    } else {
                        let value = &self.vars[&arg];
                        env::set_var(&arg, value);
                        syscall("set_env", &[&arg, value], env, false)?;
                    }
                }
            }
            "hexdump" => {
                if args.is_empty() {
                    println!("hexdump: help: hexump <filename>");
                } else {
                    let contents =
                        fs::read(args.remove(0)).unwrap_or_else(|_| {
                            println!("hexdump: error: file not found.");
                            return vec![];
                        });
                    let len = contents.len();
                    let mut v = ['.'; 16];
                    for j in 0..len {
                        let c = contents[j] as char;
                        v[j % 16] = c;
                        if (j % 16) == 0 {
                            print!("{:08x} ", j);
                        }
                        if (j % 8) == 0 {
                            print!(" ");
                        }
                        print!("{:02x} ", c as u8);
                        if (j + 1) == len || (j % 16) == 15 {
                            let mut count = 16;
                            if (j + 1) == len {
                                count = len % 16;
                                for _ in 0..(16 - (len % 16)) {
                                    print!("   ");
                                }
                                if count < 8 {
                                    print!(" ");
                                }
                            }
                            print!(" |");
                            for c in v.iter_mut().take(count) {
                                if (0x20..0x7e).contains(&(*c as u8)) {
                                    print!("{}", *c as char);
                                    *c = '.';
                                } else {
                                    print!(".");
                                }
                            }
                            println!("|");
                        }
                    }
                }
            }
            "exit" => {
                let exit_code: i32 = {
                    if args.is_empty() {
                        0
                    } else {
                        args[0].parse().unwrap()
                    }
                };
                exit(exit_code);
            }
            // no input
            "" => {}
            // external commands or command not found
            _ => {
                let fullpath = if command.starts_with('/') {
                    let fullpath = PathBuf::from(command);
                    if fullpath.is_file() {
                        Ok(fullpath)
                    } else {
                        Err(format!(
                            "shell: no such file or directory: {}",
                            fullpath.display()
                        ))
                    }
                } else if command.starts_with('.') {
                    let path = PathBuf::from(&self.pwd);
                    let fullpath = path.join(command);
                    if fullpath.is_file() {
                        Ok(fullpath)
                    } else {
                        Err(format!(
                            "shell: no such file or directory: {}",
                            fullpath.display()
                        ))
                    }
                } else {
                    let mut found = false;
                    let mut fullpath = PathBuf::new();
                    // get PATH env variable, split it and look for binaries in each directory
                    for bin_dir in
                        env::var("PATH").unwrap_or_default().split(':')
                    {
                        let bin_dir = PathBuf::from(bin_dir);
                        fullpath = bin_dir.join(&command);
                        if fullpath.is_file() {
                            found = true;
                            break;
                        }
                    }
                    if found {
                        Ok(fullpath)
                    } else {
                        Err(format!("command not found: {}", command))
                    }
                };

                match fullpath {
                    Ok(path) => {
                        args.insert(0, path.display().to_string());
                        let args_: Vec<&str> =
                            args.iter().map(|s| &**s).collect();
                        let _result = syscall("spawn", &args_[..], env, false);
                    }
                    Err(reason) => println!("{}", reason),
                }
            }
        }
        Ok(())
    }

    fn handle_input(&mut self, input: &str) -> Result<(), Box<dyn std::error::Error>> {
        let lex = Lexer::new(input.chars());
        let parser = DefaultParser::new(lex);
        for cmd in parser {
            match cmd {
                Ok(cmd) => interpret(&self, &cmd),
                Err(e) => {
                    println!("{:?}", e);
                }
            }
        }
        Ok(())
    }
}
