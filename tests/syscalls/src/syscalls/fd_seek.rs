use std::io::{Error, ErrorKind};
use super::constants;

unsafe fn expect_success(
    desc: wasi::Fd,
    offset: wasi::Filedelta,
    whence: wasi::Whence,
    expected_pos: wasi::Filesize
) -> std::io::Result<()> {
    match wasi::fd_seek(desc, offset, whence) {
        Ok(n) => {
            if n != expected_pos {
                Err(Error::new(
                    ErrorKind::Other,
                    format!("In fd_seek({}, {}, {}): invalid resulting position (expected {}, got {})",
                    desc, offset, whence.raw(), expected_pos, n)))
            } else {
                Ok(())
            }
        },
        Err(e) => { Err(Error::new(ErrorKind::Other, format!("In fd_seek({}, {}, {}): {}", desc, offset, whence.raw(), e))) },
    }
}

unsafe fn expect_error(
    desc: wasi::Fd,
    offset:wasi::Filedelta,
    whence: wasi::Whence,
    errno:wasi::Errno,
    msg: &str
) -> std::io::Result<()> {
    match wasi::fd_seek(desc, offset, whence) {
        Ok(_) => {
            Err(
                Error::new(
                    ErrorKind::Other,
                    format!("In fd_seek({}, {}, {}): {}", desc, offset, whence.raw(), msg)))
        }
        Err(e) => {
            if e != errno {
                Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_seek({}, {}, {}): wrong error code (expected {}, got {})",
                        desc, offset, whence.raw(), errno.raw(), e.raw()
                    )
                ))
            } else {
                Ok(())
            }
        }
    }
}

pub fn test_fd_seek() -> std::io::Result<()> {
    unsafe {
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)) },
        };

        // character devices should not have fd_seek access
        expect_error(
            0, 0, wasi::WHENCE_SET, wasi::ERRNO_ACCES,
            "character devices should not have seek rights")?;
        expect_error(
            1, 0, wasi::WHENCE_SET, wasi::ERRNO_ACCES,
            "character devices should not have seek rights")?;
        expect_error(
            2, 0, wasi::WHENCE_SET, wasi::ERRNO_ACCES,
            "character devices should not have seek rights")?;

        // seeking forward from start should work
        expect_success(desc, 1, wasi::WHENCE_SET, 1)?;

        // seeking backwards from start should fail
        expect_error(
            desc, -1, wasi::WHENCE_SET, wasi::ERRNO_INVAL,
            "moving backwards from start of the file succeeded")?;

        // seeking forward from end should work (should move normally)
        expect_success(desc, 1, wasi::WHENCE_END, (constants::SAMPLE_TEXT_LEN + 1) as u64)?;

        // seeking backward from end should work
        expect_success(desc, -1, wasi::WHENCE_END, (constants::SAMPLE_TEXT_LEN - 1) as u64)?;

        // seeking backwards from current position should work
        expect_success(desc, -5, wasi::WHENCE_CUR, (constants::SAMPLE_TEXT_LEN - 1 - 5) as u64)?;

        // seeking forward from current position should work
        expect_success(desc, 5, wasi::WHENCE_CUR, (constants::SAMPLE_TEXT_LEN - 1) as u64)?;

        // reading after seeking should work
        let chr: *mut u8 = &mut 0;
        if let Err(e) = wasi::fd_read(desc, &[wasi::Iovec{ buf: chr, buf_len: 1 }]) {
            return Err(Error::new(ErrorKind::Other, e));
        }
        if *chr != constants::SAMPLE_TEXT[constants::SAMPLE_TEXT_LEN - 1] {
            return Err(
                Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}), invalid read value (expected {}, got {})",
                        desc, constants::SAMPLE_TEXT[constants::SAMPLE_TEXT_LEN - 1], *chr)));
        }
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }

        // seeking with invalid whence should fail (it is impossible to pass invalid whence using this lib)

        // seeking invalid descriptor should fail
        expect_error(
            desc, 0, wasi::WHENCE_SET, wasi::ERRNO_BADF,
            "attempt to seek an invalid descriptor succeeded")?;

        // seeking a directory should fail
        expect_error(
            constants::PWD_DESC, 0, wasi::WHENCE_SET, wasi::ERRNO_BADF,
            "attempt to seek a directory succeeded")?;

        // seeking unexpanded symlink should work
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_LINK_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)) },
        };
        expect_success(desc, 1, wasi::WHENCE_SET, 1)?;
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(ErrorKind::Other, e));
        }
    }
    Ok(())
}
