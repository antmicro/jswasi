use std::{env, fs, thread, time};
use std::io::{self, Write};
use std::time::Duration;
use std::fs::File;
use std::process::exit;

fn main() {
    println!("Start script.");
    let filename = "/tmp/test.txt";

    print!("Create file... ");
    let _file = File::create(filename).unwrap_or_else(|e| {
        println!("error occurred: {}", e);
        exit(3);
    });
    println!("worked");

    // print!("Open file... ");
    // let _file = File::open(filename).unwrap_or_else(|e| {
    //     println!("error occurred: {}", e);
    //     exit(3);
    // });
    // println!("worked");

    // println!("Write to file... ");
    // fs::write(filename, "test string").unwrap_or_else(|e| {
    //     println!("error occurred: {:?}", e);
    //     exit(3);
    // });
    // println!("worked");

    println!("Read from file... ");
    let s = fs::read_to_string(filename).unwrap_or_else(|e| {
        println!("error occurred: {}", e);
        exit(3);
    });
    println!("worked");

    println!("read from file: {}", s);

    return;
}
