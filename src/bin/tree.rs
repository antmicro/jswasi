use std::{env, fs, io};

use std::fs::DirEntry;
use std::path::Path;

fn visit_dirs(dir: &Path, cb: &dyn Fn(&DirEntry)) -> io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                visit_dirs(&path, cb)?;
            } else {
                cb(&entry);
            }
        }
    }
    Ok(())
}

fn main() -> io::Result<()> {
    let dir = env::args().skip(1).next().unwrap();

    visit_dirs(Path::new(&dir), &|entry: &DirEntry| {
        println!("{}", entry.path().to_str().unwrap());
    })?;

    Ok(())
}
