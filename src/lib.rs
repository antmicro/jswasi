use std::fs;

// macro_rules! log {
//     ( $( $t:tt )* ) => {
//         web_sys::console::log_1(&format!( $( $t )* ).into());
//     }
// }

// #[link(wasm_import_module = "env")]
extern {
    fn logHello();
    fn stdio(code: u32);
}

static mut INPUT: String = String::new();

// one of these two must be here
#[export_name = "stdin"]
// #[no_mangle]
pub unsafe extern fn stdin(code: u32) {
    logHello();
    // unsafe { stdio(code); };

    if code == 13 {
        // stdio('\r' as u32);
        for c in INPUT.chars().rev() {
            stdio(c as u32);
        }
        INPUT.clear();
    } else {
        stdio(code);
        INPUT.push(char::from_u32(code).unwrap());
    }


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
