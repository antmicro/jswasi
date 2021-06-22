mod utils;

use wasm_bindgen::prelude::*;
// use std::collections::HashMap;
// use std::collections::hash_map::RandomState;
use std::fs;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

macro_rules! log {
    ( $( $t:tt )* ) => {
        web_sys::console::log_1(&format!( $( $t )* ).into());
    }
}

#[wasm_bindgen]
extern {
    fn alert(s: &str);
}

// // Go through js for fs, this would only work on node
// #[wasm_bindgen(module = "/utils.js")]
// extern {
//     #[wasm_bindgen(catch)]
//     fn read_file(path: &str) -> Result<String, JsValue>;
// }

// #[wasm_bindgen(module = "/wasmfs-bindings.js")] // TODO(tkarwowski): add wasmfs-bindings.js file
// extern {
//     fn writeFileSync(filename: String, data: String) -> String; // &str?
//     fn readFileSync(filename: String) -> String;
//     fn readdir(filepath: String, options: String) -> String;
// }

// static COMMANDS: HashMap<String, Box<dyn FnOnce(Vec<String>) -> String>, RandomState> = vec![
//     ("echo".to_owned(), Box::new(echo)),
// ].into_iter().collect();

#[wasm_bindgen]
pub fn handle_line(line: String) -> String {
    // parse input
    let mut words = line.split_whitespace();
    let command_name = words.next().unwrap();
    let args = words.map(|arg| arg.to_owned()).collect();

    // process it
    let result = match command_name {
        "echo" => echo(args),
        "cat" => cat(args),
        "save" => save(args),
        "ls" => ls(args),
        name => Ok(format!("command '{}' not found", name)),
    };

    // // Fails with:
    // // error[E0433]: failed to resolve: could not find `unix` in `os`
    // //   --> /home/tomek/.cargo/registry/src/github.com-1ecc6299db9ec823/rsfs-0.4.1/src/disk/mod.rs:26:14
    // //    |
    // // 26 | use std::os::unix::fs::{DirBuilderExt, FileExt, OpenOptionsExt, PermissionsExt};
    // //    |              ^^^^ could not find `unix` in `os`
    // use std::io::{Read, Seek, SeekFrom, Write};
    // use std::path::PathBuf;
    //
    // use rsfs::*;
    // use rsfs::mem::FS;
    //
    // let fs = FS::new();
    // assert!(fs.create_dir_all("a/b/c").is_ok());
    //
    // let mut wf = fs.create_file("a/f").unwrap();
    // assert_eq!(wf.write(b"hello").unwrap(), 5);
    //
    // let mut rf = fs.open_file("a/f").unwrap();
    // let mut output = [0u8; 5];
    // assert_eq!(rf.read(&mut output).unwrap(), 5);
    // assert_eq!(&output, b"hello");

    // return result
    result.unwrap_or_else(|error| format!("error occurred: {}", error))
}

fn echo(args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    Ok(args.join(" "))
}

fn cat(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    let filename = args.remove(0);
    let content = fs::read_to_string(&filename).unwrap_or_else(|e| {
        alert(&format!("failed reading file: {}", e));
        "".to_owned()
    });
    Ok(content)
}

fn save(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    let filename = args.remove(0);
    fs::write(filename, args.join("")).unwrap_or_else(|e| {
        alert(&format!("failed reading file: {}", e));
    });
    Ok("".to_owned())
}

fn ls(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    let output = String::new();
    // if args.len() == 1 {
    //     let
    // }
    Ok(output)
}
