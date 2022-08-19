mod syscalls;
use std::io::{ Error, ErrorKind, Result };
use syscalls::*;

fn main() -> Result<()>{
    let tests: Vec<(&str, fn() -> Result<()>)> = vec![
        ("environ_sizes_get", environ_sizes_get::test_environ_sizes_get as fn() -> Result<()>),
        ("args_sizes_get", args_sizes_get::test_args_sizes_get as fn() -> Result<()>),
        ("fd_prestat_get", fd_prestat_get::test_fd_prestat_get as fn() -> Result<()>),
        ("fd_fdstat_get", fd_fdstat_get::test_fd_fdstat_get as fn() -> Result<()>),
        ("fd_filestat_get", fd_filestat_get::test_fd_filestat_get as fn() -> Result<()>),
        ("fd_read", fd_read::test_fd_read as fn() -> Result<()>),
        ("fd_write", fd_write::test_fd_write as fn() -> Result<()>),
        ("fd_prestat_dir_name", fd_prestat_dir_name::test_fd_prestat_dir_name as fn() -> Result<()>),
        ("environ_get", environ_get::test_environ_get as fn() -> Result<()>),
        ("args_get", args_get::test_args_get as fn() -> Result<()>),
        ("fd_close", fd_close::test_fd_close as fn() -> Result<()>),
        ("path_open", path_open::test_path_open as fn() -> Result<()>),
        ("fd_seek", fd_seek::test_fd_seek as fn() -> Result<()>),
        ("fd_tell", fd_tell::test_fd_tell as fn() -> Result<()>),
        ("fd_readdir", fd_readdir::test_fd_readdir as fn() -> Result<()>),
    ];

    let mut fails: u32 = 0;
    for (name, test) in &tests {
        let result = test();
        if let Err(_) = result { fails += 1; }
        println!("[TEST] {}: {:?}", name, result);
    }

    unsafe {
        // teardown test environment
        wasi::path_unlink_file(constants::PWD_DESC, constants::SAMPLE_TEXT_FILENAME).unwrap();
        wasi::path_unlink_file(constants::PWD_DESC, constants::SAMPLE_LINK_FILENAME).unwrap();
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)) }
        };
        for name in fd_readdir::wasi_ls(desc, 256, true)? {
            wasi::path_unlink_file(desc, &name).unwrap();
        }
        wasi::path_remove_directory(constants::PWD_DESC, constants::SAMPLE_DIR_FILENAME).unwrap();
    }
    println!("[SUMMARY]: {} tests succeeded, {} tests failed",  tests.len() as u32 - fails, fails);
    if fails == 0 {
        Ok(())
    } else {
        Err(Error::new(ErrorKind::Other, "Tests failed"))
    }
}
