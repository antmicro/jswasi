use std::{env, fs, io};

use std::fs::DirEntry;
use std::path::{Path, PathBuf};

fn visit_dirs(dir: &Path, current_path: &PathBuf, cb: &dyn Fn(&PathBuf, &DirEntry)) -> io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            cb(&current_path, &entry);
            if path.is_dir() {
                visit_dirs(&path, &current_path.join(entry.file_name()), cb)?;
            }
        }
    }
    Ok(())
}

fn main() -> io::Result<()> {

    #[cfg(target_os = "wasi")]
    if let Ok(path) = env::var("PWD"){
        env::set_current_dir(path).unwrap_or_else(|e| {
            eprintln!("Could not set current working dir: {}", e);
        });
    }
    let dir = env::args().nth(1).unwrap_or_else(|| String::from("."));
    visit_dirs(Path::new(&dir), &PathBuf::new(), &|current_path: &PathBuf, entry: &DirEntry| {
        println!("{}", current_path.join(entry.file_name()).display());
    })?;

    Ok(())
}
