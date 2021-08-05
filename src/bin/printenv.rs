use std::env;
use std::process::exit;

fn main() {
    let args: Vec<String> = env::args().collect();
    println!("args: {}", args.join(" "));
    println!(
        "env: RUST_BACKTRACE={}",
        env::var("RUST_BACKTRACE").unwrap_or_else(|e| {
            println!("error: {}", e);
            exit(4);
        })
    );
    println!(
        "env: PATH={}",
        env::var("PATH").unwrap_or_else(|e| {
            println!("error: {}", e);
            exit(4);
        })
    );
    println!(
        "env: X={}",
        env::var("X").unwrap_or_else(|e| {
            println!("error: {}", e);
            exit(4);
        })
    );
}
