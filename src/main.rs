use std::{env, fs, thread};
use std::io::{self, Write};
use std::time::Duration;

fn main() {
    // This works, but maybe because stdin errors and process finishes
    for _ in 0..3 {
        println!("Hello from Rust/WASM!");
    }

    let mut buff = String::new();
    io::stdin().read_line(&mut buff);
    println!("You entered: {}", buff);

    // // This wouldn't work, hands whole site, doesn't even render terminal
    // loop {
    //     println!("Hello from infinite loop!")
    // }

    return;
}
