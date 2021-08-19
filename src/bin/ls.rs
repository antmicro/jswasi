use std::{env, fs, io};

fn main() -> io::Result<()> {
    let dir = env::args().skip(1).next().unwrap();

    let mut entries = fs::read_dir(dir)?
        .map(|res| res.map(|e| e.path()))
        .collect::<Result<Vec<_>, io::Error>>()?;

    // The order in which `read_dir` returns entries is not guaranteed. If reproducible
    // ordering is required the entries should be explicitly sorted.
    entries.sort();
    for entry in entries {
        println!("{}", entry.to_str().unwrap());
    }

    Ok(())
}
