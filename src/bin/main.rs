use std::fs::File;
use std::io::{Read, Write};
use std::process::exit;
use std::time::Duration;
use std::{env, fs, thread, time};

fn main() {
    println!("Test string.");
    let filename = "./hello.rs";

    // ERRORS
    // print!("Create file... ");
    // let _file = File::create(filename).unwrap_or_else(|e| {
    //     println!("error occurred: {:?}", e);
    //     exit(3);
    // });
    // println!("worked");

    // WORKS
    // print!("Open file '{}'... ", filename);
    let mut file = File::open(filename).unwrap_or_else(|e| {
        println!("error occurred: {:?}", e);
        exit(3);
    });
    // println!("worked");

    // let mut file = unsafe { File::from_raw_fd(4) };
    // let mut buf;
    // file.read_to_string(&mut buf);
    // println!("{}", buf);

    print!("Write to file... ");
    file.write(b"test string write").unwrap_or_else(|e| {
        println!("error occurred: {:?}", e);
        exit(3);
    });
    println!("worked");

    // println!("Open and write to file... ");
    // fs::write(filename, "test string").unwrap_or_else(|e| {
    //     println!("error occurred: {:?}", e);
    //     exit(3);
    // });
    // println!("worked");

    // WORKS
    print!("Read from file... ");
    let s = fs::read_to_string(filename).unwrap_or_else(|e| {
        println!("error occurred: {:?}", e);
        exit(3);
    });
    println!("worked");

    println!("read from file: {}", s);

    print!("Read from file... ");
    let s = fs::read_to_string("/tmp/").unwrap_or_else(|e| {
        println!("error occurred: {:?}", e);
        exit(3);
    });
    println!("worked");

    println!("read from file: {}", s);

    return;
}
