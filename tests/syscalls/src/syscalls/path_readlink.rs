use constants;
use std::str;

const BUF_SIZE: usize = 128;
const INVALID_PATH: &str = "invalid_path";

unsafe fn expect_success(fd: wasi::Fd, path: &str, expected: &str) -> Result<(), String> {
    let mut buf = vec![0u8; BUF_SIZE];
    match wasi::path_readlink(fd, path, buf.as_mut_ptr(), BUF_SIZE) {
        Ok(len) => {
            if str::from_utf8(&buf[0..len]).unwrap() == expected {
                Ok(())
            } else {
                Err(format!(
                    "In fd_readlink({}, {}, {:?}, {}): unexpected link contents (expected {}, got {})",
                    fd, path, buf.as_mut_ptr(), BUF_SIZE, expected, str::from_utf8(&buf[0..len]).unwrap()))
            }
        },
        Err(e) => {
            Err(format!("In fd_readlink({}, {}, {:?}, {}): {:?}", fd, path, buf.as_mut_ptr(), BUF_SIZE, e))
        }
    }
}

unsafe fn expect_error(fd: wasi::Fd, path: &str, errno: wasi::Errno, msg: &str) -> Result<(), String> {
    let mut buf = vec![0u8; BUF_SIZE];
    match wasi::path_readlink(fd, path, buf.as_mut_ptr(), BUF_SIZE) {
        Ok(_) => {
            Err(format!(
                "In path_readlink({}, {}, {:?}, {}): {}",
                fd, path, buf.as_mut_ptr(), BUF_SIZE, msg))
        },
        Err(e) => {
            if e == errno {
                Ok(())
            } else {
                Err(format!(
                    "In path_readlink({}, {}, {:?}, {}): unexpected error code (expected {}, got {})",
                    fd, path, buf.as_mut_ptr(), BUF_SIZE, errno.raw(), e.raw()))
            }
        }
    }
}

pub fn test_path_readlink() -> Result<(), String> {
    unsafe {
        // readink on symlinks should work
        expect_success(constants::PWD_DESC, constants::SAMPLE_LINK_FILENAME, constants::SAMPLE_TEXT_FILENAME)?;
        expect_success(constants::PWD_DESC, constants::SAMPLE_DIR_LINK_FILENAME, constants::SAMPLE_DIR_FILENAME)?;

        // readlink on directory should fail
        expect_error(
            constants::PWD_DESC, constants::SAMPLE_DIR_FILENAME, wasi::ERRNO_INVAL,
            "Attempt to read a directory as a symlink succeeded")?;

        // readlink on text file should fail
        expect_error(
            constants::PWD_DESC, constants::SAMPLE_TEXT_FILENAME, wasi::ERRNO_INVAL,
            "Attempt to read a text file as a symlink succeeded")?;

        // readlink on invalid path should fail
        expect_error(
            constants::PWD_DESC, INVALID_PATH, wasi::ERRNO_INVAL,
            "Attempt to read a text file as a symlink succeeded")?;

        // readlink on invalid descriptor should fail
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
            dummy_fd, INVALID_PATH, wasi::ERRNO_BADF,
            "Attemt to read link from invalid descriptor succeeded")?;
    }
    Ok(())
}
