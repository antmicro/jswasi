use std::process::Command;
use std::str;
use std::{
    env,
    error::Error,
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};

fn main() -> Result<(), Box<dyn Error>> {
    let hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .expect("Failed getting commit hash from git")
        .stdout;

    let out_dir = env::var("OUT_DIR")?;
    let hash_path = Path::new(&out_dir).join("shell-commit-hash.txt");
    let mut f = BufWriter::new(File::create(&hash_path)?);
    write!(
        f,
        "{}",
        str::from_utf8(&hash).expect("Unexpected output from git command")
    )?;

    let dest_path = Path::new(&out_dir).join("shell-commit-hash.txt");
    let mut f = BufWriter::new(File::create(&dest_path)?);
    write!(
        f,
        "{}",
        str::from_utf8(&hash).expect("Unexpected output from git command")
    )?;

    Ok(())
}
