use constants;

struct Test {
    fds: Vec<wasi::Fd>,
    root_fd: wasi::Fd,
    dummy_file: String,
    dummy_dir: String,
    no_file: String
}

impl Test {
    pub fn new(dummy_file: &str, dummy_dir: &str, no_file: &str) -> Self {
        Self {
            fds: Vec::new(),
            root_fd: constants::PWD_DESC,
            dummy_file: dummy_file.to_string(),
            dummy_dir: dummy_dir.to_string(),
            no_file: no_file.to_string()
        }
    }
    pub unsafe fn tear_down(&self) -> Result<(), String>{
        for fd in &self.fds {
            if let Err(e) = wasi::fd_close(*fd) {
                return Err(e.to_string())
            }
        }
        for file in [&self.dummy_file, &self.dummy_dir] {
            _ = wasi::path_unlink_file(self.root_fd, file);
        }
        Ok(())
    }
    pub unsafe fn run_tests(&mut self) -> Result<(), String> {
        // attempt to open a directory should succeed
        self.fds.push(expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
            wasi::OFLAGS_DIRECTORY, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to open a regular directory failed")?);

        // attempt to open a regular file should succeed
        self.fds.push(expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to open a regular file failed")?);

        // attempt to open and expand symlink should succeed
        self.fds.push(expect_success(
            constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, constants::SAMPLE_LINK_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to open and expand symlink failed")?);

        // attempt to open symlink should succeed
        self.fds.push(expect_success(
            constants::PWD_DESC, 0, constants::SAMPLE_LINK_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to open a symlink failed")?);

        // attempt to open nonexistent file without CREAT flag should fail
        expect_error(
            constants::PWD_DESC, 0, &self.no_file,
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

        // attempt to open an existing directory with CREAT and EXCL flags should return ERRNO_EXIST
        expect_error(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
            wasi::OFLAGS_CREAT | wasi::OFLAGS_EXCL, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            wasi::ERRNO_EXIST, "attempt to open existing directory with CREAT and EXCL succeeded")?;

        // creating files should work
        self.fds.push(expect_success(
            constants::PWD_DESC, 0, &self.dummy_file,
            wasi::OFLAGS_CREAT, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            "Attempt to create a regular file failed")?);

        // attempt to create a directory using CREAT and DIRECTORY flags should fail
        expect_error(
            constants::PWD_DESC, 0, &self.dummy_dir,
            wasi::OFLAGS_CREAT | wasi::OFLAGS_DIRECTORY, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0,
            wasi::ERRNO_INVAL, "Attempt to create a file with directory flag succeeded")?;

        Ok(())
    }
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
            _ = wasi::path_unlink_file(desc, path);
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
        let mut test = Test::new("dummy_file", "dummy_dir", "not_a_file");
        let result = test.run_tests();
        test.tear_down()?;
        result
    }
}
