use constants;

const INVALID_PATH: &str = "invalid";

unsafe fn expect_success(
    fd: wasi::Fd,
    flags: wasi::Lookupflags,
    path: &str,
    filetype_e: wasi::Filetype,
    size_e: u64
) -> Result<(), String> {
    match wasi::path_filestat_get(fd, flags, path) {
        Ok(filestat) => {
            if filestat.filetype != filetype_e || filestat.size != size_e {
                Err(format!(
                    "In path_filestat_get({}, {}, {}): ivalid syscall output \
                    (expected {{filetype: {}, size: {}}} \
                    got {{filetype: {}, size: {}}})", fd, flags, path, filetype_e.raw(), size_e,
                    filestat.filetype.raw(), filestat.size))
            } else {
                Ok(())
            }
        }
        Err(e) => { Err(format!("In fd_filestat_get({}): {:?}", fd, e)) }
    }
}

unsafe fn expect_error(
    fd: wasi::Fd,
    flags: wasi::Lookupflags,
    path: &str,
    errno: wasi::Errno,
    msg: &str
) -> Result<(), String> {
    match wasi::path_filestat_get(fd, flags, path) {
        Ok(_) => {
            Err(format!(
                "In path_filestat_get({}, {}, {}): {}",
                fd, flags, path, msg))
        },
        Err(e) => {
            if e == errno {
                Ok(())
            } else {
                Err(format!(
                    "In path_filestat_get({}, {}, {}): unexpected error code (expected {}, got {})",
                    fd, flags, path, errno, e))
            }
        }
    }
}

pub fn test_path_filestat_get() -> Result<(), String> {
    unsafe {
        // check text file
        expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
            wasi::FILETYPE_REGULAR_FILE, constants::SAMPLE_TEXT_LEN as u64)?;

        // check directory
        expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
            wasi::FILETYPE_DIRECTORY, constants::DIR_SIZE as u64)?;

        // check expanded symlinks
        expect_success(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, constants::SAMPLE_LINK_FILENAME,
            wasi::FILETYPE_REGULAR_FILE, constants::SAMPLE_TEXT_LEN as u64)?;
        expect_success(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, constants::SAMPLE_DIR_LINK_FILENAME,
            wasi::FILETYPE_DIRECTORY, constants::DIR_SIZE as u64)?;

        // check unexpanded symlinks
        expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_LINK_FILENAME,
            wasi::FILETYPE_SYMBOLIC_LINK, constants::SAMPLE_TEXT_FILENAME.len() as u64)?;
        expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_LINK_FILENAME,
            wasi::FILETYPE_SYMBOLIC_LINK, constants::SAMPLE_DIR_FILENAME.len() as u64)?;

        // path_filestat_get should fail for invalid path
        expect_error(
            constants::PWD_DESC, 0, INVALID_PATH, wasi::ERRNO_NOENT,
            "syscall succeeded with invalid path")?;

        // path_filestat_get should fail for invalid descriptor
        let dummy_fd = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => {
                if let Err(e) = wasi::fd_close(d) { return Err(e.to_string()) }
                d
            },
            Err(e) => return Err(e.to_string())
        };
        expect_error(
            dummy_fd, 0, INVALID_PATH, wasi::ERRNO_BADF,
            "syscall succeeded with invalid file descriptor")?;

        // path_filestat_get should fail without rights
        let no_access_fd = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME, 0,
            constants::RIGHTS_ALL ^ wasi::RIGHTS_PATH_FILESTAT_GET, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => return Err(e.to_string())
        };
        expect_error(
            no_access_fd, 0, &*format!("{}0", constants::SAMPLE_DIRENTRY_NAME), wasi::ERRNO_ACCES,
            "syscall succeeded without required permissions")?;
        if let Err(e) = wasi::fd_close(no_access_fd) { return Err(e.to_string()) }
    }
    Ok(())
}
