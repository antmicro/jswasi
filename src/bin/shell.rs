use std::io;
use std::io::{Write, Read};
use std::str;

fn main() {
    let mut input = String::new();

    loop {
        // prompt for input
        print!("$ ");
        io::stdout().flush();

        let mut c = [0];
        // read line
        loop {
            io::stdin().read_exact(&mut c);
            match c[0] {
                // enter
                10 => break,
                // CR
                127 => {
                    if !input.is_empty() {
                        input.remove(input.len() - 1);
                        print!("{} {}", 8 as char, 8 as char);
                    }
                },
                // control codes
                code if code < 32 => {
                    // ignore for now
                },
                // regular characters
                _ => {
                    input.push(c[0] as char);
                    print!("{}", c[0] as char);
                    // print!("({},{})", c[0] as u8, c[0] as char);
                }
            }
            io::stdout().flush();
        }

        // handle line
        print!("\nentered: {}\n", input);
        input.clear();
    }
}