use std::fs::File;
use std::io;
use std::io::prelude::*;
use std::io::SeekFrom;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::time::Duration;
use std::{fs, thread};

fn main() {
    let filename = "a.txt";
    match File::create(filename) {
        Ok(_) => {}
        // TODO: match on error and provide better messages
        Err(error) => println!("touch: failed creating file: {}", error),
    }

    match fs::write(filename, "aaa") {
        Ok(_) => {}
        Err(error) => println!("write: failed to write to file: {}", error),
    }
    let mut file = File::open("a.txt").unwrap();
    file.seek(SeekFrom::Start(2)).unwrap();
    match fs::read_to_string(filename) {
        Ok(content) => println!("{}", content),
        // TODO: match on error and provide better messages
        Err(error) => println!("cat: {}: {}", filename, error),
    }
}
