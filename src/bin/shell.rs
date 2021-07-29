use std::{env, fs, thread, time};
use std::fs::File;
use std::io;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::exit;
use std::thread::sleep;
use std::time::Duration;

fn main() {
    let mut pwd = PathBuf::from("/");
    let mut input = String::new();

    loop {
        // prompt for input
        print!("$ ");
        io::stdout().flush().unwrap();

        let mut c = [0];
        // read line
        loop {
            io::stdin().read_exact(&mut c).unwrap();
            match c[0] {
                // enter
                10 => {
                    println!();
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
                    print!("{}", c[0] as char);
                }
            }
            io::stdout().flush().unwrap();
        }

        // handle line
        let mut words = input.split_whitespace();
        let command = words.next().unwrap_or_default();
        let mut args: Vec<_> = words.collect();

        match command {
            // built in commands
            "echo" => println!("{}", args.join(" ")),
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

                    // // simply including this in source breaks shell
                    // if !Path::new(&new_pwd).exists() {
                    //     println!("cd: no such file or directory: {}", new_pwd);
                    // } else {
                    //     pwd = new_pwd;
                    // }
                    pwd = new_path;
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
            "cat" => {
                if let Some(&filename) = args.get(0) {
                    match fs::read_to_string(filename) {
                        Ok(content) => println!("{}", content),
                        // TODO: match on error and provide better messages
                        Err(error) => println!("cat: {}: {}", filename, error),
                    }
                } else {
                    println!("cat: not yet implemented");
                }
            }
            "touch" => {
                if let Some(&filename) = args.get(0) {
                    match File::create(filename) {
                        Ok(_) => {}
                        // TODO: match on error and provide better messages
                        Err(error) => println!("touch: failed creating file: {}", error),
                    }
                } else {
                    println!("touch: missing file operand");
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
            // external commands
            "duk" | "main" | "shell" => {
                File::open(format!("!{} {}", command, args.join(" ")));
                eprintln!("Shell after spawning program");
            }
            // edge cases
            "" => {}
            _ => println!("command not found: {}", command),
        }
        input.clear();
    }
}
