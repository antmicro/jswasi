use std::io::{Error, ErrorKind};
use super::constants;

pub fn test_fd_close() -> std::io::Result<()> {
    unsafe {
        let result = wasi::path_open(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW,
            constants::SAMPLE_DIR_FILENAME, wasi::OFLAGS_DIRECTORY,
            constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0);
        let desc: wasi::Fd;
        if let Err(e) = result {
            return Err(Error::new(ErrorKind::Other, e));
        } else { desc = result.unwrap(); }

        // closing a directory descriptor should succeed
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(
                ErrorKind::Other,
                format!(
                    "In fd_close({}): attemt to close a directory descriptor failed ({:?})",
                    desc, e)));
        }

        let result = wasi::path_open(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW,
            constants::SAMPLE_TEXT_FILENAME, 0,
            constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0);
        let desc: wasi::Fd;
        if let Err(e) = result {
            return Err(Error::new(ErrorKind::Other, e));
        } else { desc = result.unwrap(); }

        // closing a regular file descriptor should succeed
        if let Err(e) = wasi::fd_close(desc) {
            return Err(Error::new(
                ErrorKind::Other,
                format!(
                    "In fd_close({}): attemt to close a file descriptor failed ({:?})",
                    desc, e)));
        }

        // attemt to close invalid descriptor should fail
        match wasi::fd_close(desc) {
            Ok(_) => {
            return Err(Error::new(
                ErrorKind::Other,
                format!(
                    "In fd_close({}): attemt to close invalid descriptor succeeded",
                    desc)));
            },
            Err(e) => {
                if e != wasi::ERRNO_BADF {
                    return Err(Error::new(
                        ErrorKind::Other,
                        format!(
                            "In fd_close({}): invalid error code (expected {}, got {})",
                            desc, wasi::ERRNO_BADF.raw(), e.raw())));
                }
            }
        }
    }
    Ok(())
}
