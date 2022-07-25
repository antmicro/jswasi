use std::io::{Error, ErrorKind};
use super::constants;

pub fn test_fd_read() -> std::io::Result<()> {
    unsafe {
        let dirflags = 0; // don't follow symlinks
        let path = "text";
        let oflags = 0;
        let fdflags = wasi::FDFLAGS_SYNC | wasi::FDFLAGS_DSYNC;

        let desc = wasi::path_open(4, dirflags, path, oflags, constants::RIGHTS_ALL, constants::RIGHTS_ALL, fdflags).unwrap();

        const LEN1: usize = constants::SAMPLE_TEXT_LEN / 2;
        const LEN2: usize = constants::SAMPLE_TEXT_LEN - LEN1;
        let mut buf1: [u8; LEN1] = [0; LEN1];
        let mut buf2: [u8; LEN2] = [0; LEN2];
        let iovs: wasi::IovecArray = &[
            wasi::Iovec { buf: buf1.as_mut_ptr(), buf_len: LEN1 },
            wasi::Iovec { buf: buf2.as_mut_ptr(), buf_len: LEN2 }
        ];

        // check if reading into two different buffers works
        match wasi::fd_read(desc, iovs) {
            Ok(constants::SAMPLE_TEXT_LEN) => {
                if buf1 != constants::SAMPLE_TEXT[0..LEN1] ||
                    buf2 != constants::SAMPLE_TEXT[LEN1..] {
                    return Err(Error::new(
                        ErrorKind::Other,
                        format!(
                            "In fd_read({}): invalid output (expected {:?}, got {:?})",
                            desc, constants::SAMPLE_TEXT, [buf1, buf2].concat()
                        )
                    ));
                }
            },
            Ok(len) => {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}): invalid read length (expected {}, got {})",
                        desc, constants::SAMPLE_TEXT_LEN, len
                    )
                ));
            }
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        }
        wasi::fd_close(desc).unwrap();

        const PAD: usize = 8;
        let mut buf_padding: [u8; constants::SAMPLE_TEXT_LEN + PAD] = [0; constants::SAMPLE_TEXT_LEN + PAD];
        let iovs: wasi::IovecArray = &[
            wasi::Iovec { buf: buf_padding.as_mut_ptr(), buf_len: constants::SAMPLE_TEXT_LEN + PAD }
        ];
        let desc = wasi::path_open(4, dirflags, path, oflags, constants::RIGHTS_ALL, constants::RIGHTS_ALL, fdflags).unwrap();

        // check if fd_read reads more bytes than it should
        match wasi::fd_read(desc, iovs) {
            Ok(constants::SAMPLE_TEXT_LEN) => {},
            Ok(len) => {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}): invalid read length (expected {}, got {})",
                        desc, constants::SAMPLE_TEXT_LEN, len
                    )
                ));
            }
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        }
        wasi::fd_close(desc).unwrap();

        let desc = wasi::path_open(
            4, dirflags, path, oflags,
            constants::RIGHTS_ALL ^ wasi::RIGHTS_FD_READ, constants::RIGHTS_ALL, fdflags).unwrap();

        // attempt to read without read permissions
        match wasi::fd_read(desc, iovs) {
            Ok(_) => {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}): attempt to read without read permission succeeded",
                        desc
                    )
                ));
            }
            Err(wasi::ERRNO_ACCES) => {}
            Err(e) => {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}): wrong error code (expected {}, got {})",
                        desc, wasi::ERRNO_ACCES.raw(), e.raw()
                    )
                ));
            },
        }
        wasi::fd_close(desc).unwrap();

        // attempt to read from invalid descriptor
        match wasi::fd_read(desc, iovs) {
            Ok(_) => {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}): attempt to read from invalid descriptor succeeded",
                        desc
                    )
                ));
            }
            Err(wasi::ERRNO_BADF) => {}
            Err(e) => {
                return Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_read({}): wrong error code (expected {}, got {})",
                        desc, wasi::ERRNO_BADF.raw(), e.raw()
                    )
                ));
            },
        }
    }
    Ok(())
}
