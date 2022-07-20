use std::io::{Error, ErrorKind};

unsafe fn expect_success(desc: wasi::Fd, expected: wasi::Fdstat) -> std::io::Result<()>{
    match wasi::fd_fdstat_get(desc) {
        Ok(fdstat) => {
            if expected.fs_filetype != fdstat.fs_filetype || expected.fs_flags != fdstat.fs_flags
                || expected.fs_rights_base != fdstat.fs_rights_base || expected.fs_rights_inheriting != fdstat.fs_rights_inheriting {
                Err(Error::new(ErrorKind::Other, format!(
                    "In fd_fdstat_get({:?}): invalid syscall output (\
                    expected {{fs_filetype: {:?}, fs_flags: {:?}, fs_rights_base: {:?}, fs_rights_inheriting: {:?}}}, \
                    got {{fs_filetype: {:?}, fs_flags: {:?}, fs_rights_base: {:?}, fs_rights_inheriting: {:?}}})",
                    desc,
                    expected.fs_filetype.raw(), expected.fs_flags, expected.fs_rights_base, expected.fs_rights_inheriting,
                    fdstat.fs_filetype.raw(), fdstat.fs_flags, fdstat.fs_rights_base, fdstat.fs_rights_inheriting)
                ))
            } else {
                Ok(())
            }
        }
        Err(e) => {
            Err(Error::new(ErrorKind::Other, e))
        }
    }
}

pub fn test_fd_fdstat_get() -> std::io::Result<()>{
    unsafe {
        // check character devices
        expect_success(0, wasi::Fdstat{
            fs_filetype: wasi::FILETYPE_CHARACTER_DEVICE,
            fs_flags: 0,
            fs_rights_base: 136315027,
            fs_rights_inheriting: 0
        })?;
        expect_success(1, wasi::Fdstat{
            fs_filetype: wasi::FILETYPE_CHARACTER_DEVICE,
            fs_flags: wasi::FDFLAGS_APPEND,
            fs_rights_base: 136315089,
            fs_rights_inheriting: 0
        })?;
        expect_success(2, wasi::Fdstat{
            fs_filetype: wasi::FILETYPE_CHARACTER_DEVICE,
            fs_flags: wasi::FDFLAGS_APPEND,
            fs_rights_base: 136315089,
            fs_rights_inheriting: 0
        })?;

        // check fdstats of preopened descriptors
        // for now, all preopened descriptors have all rights
        // this doesn't apply to inherited descriptors
        expect_success(3, wasi::Fdstat{
            fs_filetype: wasi::FILETYPE_DIRECTORY,
            fs_flags: 0,
            fs_rights_base: 0x1fff_ffff,
            fs_rights_inheriting: 0x1fff_ffff
        })?;

        // test sample directory
        let dirflags = wasi::LOOKUPFLAGS_SYMLINK_FOLLOW;
        let path = "tmp";
        let oflags = wasi::OFLAGS_DIRECTORY;
        let rights_base = 123;
        let rights_inheriting = 321;
        let fdflags = 0;
        let desc = match wasi::path_open(4, dirflags, path, oflags, rights_base, rights_inheriting, fdflags){
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = expect_success(desc, wasi::Fdstat{
            fs_filetype: wasi::FILETYPE_DIRECTORY,
            fs_flags: fdflags,
            fs_rights_base: rights_base,
            fs_rights_inheriting: rights_inheriting,
        });
        if let Err(e) = wasi::fd_close(desc){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;

        // test regular file
        let path = "text";
        let oflags = 0;
        let fdflags = wasi::FDFLAGS_APPEND | wasi::FDFLAGS_SYNC | wasi::FDFLAGS_DSYNC;
        let desc = match wasi::path_open(4, dirflags, path, oflags, rights_base, rights_inheriting, fdflags) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = expect_success(desc, wasi::Fdstat{
            fs_filetype: wasi::FILETYPE_REGULAR_FILE,
            fs_flags: fdflags,
            fs_rights_base: rights_base,
            fs_rights_inheriting: rights_inheriting,
        });
        if let Err(e) = wasi::fd_close(desc){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;

        // test symbolic link
        let path = "link";
        let desc = match wasi::path_open(4, dirflags, path, oflags, rights_base, rights_inheriting, fdflags) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)); }
        };
        let result = expect_success(desc, wasi::Fdstat{
            fs_filetype: wasi::FILETYPE_REGULAR_FILE,
            fs_flags: fdflags,
            fs_rights_base: rights_base,
            fs_rights_inheriting: rights_inheriting,
        });
        if let Err(e) = wasi::fd_close(desc){
            return Err(Error::new(ErrorKind::Other, e));
        }
        result?;
    }
    Ok(())
}
