use std::io::{Error, ErrorKind};
use super::constants;

const TEMP_FILENAME: &str = "write_file";
const TEMP_SYMLINK: &str = "write_symlink";

unsafe fn expect_success(desc: wasi::Fd, iovs: wasi::CiovecArray) -> std::io::Result<()> {
    let mut expected_len = 0;
    // maybe we souldn't calculate it each call
    for i in iovs { expected_len += i.buf_len; }
    match wasi::fd_write(desc, iovs) {
        Ok(n) => {
            if n != expected_len {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_write({}): invalid write length (expected {}, got {})",
                        desc, expected_len, n
                    )
                ));
            }
        }
        Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
    }
    Ok(())
}

unsafe fn expect_error(desc: wasi::Fd, buf: &[u8], errno: wasi::Errno, msg: &str) -> std::io::Result<()> {
    let iovs: wasi::CiovecArray = &[
        wasi::Ciovec { buf: buf.as_ptr(), buf_len: buf.len() }
    ];
    match wasi::fd_write(desc, iovs) {
        Ok(_) => {
            return Err(Error::new(
                ErrorKind::Other,
                format!(
                    "In fd_write({}): {}",
                    desc, msg
                )
            ));
        }
        Err(e) => {
            if e != errno {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_write({}): wrong error code (expected {}, got {})",
                        desc, errno.raw(), e.raw()
                    )
                ));
            }
        },
    }
    Ok(())
}

unsafe fn verify_fd_read(
    desc: wasi::Fd,
    buf_expected: &[u8],
    len_expected: usize
) -> std::io::Result<()> {
    // +1 - padding to check if fd_read reads more than it should
    let mut buf_read: Vec<u8> = vec![0; len_expected+1];
    let iovs: wasi::IovecArray = &[
        wasi::Iovec { buf: buf_read.as_mut_ptr(), buf_len: len_expected+1 }
    ];
    match wasi::fd_read(desc, iovs) {
        Ok(n) => {
            if n != len_expected {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}): invalid read length (expected {}, got {})",
                        desc, len_expected, n
                    )
                ));
            } else if &buf_read[..len_expected] != buf_expected {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}): invalid read value (expected {:?}, got {:?})",
                        desc, buf_expected, &buf_read[..len_expected]
                    )
                ));
            }
        }
        Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
    }
    Ok(())
}

pub fn test_fd_write() -> std::io::Result<()> {
    unsafe {
        // attempt to write without write permission should fail
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME, 0,
            constants::RIGHTS_ALL ^ wasi::RIGHTS_FD_WRITE, 0, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); },
        };

        let buf = "something".as_bytes();

        let result = expect_error(
            desc, buf, wasi::ERRNO_ACCES,
            "attempt to write without write permission succeeded");
        if let Err(e) = wasi::fd_close(desc){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;

        // attempt to write to invalid descriptor should fail
        expect_error(
            desc, buf, wasi::ERRNO_BADF,
            "attempt to write to invalid descriptor succeeded")?;

        // writing single buffer to a regular file should succeed
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, TEMP_FILENAME, wasi::OFLAGS_CREAT,
            constants::RIGHTS_ALL, 0, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = expect_success(desc, &[wasi::Ciovec{ buf: buf.as_ptr(), buf_len: buf.len() }]);
        if let Err(e) = wasi::fd_close(desc){
            return Err(Error::new(ErrorKind::Other, e));
        }
        if let Err(e) = result {
            if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_FILENAME) {
                return Err(Error::new(ErrorKind::Other, e));
            }
            return Err(e);
        }

        // written buffer should be read correctly
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, TEMP_FILENAME, 0,
            constants::RIGHTS_ALL, 0, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = verify_fd_read(desc, buf, buf.len());
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }
        if let Err(e) = result {
            if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_FILENAME) {
                return Err(Error::new(ErrorKind::Other, e));
            }
            return Err(e);
        }

        let buf = "symlink write".as_bytes();
        if let Err(e) = wasi::path_symlink(TEMP_FILENAME, 4, TEMP_SYMLINK) {
            return Err(Error::new(ErrorKind::Other, e));
        }

        // writing to unexpanded symlink should not succeed
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, TEMP_SYMLINK, 0,
            constants::RIGHTS_ALL, 0, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = expect_error(
            desc, buf, wasi::ERRNO_BADF,
            "attempt to write to unexpanded symlink succeeded");
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }
        if let Err(e) = result {
            if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_FILENAME) {
                return Err(Error::new(ErrorKind::Other, e));
            }
            if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_SYMLINK) {
                return Err(Error::new(ErrorKind::Other, e));
            }
            return Err(e);
        }

        // writing to expanded symlink should succeed
        let desc = match wasi::path_open(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, TEMP_SYMLINK,
            wasi::OFLAGS_TRUNC, constants::RIGHTS_ALL, 0, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = expect_success(desc, &[wasi::Ciovec{ buf: buf.as_ptr(), buf_len: buf.len() }]);
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }
        if let Err(e) = result {
            if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_FILENAME) {
                return Err(Error::new(ErrorKind::Other, e));
            }
            if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_SYMLINK) {
                return Err(Error::new(ErrorKind::Other, e));
            }
            return Err(e);
        }

        // check if written buffer can be read correctly
        let desc = match wasi::path_open(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, TEMP_FILENAME, 0,
            constants::RIGHTS_ALL, 0, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = verify_fd_read(desc, buf, buf.len());
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }
        if let Err(e) = result {
            if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_FILENAME) {
                return Err(Error::new(ErrorKind::Other, e));
            }
            if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_SYMLINK) {
                return Err(Error::new(ErrorKind::Other, e));
            }
            return Err(e);
        }

        if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_FILENAME) {
            return Err(Error::new(ErrorKind::Other, e));
        }
        if let Err(e) = wasi::path_unlink_file(constants::PWD_DESC, TEMP_SYMLINK) {
            return Err(Error::new(ErrorKind::Other, e));
        }
    }
    Ok(())
}
