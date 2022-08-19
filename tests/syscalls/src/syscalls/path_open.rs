use super::constants;

const DUMMY_FILE: &str = "dummy_file";
const DUMMY_DIR: &str = "dummy_dir";
const NO_FILE: &str = "not_a_file";

unsafe fn teardown() {
    if let Err(_) = wasi::path_remove_directory(constants::PWD_DESC, DUMMY_DIR) {}
    if let Err(_) = wasi::path_unlink_file(constants::PWD_DESC, DUMMY_FILE) {}
}

unsafe fn expect_success(
    desc: wasi::Fd,
    dirflags: wasi::Lookupflags,
    path: &str,
    open_flags: wasi::Oflags,
    rights_base: wasi::Rights,
    rights_inheriting: wasi::Rights,
    fdflags: wasi::Fdflags,
    msg: &str
) -> Result<wasi::Fd, String> {
    match wasi::path_open(
        desc, dirflags, path,
        open_flags, rights_base, rights_inheriting, fdflags
    ) {
        Ok(desc) => Ok(desc),
        Err(e) => {
            Err(format!(
                "In path_open({}, {}, {}, {}, {}, {}, {}): {} ({})",
                desc, dirflags, path, open_flags, rights_base, rights_inheriting, fdflags, msg, e))
        }
    }
}

unsafe fn expect_error(
    desc: wasi::Fd,
    dirflags: wasi::Lookupflags,
    path: &str,
    open_flags: wasi::Oflags,
    rights_base: wasi::Rights,
    rights_inheriting: wasi::Rights,
    fdflags: wasi::Fdflags,
    errno: wasi::Errno,
    msg: &str
) -> Result<(), String> {
    match wasi::path_open(
        desc, dirflags, path,
        open_flags, rights_base, rights_inheriting, fdflags
    ) {
        Ok(desc) => {
            if let Err(_) = wasi::path_unlink_file(desc, path) {}
            if let Err(e) = wasi::fd_close(desc) {
                Err(e.to_string())
            } else {
                Err(format!("In path_open({}, {}, {}, {}, {}, {}, {}): {}",
                    desc, dirflags, path, open_flags, rights_base, rights_inheriting, fdflags, msg))
            }
        },
        Err(e) => {
            if e != errno {
                Err(format!(
                    "In path_open({}, {}, {}, {}, {}, {}, {}): unexpected error code (expected {}, got {})",
                    desc, dirflags, path, open_flags, rights_base,
                    rights_inheriting, fdflags, errno.raw(), e.raw()))
            } else { Ok(()) }
        }
    }
}
pub fn test_path_open() -> Result<(), String> {
    unsafe {
        // attempt to open a directory should succeed
        let desc = expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
            wasi::OFLAGS_DIRECTORY, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to open a regular directory failed")?;
        if let Err(e) = wasi::fd_close(desc) { return Err(e.to_string()); }

        // attempt to open a regular file should succeed
        let desc = expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to open a regular file failed")?;
        if let Err(e) = wasi::fd_close(desc) { return Err(e.to_string()); }

        // attempt to open and expand symlink should succeed
        let desc = expect_success(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, constants::SAMPLE_LINK_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to open and expand symlink failed")?;
        if let Err(e) = wasi::fd_close(desc) { return Err(e.to_string()); }

        // attempt to open symlink should succeed
        let desc = expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_LINK_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to open a symlink failed")?;
        if let Err(e) = wasi::fd_close(desc) { return Err(e.to_string()); }

        // attempt to open nonexistent file without CREAT flag should fail
        expect_error(
            constants::PWD_DESC, 0, NO_FILE,
            wasi::OFLAGS_DIRECTORY, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            wasi::ERRNO_NOENT, "Attempt to open nonexistent file without CREAT flag succeeded")?;

        // attempt to open existing file with CREAT and EXCL flags should fail
        expect_error(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
            wasi::OFLAGS_CREAT | wasi::OFLAGS_EXCL, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            wasi::ERRNO_EXIST, "Attempt to open existing file with CREAT and EXCL flags succeeded")?;

        // attempt to open file with directory flag should fail
        expect_error(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
            wasi::OFLAGS_DIRECTORY, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            wasi::ERRNO_NOTDIR, "Attempt to open a file with directory flag succeeded")?;

        // creating files should work
        let desc = match expect_success(
            constants::PWD_DESC, 0, DUMMY_FILE,
            wasi::OFLAGS_CREAT, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to create a regular file failed") {
            Ok(d) => d,
            Err(e) => {
                teardown();
                return Err(e);
            }
        };
        if let Err(e) = wasi::fd_close(desc) { return Err(e.to_string()); }

        // attempt to create a directory using CREAT and DIRECTORY flags should fail
        if let Err(e) = expect_error(
            constants::PWD_DESC, 0, DUMMY_DIR,
            wasi::OFLAGS_CREAT | wasi::OFLAGS_DIRECTORY, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            wasi::ERRNO_INVAL, "Attempt to create a file with directory flag succeeded") {
            teardown();
            return Err(e);
        }
        teardown();
    }
    Ok(())
}
