use std::io::{Error, ErrorKind};
use super::constants;

unsafe fn expect_success(desc: wasi::Fd, name_len_ex: usize, tag_ex: u8) -> std::io::Result<()> {
    match wasi::fd_prestat_get(desc) {
        Err(e) => { return Err(Error::new(ErrorKind::Other, e)); },
        Ok(prestat) => {
            // In wasmer, len is 2 because of \0 char, should we include this char too?
            if prestat.u.dir.pr_name_len != name_len_ex || prestat.tag != tag_ex {
                Err(Error::new(ErrorKind::Other, format!(
                    "In fd_prestat_get({}): invalid syscall output \
                        (expected {{pr_name_len: {}, tag: {}}}, got {{pr_name_len: {}, tag: {}}})",
                    desc, name_len_ex, tag_ex, prestat.u.dir.pr_name_len, prestat.tag)))
            } else {
                Ok(())
            }
        }
    }
}

unsafe fn expect_error(desc: wasi::Fd, errno: wasi::Errno, msg: &str) -> std::io::Result<()> {
    match wasi::fd_prestat_get(desc) {
        Ok(_) => {
            Err(Error::new(ErrorKind::Other, format!("In fd_prestat_get({}): {}", desc, msg)))
        }
        Err(e) => {
            if e != errno {
                Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_prestat_get({}): wrong error message (expected {}, got {})",
                        desc, errno.raw(), e.raw())))
            } else {
                Ok(())
            }
        }
    }
}

pub fn test_fd_prestat_get() -> std::io::Result<()> {
    unsafe {
        // check character devices
        expect_error(0, wasi::ERRNO_BADF, "Character device cannot be a preopened directory")?;
        expect_error(1, wasi::ERRNO_BADF, "Character device cannot be a preopened directory")?;
        expect_error(2, wasi::ERRNO_BADF, "Character device cannot be a preopened directory")?;

        // check preopened directories
        expect_success(3, 1, 0)?;
        expect_success(4, 1, 0)?;

        // check non-preopened directory
        let new_fd = match wasi::path_open(
            4, 0,
            "tmp", wasi::OFLAGS_DIRECTORY, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(fd) => { fd },
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = expect_error(new_fd, wasi::ERRNO_BADF, "descriptor should not be preopened");
        if let Err(e) = wasi::fd_close(new_fd){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;

        // check non-preopened file
        let new_fd = match wasi::path_open(
            4, 0,
            "text", 0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(fd) => { fd },
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = expect_error(new_fd, wasi::ERRNO_BADF, "descriptor should not be preopened");
        if let Err(e) = wasi::fd_close(new_fd){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;

        // check invalid descriptor
        expect_error(new_fd, wasi::ERRNO_BADF, "attempt to invoke a syscall with invalid file descriptor succeeded")?;
    }
    Ok(())
}
