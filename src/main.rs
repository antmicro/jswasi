use std::{env, fs, thread, time};
use std::io::{self, Write};
use std::time::Duration;

fn main() {
    let delay = time::Duration::from_millis(1000);
    
    // This works, but maybe because stdin errors and process finishes
    println!("Going to do an iteration 30 times and sleep 1s in between");
    for _ in 0..30 {
        println!("Iteration -- Hello from Rust/WASM!");
        //thread::sleep(delay);
    }

    println!("Type something (10 tries):");
    let mut buff = String::new();
    for _ in 0..10 {
       io::stdin().read_line(&mut buff);
       println!("You entered: {}", buff);
    }

    // // This wouldn't work, hands whole site, doesn't even render terminal
    // loop {
    //     println!("Hello from infinite loop!")
    // }

    return;
}
