use std::io;
use std::io::Write;

fn main() {
    loop {
        print!("$ ");
        io::stdout().flush();

        let mut input = String::new();
        io::stdin().read_line(&mut input);

        let command = input.trim();

        print!("entered: {}\n", command);
    }
}