use std::{env, fs};
use std::io::{self, Write};

fn main() {
    println!("Hello from Rust/WASM!");
    io::stdout().write_all(b"hello world\n").unwrap();
    eprintln!("Error print");
    eprintln!("Error print");

    for argument in env::args() {
        println!("one is:");
        println!("{}", argument);
    }

    // let mut buff = String::new();
    // io::stdin().read_line(&mut buff);
    // println!("You entered: {}", buff);

    // Throws hard to debug - Uncaught (in promise) RuntimeError: unreachable
   
   
   // TODO: this breaks stuff
   // let mut buff = fs::read_to_string("hello.rs").unwrap_or("failed reading file".to_owned());
   // println!("{}", buff);

    return;
}
