use std::{env, fs, thread, time};
use std::io::{self, Write};
use std::time::Duration;
use std::fs::File;
use std::process::exit;

fn main() {
    println!("Going to do an iteration 30 times and sleep 1s in between");
    for _ in 0..3 {
        println!("Iteration -- Hello from Rust/WASM!");
    }

    // let mut file = File::create("test.txt").unwrap_or_else(|e| {
    //     println!("error occurred: {}", e);
    //     exit(1);
    // });

    // let mut file = File::open("/tmp/test.txt").unwrap_or_else(|e| {
    //     println!("error occurred: {}", e);
    //     exit(1);
    // });

    // fs::write("test.txt", "saved contents").unwrap_or_else(|e| {
    //     println!("error occurred: {}", e);
    // });
    // let buffer = fs::read_to_string("hello.rs").unwrap_or_else(|e| {
    //     println!("error occurred: {}", e);
    //     "".to_owned()
    // });
    // println!("buffer: {}", buffer);

    // println!("Type something (4 tries):");
    // for _ in 0..4 {
    //    let mut buff = String::new();
    //    io::stdin().read_line(&mut buff);
    //    println!("You entered: {}", buff);
    // }
    
    println!("I regret to announce this is the end!");

    // // This wouldn't work, hands whole site, doesn't even render terminal
    // loop {
    //     println!("Hello from infinite loop!")
    // }

    return;
}
