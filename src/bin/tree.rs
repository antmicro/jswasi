use std::{env, fs, io};

fn main() -> io::Result<()> {
    let mut entries = fs::read_dir(env::args().skip(1).next().unwrap())?
        .map(|res| res.map(|e| e.path()))
        .collect::<Result<Vec<_>, io::Error>>()?;

    // The order in which `read_dir` returns entries is not guaranteed. If reproducible
    // ordering is required the entries should be explicitly sorted.

    entries.sort();
    println!("{:?}", entries);

    // The entries have now been sorted by their path.

    Ok(())
}
