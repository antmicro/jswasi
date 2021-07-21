use std::io;
use std::io::{Write, Read};
use std::fs::File;
use std::process::exit;

fn main() {
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
                10 => break,
                // backspace
                127 => {
                    if !input.is_empty() {
                        input.remove(input.len() - 1);
                        print!("{} {}", 8 as char, 8 as char); // '\b \b', clear left of cursor
                    }
                },
                // control codes
                code if code < 32 => {
                    // ignore for now
                },
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
        let args: Vec<_> = words.collect();

        match command {
            // built in commands
            "echo" => println!("\n{}", args.join(" ")),
            "cd" => println!("\ncd not yet implemented"),
            "exit" => exit(0),
            // external commands
            "duk" | "main" | "shell" => {
                println!();
                File::open(format!("!{}", command));
            },
            // edge cases
            "" => println!(),
            _ => println!("\ncommand not found: {}", command),
        }
        input.clear();
    }
}