use std::io::{Error, ErrorKind};
use super::constants;

unsafe fn expect_success(desc: wasi::Fd, expected: wasi::Filesize, close: bool) -> std::io::Result<()> {
    // close - close the descriptor in case the test fails
    match wasi::fd_tell(desc) {
        Ok(n) => {
            if n != expected {
                if close { if let Err(e) = wasi::fd_close(desc) {
                    return Err(Error::new(ErrorKind::Other, e));
                }}
                Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_tell({}): invalid file position (expected {}, got {})",
                        desc, expected, n)))
            } else {
                Ok(())
            }
        }
        Err(e) => {
            if close { if let Err(e) = wasi::fd_close(desc) {
                return Err(Error::new(ErrorKind::Other, e));
            }}
            Err(Error::new(ErrorKind::Other, format!("In fd_tell({}): {:?}", desc, e)))
        }
    }
}

unsafe fn expect_error(desc: wasi::Fd, errno: wasi::Errno, msg: &str, close: bool) -> std::io::Result<()> {
    // close - close the descriptor in case the test fails
    match wasi::fd_tell(desc) {
        Ok(_) => {
            if close { if let Err(e) = wasi::fd_close(desc) {
                return Err(Error::new(ErrorKind::Other, e));
            }}
            Err(Error::new(ErrorKind::Other, format!("In fd_tell({}): {}", desc, msg)))
        },
        Err(e) => {
            if e != errno {
                if close { if let Err(e) = wasi::fd_close(desc) {
                    return Err(Error::new(ErrorKind::Other, e));
                }}
                Err(Error::new(
                    ErrorKind::Other,
                    format!("In fd_tell({}): wrong error code (expected {} got {})", desc, errno.raw(), e.raw())))
            } else {
                Ok(())
            }
        }
    }
}

pub fn test_fd_tell() -> std::io::Result<()> {
    unsafe {
        // attempt to fd_tell a directory should fail
        expect_error(constants::PWD_DESC, wasi::ERRNO_BADF, "attempt to fd_tell a directory succeeded", false)?;

        // character devices should not have fd_tell rights
        expect_error(0, wasi::ERRNO_ACCES, "attempt to fd_tell stdin succeeded", false)?;
        expect_error(1, wasi::ERRNO_ACCES, "attempt to fd_tell stdout succeeded", false)?;
        expect_error(2, wasi::ERRNO_ACCES, "attempt to fd_tell stderr succeeded", false)?;

        // fd_tell should work on regular file
        let desc = match wasi::path_open(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, constants::SAMPLE_TEXT_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0){
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, format!("In path open() {}", e))); }
        };
        expect_success(desc, 0, true)?;

        // fd_tell should point a different position after reading
        let chr: *mut u8 = &mut 0;
        if let Err(e) = wasi::fd_read(desc, &[wasi::Iovec { buf: chr, buf_len: 1 }]) {
            return Err(Error::new(ErrorKind::Other, e));
        }
        expect_success(desc, 1, true)?;

        //fd_tell should not work on invalid descriptor
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }
        expect_error(desc, wasi::ERRNO_BADF, "attemt to fd_tell an invalid descriptor succeeded", false)?;

        // fd tell should fail on a regular file without access
        let desc = match wasi::path_open(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, constants::SAMPLE_TEXT_FILENAME,
            0, constants::RIGHTS_ALL ^ wasi::RIGHTS_FD_TELL,
            constants::RIGHTS_ALL ^ wasi::RIGHTS_FD_TELL, 0){
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        expect_error(desc, wasi::ERRNO_ACCES, "attempt to fd_tell without permission succeeded", true)?;
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }

        // attempt to fd_tell unexpanded symlink should succeed
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_LINK_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0){
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, format!("In path open() {}", e))); }
        };
        expect_success(desc, 0, true)?;
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }
    }
    Ok(())
}
