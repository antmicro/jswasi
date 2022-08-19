use super::constants;

unsafe fn expect_error(
    desc: wasi::Fd,
    iovs: wasi::IovecArray,
    errno: wasi::Errno,
    msg: &str
) -> Result<(), String> {
    match wasi::fd_read(desc, iovs) {
        Ok(_) => {
            Err(format!("In fd_read({}): {}",desc, msg))
        },
        Err(e) => {
            if e != errno {
                Err(format!(
                    "In fd_read({}): wrong error code (expected {}, got {})",
                    desc, errno.raw(), e.raw()))
            } else {
                Ok(())
            }
        },
    }
}

unsafe fn check_read(
    desc: wasi::Fd,
    iovs: wasi::IovecArray,
    bufs: &[&[u8]],
    expected: &[&[u8]],
    length: usize
) -> Result<(), String> {
    match wasi::fd_read(desc, iovs) {
        Ok(len) => {
            if len == length {
                if bufs.iter().zip(expected).any(|(got, exp)| got != exp) {
                    Err(format!(
                        "In fd_read({}): invalid read value (expected {:?}, got {:?})",
                        desc, expected, bufs))
                } else {
                    Ok(())
                }
            } else {
                Err(format!(
                    "In fd_read({}): invalid read length (expected {}, got {})",
                    desc, length, len))
            }
        },
        Err(e) => { Err(format!("In fd_read({}): {}", desc, e)) }
    }
}

pub fn test_fd_read() -> Result<(), String> {
    unsafe {
        let dirflags = 0; // don't follow symlinks
        let oflags = 0;
        let fdflags = wasi::FDFLAGS_SYNC | wasi::FDFLAGS_DSYNC;

        let desc = match wasi::path_open(
            constants::PWD_DESC, dirflags, constants::SAMPLE_TEXT_FILENAME,
            oflags, constants::RIGHTS_ALL, constants::RIGHTS_ALL, fdflags) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };

        let len1: usize = constants::SAMPLE_TEXT_LEN / 2;
        let len2: usize = constants::SAMPLE_TEXT_LEN - len1;
        let mut buf1: Vec<u8> = vec![0; len1];
        let mut buf2: Vec<u8> = vec![0; len2];
        let iovs: wasi::IovecArray = &[
            wasi::Iovec { buf: buf1.as_mut_ptr(), buf_len: len1 },
            wasi::Iovec { buf: buf2.as_mut_ptr(), buf_len: len2 }
        ];

        // check if reading into two different buffers works
        let result = check_read(
            desc, iovs,
            &[&buf1, &buf2],
            &[&constants::SAMPLE_TEXT[0..len1], &constants::SAMPLE_TEXT[len1..]],
            constants::SAMPLE_TEXT_LEN);
        if let Err(e) = wasi::fd_close(desc) {
            return Err(e.to_string());
        }
        result?;

        // check if fd_read reads more bytes than it should
        let pad: usize = 8; // arbitrary buffer padding to let syscall read more than it should
        let mut buf_padding: Vec<u8>  = vec![0; constants::SAMPLE_TEXT_LEN + pad];
        let iovs: wasi::IovecArray = &[
            wasi::Iovec { buf: buf_padding.as_mut_ptr(), buf_len: constants::SAMPLE_TEXT_LEN + pad }
        ];

        let desc = match wasi::path_open(
            constants::PWD_DESC, dirflags, constants::SAMPLE_TEXT_FILENAME,
            oflags, constants::RIGHTS_ALL, constants::RIGHTS_ALL, fdflags) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };
        // empty expected buffer arrays mean that we don't check if buffers are correct
        let result = check_read(desc, iovs, &[], &[], constants::SAMPLE_TEXT_LEN);
        if let Err(e) = wasi::fd_close(desc) {
            return Err(e.to_string());
        }
        result?;

        // attempt to read without read permissions should fail
        let desc = match wasi::path_open(
            constants::PWD_DESC, dirflags, constants::SAMPLE_TEXT_FILENAME, oflags,
            constants::RIGHTS_ALL ^ wasi::RIGHTS_FD_READ, constants::RIGHTS_ALL, fdflags) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };
        let result = expect_error(
            desc, iovs, wasi::ERRNO_ACCES,
            "attempt to read without read permission succeeded");
        if let Err(e) = wasi::fd_close(desc) {
            return Err(e.to_string());
        }
        result?;

        // attempt to read from invalid descriptor should fail
        expect_error(
            desc, iovs, wasi::ERRNO_BADF,
            "attempt to read from invalid descriptor succeeded")?;

        // attempt to read from directory should fail
        let desc = match wasi::path_open(
            constants::PWD_DESC, dirflags, constants::SAMPLE_DIR_FILENAME,
            wasi::OFLAGS_DIRECTORY, constants::RIGHTS_ALL, constants::RIGHTS_ALL, fdflags) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };
        let result = expect_error(
            desc, iovs, wasi::ERRNO_ISDIR,
            "attempt to read from directory succeeded");
        if let Err(e) = wasi::fd_close(desc) {
            return Err(e.to_string());
        }
        result?;

        // attempt to read from unexpanded symlink should fail
        let desc = match wasi::path_open(
            constants::PWD_DESC, dirflags, constants::SAMPLE_LINK_FILENAME,
            oflags, constants::RIGHTS_ALL, constants::RIGHTS_ALL, fdflags) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };
        let result = expect_error(
            desc, iovs, wasi::ERRNO_INVAL,
            "attempt to read from unexpanded symlink succeeded");
        if let Err(e) = wasi::fd_close(desc) {
            return Err(e.to_string());
        }
        result?;

        // attempt to read from expanded symlink should succeed
        let desc = match wasi::path_open(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, constants::SAMPLE_LINK_FILENAME,
            oflags, constants::RIGHTS_ALL, constants::RIGHTS_ALL, fdflags) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };
        let result = check_read(
            desc, iovs, &[&buf_padding[..constants::SAMPLE_TEXT_LEN]],
            &[&constants::SAMPLE_TEXT], constants::SAMPLE_TEXT_LEN);
        if let Err(e) = wasi::fd_close(desc) {
            return Err(e.to_string());
        }
        result?;

        // we check for ERRNO_ACCES here, because stdout and stderr don't have read rights
        // if these fds had this access, error should be ERRNO_INVAL
        // attempt to read from stdout should fail
        expect_error(1, iovs, wasi::ERRNO_ACCES, "attempt to read from stdout succeeded")?;

        // attempt to read from stderr should fail
        expect_error(2, iovs, wasi::ERRNO_ACCES, "attempt to read from stderr succeeded")?;
    }
    Ok(())
}
