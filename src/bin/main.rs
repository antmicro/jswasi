use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::process::exit;
use std::time::Duration;
use std::{env, fs, thread, time};
use std::net::TcpStream;

fn main() {
    println!("Test string.");

    // WON'T WORK IN CURRENT wasm32-wasi
    // let mut stream = TcpStream::connect("127.0.0.0:8000").unwrap();

    // ERRORS
    print!("Create file... ");
    let mut file = File::create("./created.txt").unwrap_or_else(|e| {
        println!("error occurred: {:?}", e);
        exit(3);
    });
    println!("worked");

    // WORKS
    // print!("Open file '{}'... ", filename);
    // let mut file = File::open(filename).unwrap_or_else(|e| {
    //     println!("error occurred: {:?}", e);
    //     exit(3);
    // });
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

    // file.seek(SeekFrom::Start(0));
    // file.sync_all().unwrap();

    let mut buf = String::new();
    file.read_to_string(&mut buf);
    println!("read after write: {}", buf);
    // println!("Open and write to file... ");
    // fs::write(filename, "test string").unwrap_or_else(|e| {
    //     println!("error occurred: {:?}", e);
    //     exit(3);
    // });
    // println!("worked");

    // WORKS
    print!("Read from file... ");
    let s = fs::read_to_string("./created.txt").unwrap_or_else(|e| {
        println!("error occurred: {:?}", e);
        exit(3);
    });
    println!("worked");

    println!("read from file: {}", s);

    // WORKS
    // print!("Open file '{}'... ", filename);
    // let mut file = File::open(filename).unwrap_or_else(|e| {
    //     println!("error occurred: {:?}", e);
    //     exit(3);
    // });

    // println!("worked");
    // print!("Read from file... ");
    // let s = fs::read_to_string("/tmp/test.txt").unwrap_or_else(|e| {
    //     println!("error occurred: {:?}", e);
    //     exit(3);
    // });
    // println!("worked");
    // //
    // println!("read from file: {}", s);

    return;
}
