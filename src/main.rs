use std::env;
use std::io::{self, Write};

fn main() {
    println!("Hello from Rust/WASM!");
    io::stdout().write_all(b"hello world\n");
    eprintln!("Error print");
    eprintln!("Error print");

    for argument in env::args() {
        println!("one is:");
        println!("{}", argument);
    }

    return;
}
