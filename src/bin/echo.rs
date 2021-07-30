use std::env;

fn main() {
    println!("{}", env::args().skip(1).collect::<Vec<_>>().join(" "));
}
