use std::collections::HashMap;
use std::env;
use std::process;

use wash::syscall;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let command = match args.next() {
        Some(cmd) => cmd,
        None => {
            println!("nohup: missing operand");
            process::exit(1);
        }
    };

    process::exit(
        syscall(
            &command,
            &args
                // TODO: rework this abomination
                .collect::<Vec<_>>()
                .iter()
                .map(move |x| &x as &str)
                .collect::<Vec<_>>(),
            &HashMap::new(),
            true,
            &[],
        )?
        .output
        .parse()?,
    );
}
