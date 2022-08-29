use super::constants;

unsafe fn expect_success(desc: wasi::Fd, filetype_e: wasi::Filetype, size_e: u64) -> Result<(), String> {
    match wasi::fd_filestat_get(desc) {
        Ok(filestat) => {
            if filestat.filetype != filetype_e || filestat.size != size_e {
                Err(format!(
                    "In fd_filestat_get({}): ivalid syscall output (expected {{filetype: {}, size: {}}} \
                    got {{filetype: {}, size: {}}})", desc, filetype_e.raw(), size_e,
                    filestat.filetype.raw(), filestat.size))
            } else {
                Ok(())
            }
        }
        Err(e) => { Err(format!("In fd_filestat_get({}): {:?}", desc, e)) }
    }
}

pub fn test_fd_filestat_get() -> Result<(), String> {
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
        expect_success(constants::PWD_DESC, wasi::FILETYPE_DIRECTORY, constants::DIR_SIZE as u64)?;

        // check regular file
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };
        let result = expect_success(desc, wasi::FILETYPE_REGULAR_FILE, constants::SAMPLE_TEXT_LEN as u64);
        if let Err(e) = wasi::fd_close(desc){
            return Err(e.to_string());
        }
        result?;

        // check unexpanded symlink
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_LINK_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };
        let result = expect_success(desc, wasi::FILETYPE_SYMBOLIC_LINK, 4);
        if let Err(e) = wasi::fd_close(desc){
            return Err(e.to_string());
        }
        result?;

        // check expended symlink
        let desc = match wasi::path_open(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, constants::SAMPLE_LINK_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        };
        let result = expect_success(desc, wasi::FILETYPE_REGULAR_FILE, constants::SAMPLE_TEXT_LEN as u64);
        if let Err(e) = wasi::fd_close(desc){
            return Err(e.to_string());
        }
        result?;
    }
    Ok(())
}
