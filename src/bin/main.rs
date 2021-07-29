use rand::Rng;
use std::env;
use std::process::exit;

fn main() {
    let mut rng = rand::thread_rng();
    println!("{}", rng.gen::<u32>());

    let args: Vec<String> = env::args().collect();
    println!("args: {}", args.join(" "));
    println!("env: {:#?}", env::var("PATH").unwrap_or_else(|e| {
        println!("error: {}", e);
        exit(4);
    }));
}