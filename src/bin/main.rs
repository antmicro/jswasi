use std::io;

fn main() {
    let mut stdin = io::stdin();
    let mut stdout = io::stdout();

    io::copy(&mut stdin, &mut stdout).unwrap();
}
