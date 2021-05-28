mod utils;

use wasm_bindgen::prelude::*;

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

    // return result
    result.unwrap_or_else(|error| format!("error occurred: {}", error))
}

fn echo(args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    Ok(args.join(" "))
}

fn cat(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    let filename = args.remove(0);
    // let content = readFileSync(filename);
    Ok(format!("{}", content))
}

fn save(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    let filename = args.remove(0);
    // writeFileSync(filename, args.join(" "));
    Ok("".to_owned())
}

fn ls(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    let output = String::new();
    // if args.len() == 1 {
    //     let
    // }
    Ok(output)
}
