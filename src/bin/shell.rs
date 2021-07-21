use std::io;
use std::io::{Write, Read};

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
                // CR
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
                    // print!("({},{})", c[0] as u8, c[0] as char);
                }
            }
            io::stdout().flush().unwrap();
        }

        // handle line
        print!("\nentered: {}\n", input);
        input.clear();
    }
}