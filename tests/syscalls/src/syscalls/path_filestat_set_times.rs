use super::constants;
use super::fd_filestat_set_times::check_times;
use super::fd_filestat_set_times::fd_check_times;

struct Test {
    root_fd: wasi::Fd,
    dir_fd: wasi::Fd,
    dir_path: String,
    file_fd: wasi::Fd,
    file_path: String,
    dir_symlink_fd: wasi::Fd,
    dir_symlink_path: String,
    file_symlink_fd: wasi::Fd,
    file_symlink_path: String,
    invalid_path: String,
}

impl Test {
    pub unsafe fn tear_down(&self) -> Result<(), String> {
        for fd in [self.dir_fd, self.file_fd, self.dir_symlink_fd, self.file_symlink_fd] {
            if let Err(e) = wasi::fd_close(fd) { return Err(e.to_string()); }
        }
        for path in [&self.file_path, &self.file_symlink_path, &self.dir_symlink_path] {
            if let Err(e) = wasi::path_unlink_file(self.root_fd, path) {
                return Err(format!("Could not tear down test environment: {:?}", e));
            }
        }
        if let Err(e) = wasi::path_remove_directory(self.root_fd, &self.dir_path) {
            return Err(format!("Could not tear down test environment: {:?}", e));
        }
        Ok(())
    }

    pub unsafe fn run_tests(&self) -> Result<(), String> {
        for (fd, path, link_fd, link_path) in [
            (self.dir_fd, &self.dir_path, self.dir_symlink_fd, &self.dir_symlink_path),
            (self.file_fd, &self.file_path, self.file_symlink_fd, &self.file_symlink_path)
        ] {
            // change should be observable using both fd_filestat_get and path_filestat_get
            expect_success(self.root_fd, 0, path, 0, 0, wasi::FSTFLAGS_ATIM | wasi::FSTFLAGS_MTIM)?;
            fd_check_times(fd, Some(0), Some(0))?;
            path_check_times(self.root_fd, 0, path, Some(0), Some(0))?;

            // setting only mtim or only atim should work
            expect_success(self.root_fd, 0, path, 123, 123, wasi::FSTFLAGS_ATIM)?;
            fd_check_times(fd, Some(123), Some(0))?;
            path_check_times(self.root_fd, 0, path, Some(123), Some(0))?;
            expect_success(self.root_fd, 0, path, 0, 123, wasi::FSTFLAGS_MTIM)?;
            fd_check_times(fd, Some(123), Some(123))?;
            path_check_times(self.root_fd, 0, path, Some(123), Some(123))?;

            // setting times with conflicting flags should fail
            expect_error(
                self.root_fd, 0, path, 321, 321, wasi::FSTFLAGS_ATIM | wasi::FSTFLAGS_ATIM_NOW,
                wasi::ERRNO_INVAL, "attempt to set times with conflicting flags succeeded")?;
            expect_error(
                self.root_fd, 0, path, 321, 321, wasi::FSTFLAGS_MTIM | wasi::FSTFLAGS_MTIM_NOW,
                wasi::ERRNO_INVAL, "attempt to set times with conflicting flags succeeded")?;

            // setting current time should work
            expect_success(self.root_fd, 0, path, 321, 321, wasi::FSTFLAGS_ATIM_NOW | wasi::FSTFLAGS_MTIM_NOW)?;

            // symlinks
            expect_success(
                self.root_fd, 0, link_path, 456, 456,
                wasi::FSTFLAGS_ATIM | wasi::FSTFLAGS_MTIM)?;
            fd_check_times(link_fd, Some(456), Some(456))?;
            path_check_times(self.root_fd, 0, link_path, Some(456), Some(456))?;
            expect_success(
                self.root_fd, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW, link_path,
                321, 321, wasi::FSTFLAGS_ATIM | wasi::FSTFLAGS_MTIM)?;
            fd_check_times(link_fd, Some(456), Some(456))?;
            path_check_times(self.root_fd, 0, link_path, Some(456), Some(456))?;
            fd_check_times(fd, Some(321), Some(321))?;
            path_check_times(self.root_fd, 0, path, Some(321), Some(321))?;
        }

        // invalid path
        expect_error(
            self.root_fd, 0, &self.invalid_path, 0, 0, wasi::FSTFLAGS_ATIM | wasi::FSTFLAGS_MTIM,
            wasi::ERRNO_INVAL, "attempt to set times for invalid file path succeeded")?;
        // invalid root fd
        expect_error(
            match wasi::path_open(
                self.root_fd, 0, &self.dir_path, 0,
                constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
                Ok(d) => {
                    if let Err(e) = wasi::fd_close(d) { return Err(e.to_string()); }
                    d
                },
                Err(e) => { return Err(e.to_string()); }
            }, 0, &self.file_path, 0, 0, wasi::FSTFLAGS_ATIM | wasi::FSTFLAGS_MTIM,
            wasi::ERRNO_BADF, "attempt to set file times using invalid descriptor succeeded")?;

        Ok(())
    }
}

unsafe fn path_check_times(
    fd: wasi::Fd,
    lookupflags: wasi::Lookupflags,
    path: &str,
    atim_ex: Option<wasi::Timestamp>,
    mtim_ex: Option<wasi::Timestamp>
) -> Result<(), String> {
    check_times(match wasi::path_filestat_get(fd, lookupflags, path) {
        Ok(filestat) => filestat,
        Err(e) => { return Err(e.to_string()); }
    }, atim_ex, mtim_ex)
}


unsafe fn expect_success(
    fd: wasi::Fd,
    lookupflags: wasi::Lookupflags,
    path: &str,
    atim: wasi::Timestamp,
    mtim: wasi::Timestamp,
    fst_flags: wasi::Fstflags
) -> Result<(), String> {
    if let Err(e) = wasi::path_filestat_set_times(fd, lookupflags, path, atim, mtim, fst_flags) {
        Err(format!(
            "In path_filestat_set_times({}, {}, {}, {}, {}, {}): {:?}",
            fd, lookupflags, path, atim, mtim, fst_flags, e))
    } else { Ok(()) }
}

unsafe fn expect_error(
    fd: wasi::Fd,
    lookupflags: wasi::Lookupflags,
    path: &str,
    atim: wasi::Timestamp,
    mtim: wasi::Timestamp,
    fst_flags: wasi::Fstflags,
    errno: wasi::Errno,
    msg: &str
) -> Result<(), String> {
    match wasi::path_filestat_set_times(fd, lookupflags, path, atim, mtim, fst_flags) {
        Ok(()) => {
            Err(format!(
                "In path_filestat_set_times({}, {}, {}, {}, {}, {}): {}",
                fd, lookupflags, path, atim, mtim, fst_flags, msg))
        },
        Err(e) => {
            if e == errno {
                Ok(())
            } else {
                Err(format!(
                    "In path_filestat_set_times({}, {}, {}, {}, {}, {}): \
                        unexpected error code (expected {}, got {})",
                    fd, lookupflags, path, atim, mtim, fst_flags, errno, e))
            }
        }
    }
}

pub fn test_path_filestat_set_times() -> Result<(), String> {
    unsafe {
        let file_path = String::from("path_set_times_file");
        let dir_path = String::from("path_set_times_dir");
        let file_symlink_path = String::from("path_set_times_file_link");
        let dir_symlink_path = String::from("path_set_times_dir_link");
        let invalid_path = String::from("path_set_times_invalid");
        if let Err(e) = wasi::path_create_directory(constants::PWD_DESC, &dir_path) {
            return Err(e.to_string());
        }
        if let Err(e) = wasi::path_symlink(&file_path, constants::PWD_DESC, &file_symlink_path) {
            return Err(e.to_string());
        }
        if let Err(e) = wasi::path_symlink(&dir_path, constants::PWD_DESC, &dir_symlink_path) {
            return Err(e.to_string());
        }

        let dir_fd = match wasi::path_open(
            constants::PWD_DESC, 0, &dir_path, wasi::OFLAGS_DIRECTORY,
            constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
        ) {
            Ok(desc) => desc,
            Err(e) => { return Err(e.to_string()); }
        };
        let file_fd = match wasi::path_open(
            constants::PWD_DESC, 0, &file_path, wasi::OFLAGS_CREAT,
            constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
        ) {
            Ok(desc) => desc,
            Err(e) => { return Err(e.to_string()); }
        };

        let dir_symlink_fd = match wasi::path_open(
            constants::PWD_DESC, 0, &dir_symlink_path, 0,
            constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
        ) {
            Ok(desc) => desc,
            Err(e) => { return Err(e.to_string()); }
        };

        let file_symlink_fd = match wasi::path_open(
            constants::PWD_DESC, 0, &file_symlink_path, 0,
            constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
        ) {
            Ok(desc) => desc,
            Err(e) => { return Err(e.to_string()); }
        };

        let test = Test {
            root_fd: constants::PWD_DESC,
            dir_fd,
            dir_path,
            file_fd,
            file_path,
            dir_symlink_fd,
            dir_symlink_path,
            file_symlink_fd,
            file_symlink_path,
            invalid_path,
        };

        let result = test.run_tests();
        test.tear_down()?;
        result
    }
}
