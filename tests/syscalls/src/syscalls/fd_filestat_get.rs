use std::io::{Error, ErrorKind};
use super::constants;

unsafe fn expect_success(desc: wasi::Fd, filetype_e: wasi::Filetype, size_e: u64) -> std::io::Result<()> {
    match wasi::fd_filestat_get(desc) {
        Ok(filestat) => {
            if filestat.filetype != filetype_e || filestat.size != size_e {
                Err(Error::new(
                    ErrorKind::Other,
                    format!(
                        "In fd_filestat_get({}): ivalid syscall output (expected {{filetype: {}, size: {}}} \
                        got {{filetype: {}, size: {}}})", desc, filetype_e.raw(), size_e,
                        filestat.filetype.raw(), filestat.size)))

            } else {
                Ok(())
            }
        }
        Err(e) => { return Err(Error::new(ErrorKind::Other, e)) }
    }
}

pub fn test_fd_filestat_get() -> std::io::Result<()> {
    /* filestat struct in fact has more fields than we test here
     * all fields: (dev, ino, filetype, nlink, size, atim, mtim, ctim)
     * we only test filetype and size
     * we ignore dev and ino, because we haven't yet implemented storing any information on that
     * nlink is a hard link counter, hard links are not yet implemented in rust-shell
     * atim, mtim, ctim are values associated with access, modification and creation time, testing it is irrelevant
     */
    unsafe {
        // check character device
        expect_success(1, wasi::FILETYPE_CHARACTER_DEVICE, 0)?;

        // check preopened directory
        expect_success(4, wasi::FILETYPE_DIRECTORY, 4096)?;

        // check regular file
        let desc = match wasi::path_open(4, 0, "text", 0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)) }
        };
        let result = expect_success(desc, wasi::FILETYPE_REGULAR_FILE, 12);
        if let Err(e) = wasi::fd_close(desc){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;

        // check unexpanded symlink
        let desc = match wasi::path_open(4, 0, "link", 0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)) }
        };
        let result = expect_success(desc, wasi::FILETYPE_SYMBOLIC_LINK, 4);
        if let Err(e) = wasi::fd_close(desc){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;

        // check expended symlink
        let desc = match wasi::path_open(4, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, "link", 0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)) }
        };
        let result = expect_success(desc, wasi::FILETYPE_REGULAR_FILE, 12);
        if let Err(e) = wasi::fd_close(desc){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;
    }
    Ok(())
}
