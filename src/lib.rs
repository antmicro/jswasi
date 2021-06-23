use std::fs;

// macro_rules! log {
//     ( $( $t:tt )* ) => {
//         web_sys::console::log_1(&format!( $( $t )* ).into());
//     }
// }

// #[link(wasm_import_module = "env")]
extern {
    fn logHello();
    fn stdio(code: i32);
}

// one of these two must be here
#[export_name = "stdin"]
// #[no_mangle]
pub extern fn stdin(code: i32) {
    unsafe { logHello(); };
    unsafe { stdio(code); };

    // parse input
    // let mut words = line.split_whitespace();
    // let command_name = words.next().unwrap();
    // let args = words.map(|arg| arg.to_owned()).collect();
    //
    // // process it
    // let result = match command_name {
    //     "echo" => echo(args),
    //     "cat" => cat(args),
    //     "save" => save(args),
    //     "ls" => ls(args),
    //     name => Ok(format!("command '{}' not found", name)),
    // };
    //
    // // return result
    // result.unwrap_or_else(|error| format!("error occurred: {}", error))
}
//
// fn echo(args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
//     Ok(args.join(" "))
// }
//
// fn cat(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
//     let filename = args.remove(0);
//     let content = fs::read_to_string(&filename).unwrap_or_else(|e|
//         unsafe {
//             alert(&format!("failed reading file: {}", e));
//             "".to_owned()
//         }
//     );
//     Ok(content)
// }
//
// fn save(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
//     let filename = args.remove(0);
//     fs::write(filename, args.join("")).unwrap_or_else(|e|
//         unsafe {
//             alert(&format!("failed writing to file: {}", e));
//         }
//     );
//     Ok("".to_owned())
// }
//
// fn ls(mut args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
//     let output = String::new();
//     // if args.len() == 1 {
//     //     let
//     // }
//     Ok(output)
// }
