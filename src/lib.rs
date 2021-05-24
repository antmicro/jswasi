mod utils;

use wasm_bindgen::prelude::*;
// use std::collections::HashMap;
// use std::collections::hash_map::RandomState;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
extern {
    fn alert(s: &str);
}

// static COMMANDS: HashMap<String, Box<dyn FnOnce(Vec<String>) -> String>, RandomState> = vec![
//     ("echo".to_owned(), Box::new(echo)),
// ].into_iter().collect();

#[wasm_bindgen]
pub fn handle_line(line: String) -> String {
    let mut words = line.split_whitespace();
    let command_name = words.next().unwrap();
    let args = words.map(|arg| arg.to_owned()).collect();
    match command_name {
        "echo" => echo(args),
        name => format!("command '{}' not found", name)
    }
    // format!("# msh returns\r\n{}", COMMANDS[command_name](args))
}

fn echo(args: Vec<String>) -> String {
    args.join(" ")
}

