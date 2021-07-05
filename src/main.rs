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

    fs::write("test.txt", "saved contents").unwrap_or_else(|e| {
        println!("error occured: {}", e);
    });
    // let buffer = fs::read_to_string("hello.rs").unwrap_or_else(|e| {
    //     println!("error occured: {}", e);
    //     "".to_owned()
    // });
    // println!("bufer: {}", buffer);

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
