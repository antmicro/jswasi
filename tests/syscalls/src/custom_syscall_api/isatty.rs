#[cfg(target_os = "wasi")]
use constants;

#[cfg(target_os = "wasi")]
fn expect_success(fd: i32, expected: bool) -> Result<(), String> {
    match wasi_ext_lib::isatty(fd) {
        Ok(is_tty) => {
            if expected == is_tty {
                Ok(())
            } else {
                Err(format!(
                    "In isatty({}): unexpected output (expected: {}, got {})",
                    fd, expected, is_tty))
            }
        }
        Err(e) => Err(format!(
            "In isatty({}): syscall failed unexpectedly (error code: {})",
            fd, e))
    }
}

#[cfg(target_os = "wasi")]
fn expect_error(fd: i32, errno: i32, msg: &str) -> Result<(), String> {
    match wasi_ext_lib::isatty(fd) {
        Ok(_) => Err(format!(
            "In isatty({}): {}",
            fd, msg)),
        Err(e) => {
            if e == errno {
                Ok(())
            } else {
                Err(format!(
                    "In isatty({}): unexpected error code (expected {}, got {})",
                    fd, errno, e))
            }
        }
    }
}

#[cfg(target_os = "wasi")]
pub fn test_isatty() -> Result<(), String> {
    // check directory
    expect_success(constants::PWD_DESC as i32, false)?;

    // check regular file
    let text_fd = match unsafe {
        wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
        )
    } {
        Ok(d) => d,
        Err(e) => return Err(e.to_string())
    };
    expect_success(text_fd as i32, false)?;

    // check stdin, stdout, stderr
    expect_success(0, true)?;
    expect_success(1, true)?;
    expect_success(2, true)?;

    // check invalid descriptor
    let dummy_fd = unsafe { match wasi::path_open(
        constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
        0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
        Ok(d) => {
            if let Err(e) = wasi::fd_close(d) { return Err(e.to_string()) }
            d
        },
        Err(e) => return Err(e.to_string())
    }};
    expect_error(dummy_fd as i32, wasi::ERRNO_BADF.raw().into(), "attempt to check invalid file descriptor succeeded")?;
    Ok(())
}
