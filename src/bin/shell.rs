use std::env;
use std::fs::File;
use std::io;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::time::Duration;
use std::{fs, thread};

use conch_parser::lexer::Lexer;
use conch_parser::parse::DefaultParser;
use conch_parser::ast;

fn main() {
    let mut pwd = PathBuf::from("/");
    let mut input = String::new();

    // TODO: fetch program list from PATH bin directories
    println!("Welcome to Antmicro's WASM shell!\nAvailable (and working) commands are:\ncd, pwd, write, exit, duk, shell, cowsay, python, \nuutils (ls, cat, echo, env, basename, dirname, sum, printf, wc, rm, mv, touch, cp, mkdir, rmdir)");

    loop {
        // prompt for input
        print!("{}$ ", pwd.to_str().unwrap());
        io::stdout().flush().unwrap();

        let mut c = [0];
        // read line
        loop {
            io::stdin().read_exact(&mut c).unwrap();
            match c[0] {
                // enter
                10 => {
                    // println!();
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

        // handle line

        let lex = Lexer::new(input.chars());
        let parser = DefaultParser::new(lex);
        for cmd in parser {

        }

        let mut words = input.split_whitespace();
        let command = words.next().unwrap_or_default();
        let mut args: Vec<_> = words.collect();

        match command {
            // built in commands
            "cd" => {
                if args.is_empty() {
                    pwd = PathBuf::from("/");
                } else {
                    let path = args[0];

                    let new_path = if path.starts_with("/") {
                        PathBuf::from(path)
                    } else {
                        pwd.join(path)
                    };

                    // simply including this in source breaks shell
                    if !Path::new(&new_path).exists() {
                        println!(
                            "cd: no such file or directory: {}",
                            new_path.to_str().unwrap()
                        );
                    } else {
                        env::set_var("OLDPWD", pwd.to_str().unwrap()); // TODO: WASI does not support this
                        match File::open(format!("!set_env {} {}", "OLDPWD", pwd.to_str().unwrap()))
                        {
                            Ok(_) => {}
                            Err(_) => {}
                        }
                        pwd = new_path;
                        env::set_var("PWD", pwd.to_str().unwrap()); // TODO: WASI does not support this
                        match File::open(format!("!set_env {} {}", "PWD", pwd.to_str().unwrap())) {
                            Ok(_) => {}
                            Err(_) => {}
                        }
                    }
                }
            }
            "pwd" => println!("{}", pwd.display()),
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
            "exit" => exit(0),
            // no input
            "" => {}
            // external commands or command not found
            _ => {
                let mut found = false;
                // get PATH env varaible, split it and look for binaries in each directory
                for bin_dir in env::var("PATH").unwrap_or_default().split(":") {
                    let bin_dir = PathBuf::from(bin_dir);
                    let fullpath = bin_dir.join(format!("{}.wasm", command));
                    if fullpath.is_file() {
                        match File::open(format!("!{} {}", fullpath.display(), input)) {
                            Ok(_) => {}  // doesn't happen for now
                            Err(_) => {} // we return error even on successful spawn
                        }
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
