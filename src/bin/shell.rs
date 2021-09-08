use std::env;
use std::io;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::time::Duration;
use std::fs;
use std::thread;
use substring::Substring;

fn main() {
    // TODO: see https://github.com/WebAssembly/wasi-filesystem/issues/24 
    env::set_current_dir(env::var("PWD").unwrap());

//  let mut input = String::new();
    let mut history: Vec<String> = Vec::new();

    // TODO: fetch program list from PATH bin directories
    println!("Welcome to Antmicro's WASM shell!\nAvailable (and working) commands are:\ncd, pwd, write, exit, duk, shell, cowsay, python, \nuutils (ls, cat, echo, env, basename, dirname, sum, printf, wc, rm, mv, touch, cp, mkdir, rmdir)");

    loop {
        let mut input = String::new();
        let mut display_path = String::new();


        // prompt for input
        let pwd = env::current_dir().unwrap().display().to_string();
        if (pwd.substring(0, env::var("HOME").unwrap().len()) == env::var("HOME").unwrap()) {
            display_path.push_str("~");
            display_path.push_str(pwd.substring(env::var("HOME").unwrap().len(), 4096));
        } else {
            display_path.push_str(&pwd);
        }
        print!("{}[1;34mant@webshell {}[1;33m{}$ {}[0m", char::from_u32(27).unwrap(), char::from_u32(27).unwrap(), display_path, char::from_u32(27).unwrap());
        io::stdout().flush().unwrap();
        let mut c = [0];
        // read line
        loop {
            io::stdin().read_exact(&mut c);
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
                    // ignore for now
                }
                // regular characters
                _ => {
                    input.push(c[0] as char);
                    // echo
                    // print!("{}", c[0] as char);
                }
            }
            io::stdout().flush().unwrap();
        }

        if input == "" {
            continue;
        }


        // handle '!' history
        if input.starts_with("!") {
            // TODO: we should handle more than numbers
            let sbstr = input.split_whitespace().next().unwrap().substring(1,64);
            let history_entry_id: usize = sbstr.parse().unwrap();
            if history_entry_id == 0 || history.len() < history_entry_id {
                println!("!{}: event not found", history_entry_id);
                input.clear();
                continue;
            } else {
                let mut iter = history[history_entry_id-1].clone();
                let prefix = format!("!{}", history_entry_id);
                iter.push_str(input.strip_prefix(&prefix).unwrap());
                input.clear();
                input.push_str(&iter);
            }
        }

        // handle line
        let mut words = input.split_whitespace();
        let command = words.next().unwrap();
        if command == "" {
            continue;
        }
        let mut args: Vec<_> = words.collect();
        
        if input.substring(0,1) != "!" && input.replace(" ", "").len() != 0 {
            let entry = format!("{}", input);
            history.push(entry);
        }

        match command {
            // built in commands
            "history" => {
                let mut i = 0;
                for history_entry in &history {
                    i += 1;
                    println!("{}: {}", i, history_entry);
                }
            }
            "cd" => {
                if args.is_empty() {
                    // TODO: cd should be equal to cd ~ not cd /
                    env::set_current_dir(PathBuf::from("/"));
                } else {
                    let path = args[0];

                    let new_path = if path.starts_with("/") {
                        PathBuf::from(path)
                    } else {
                        let pwd = env::current_dir().unwrap();
                        pwd.join(path)
                    };

                    // simply including this in source breaks shell
                    if !Path::new(&new_path).exists() {
                        println!(
                            "cd: no such file or directory: {}",
                            new_path.to_str().unwrap()
                        );
                    } else {
                        let oldpwd = env::current_dir().unwrap();
                        env::set_var("OLDPWD", env::current_dir().unwrap().to_str().unwrap()); // TODO: WASI does not support this
                        fs::read_link(format!("/!set_env OLDPWD {}", env::current_dir().unwrap().to_str().unwrap()));
                        let pwd_path = PathBuf::from(fs::read_link(format!("/!set_env PWD {}", new_path.to_str().unwrap())).unwrap().to_str().unwrap().trim_matches(char::from(0)));
                        env::set_var("PWD", pwd_path.to_str().unwrap());
                        env::set_current_dir(&pwd_path);
                    }
                }
            }
            "pwd" => println!("{}", env::current_dir().unwrap().display()),
            "sleep" => {
                // TODO: requires poll_oneoff implementation
                if let Some(&sec_str) = args.get(0) {
                    if let Ok(sec) = sec_str.parse() {
                        thread::sleep(Duration::new(sec, 0));
                    } else {
                        println!("sleep: invalid time interval `{}`", sec_str);
                    }
                } else {
                    println!("sleep: missing operand");
                }
            }
            "mkdir" | "rmdir" | "touch" | "rm" | "mv" | "cp" | "echo" | "ls" | "date" | "printf" | "env" | "cat" => {
                fs::read_link(format!("/!spawn /usr/bin/uutils {} {}", command, args.join(" ")).trim());
            }
            "ln" | "printenv" => {
                fs::read_link(format!("/!spawn /usr/bin/coreutils {} {}", command, args.join(" ")).trim());
            }
            "write" => {
                if args.len() < 2 {
                    println!("write: help: write <filename> <contents>");
                } else {
                    match fs::write(args.remove(0), args.join(" ")) {
                        Ok(_) => {}
                        Err(error) => println!("write: failed to write to file: {}", error),
                    }
                }
            }
            "clear" => {
                print!(""); // TODO: send clear escape codes
            }
            "hexdump" => {
                if args.len() < 1 {
                    println!("hexdump: help: hexump <filename>");
                } else {
                    let contents = fs::read(args.remove(0)).unwrap_or_else(|_| {
                        println!("hexdump: error: file not found.");
                        return vec!();
                    });
                    let len = contents.len();
                    let mut j = 0;
                    let mut v = ['.'; 16];
                    for j in 0..len {
                        let c = contents[j] as char;
                        v[j % 16] = c;
                        if (j % 16) == 0 { print!("{:08x} ", j); }
                        if (j % 8) == 0 { print!(" "); }
                        print!("{:02x} ", c as u8);
                        if (j + 1) == len || (j % 16) == 15 {
                            let mut count = 16;
                            if (j + 1) == len {
                                count = len % 16;
                                for _ in 0..(16-(len % 16)) {
                                    print!("   ");
                                }
                                if (count < 8) {
                                    print!(" ");
                                }
                            }
                            print!(" |");
                            for k in 0..count {
                                if (0x20..0x7e).contains(&(v[k] as u8)) {
                                    print!("{}", v[k] as char);
                                    v[k] = '.';
                                } else {
                                    print!(".");
                                }
                            }
                            println!("|");
                            
                        }
                    }
                }
            }
            "exit" => exit(0),
            // no input
            "" => {}
            // external commands or command not found
            _ => {
                let mut found = false;
                // get PATH env varaible, split it and look for binaries in each directory
                for bin_dir in env::var("PATH").unwrap_or_default().split(":") {
                    let bin_dir = PathBuf::from(bin_dir);
                    let fullpath = bin_dir.join(format!("{}", command));
                    println!("trying file '{0}'", fullpath.display());
                    if fullpath.is_file() {
                        let _result = fs::read_link(format!("/!spawn {} {}", fullpath.display(), input).trim()).unwrap().to_str().unwrap().trim_matches(char::from(0));
                        found = true;
                        break;
                    }
                }
                if !found {
                    println!("command not found: {}", command);
                }
            }
        }
        input.clear();
    }
}
