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

    let _file = File::create("test.txt").unwrap_or_else(|e| {
        println!("error occurred: {}", e);
        exit(1);
    });

    println!("I regret to announce this is the end!");

    return;
}
