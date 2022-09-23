use super::constants;

struct Test {
    root_fd: wasi::Fd,
    dir_fds: [wasi::Fd; 2],
    dir_path: String,
    file_fds: [wasi::Fd; 2],
    file_path: String,
    no_permission_fd: wasi::Fd,
}

impl Test {
    pub unsafe fn tear_down(&self) -> Result<(), String> {
        for fd in [self.dir_fds, self.file_fds].iter().flatten().chain([self.no_permission_fd].iter()) {
            if let Err(e) = wasi::fd_close(*fd) {
                return Err(format!("Could not tear down test environment: {:?}", e));
            }
        }
        if let Err(e) = wasi::path_unlink_file(self.root_fd, &self.file_path) {
            return Err(format!("Could not tear down test environment: {:?}", e));
        }
        if let Err(e) = wasi::path_remove_directory(self.root_fd, &self.dir_path) {
            return Err(format!("Could not tear down test environment: {:?}", e));
        }
        Ok(())
    }

    pub unsafe fn run_tests(&self) -> Result<(), String> {
        // setting both mtim and atim of a regular file should work
        // changing times on one descriptor should change times on all descriptors
        for (fds, path) in [(&self.file_fds, &self.file_path), (&self.dir_fds, &self.dir_path)] {
            expect_success(fds[0], 0u64, 0u64, wasi::FSTFLAGS_MTIM | wasi::FSTFLAGS_ATIM)?;
            check_times(fds[0], Some(0u64), Some(0u64))?;
            check_times(fds[1], Some(0u64), Some(0u64))?;

            // setting only mtim or only mtim or only atim of a regular file should work
            expect_success(fds[0], 123u64, 123u64, wasi::FSTFLAGS_ATIM)?;
            check_times(fds[0], Some(123u64), Some(0u64))?;
            check_times(fds[1], Some(123u64), Some(0u64))?;
            expect_success(fds[1], 0u64, 123u64, wasi::FSTFLAGS_MTIM)?;
            check_times(fds[0], Some(123u64), Some(123u64))?;
            check_times(fds[1], Some(123u64), Some(123u64))?;

            // changed times should be readable from a new descriptor
            match wasi::path_open(
                self.root_fd, 0, path, 0,
                constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
            ) {
                Ok(desc) => {
                    expect_success(fds[1], 321u64, 321u64, wasi::FSTFLAGS_MTIM | wasi::FSTFLAGS_ATIM)?;
                    check_times(desc, Some(321u64), Some(321u64))?;
                    if let Err(e) = wasi::fd_close(desc) { return Err(e.to_string()); }
                },
                Err(e) => { return Err(e.to_string()); }
            }

            // setting times of invalid descriptor should fail
            match wasi::path_open(
                self.root_fd, 0, path, 0,
                constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
            ) {
                Ok(desc) => {
                    if let Err(e) = wasi::fd_close(desc) { return Err(e.to_string()); }
                    expect_error(
                        desc, 0u64, 0u64, wasi::FSTFLAGS_MTIM | wasi::FSTFLAGS_ATIM,
                        wasi::ERRNO_BADF, "attempt to set times of invalid descriptor succeeded")?;
                }
                Err(e) => { return Err(e.to_string()); }
            }

            // setting times with conflicting flags should fail
            expect_error(
                fds[0], 0u64, 0u64, wasi::FSTFLAGS_ATIM | wasi::FSTFLAGS_ATIM_NOW,
                wasi::ERRNO_INVAL, "attempt to set times with conflicting flags succeeded")?;
            expect_error(
                fds[0], 0u64, 0u64, wasi::FSTFLAGS_MTIM | wasi::FSTFLAGS_MTIM_NOW,
                wasi::ERRNO_INVAL, "attempt to set times with conflicting flags succeeded")?;

            // setting times to current time should work
            // verifying if these times are set correctly is problematic
            expect_success(fds[0], 0u64, 0u64, wasi::FSTFLAGS_ATIM_NOW | wasi::FSTFLAGS_MTIM_NOW)?;

            // attempt to set times without permissions should fail
        }
        expect_error(
            self.no_permission_fd, 0u64, 0u64, wasi::FSTFLAGS_ATIM,
            wasi::ERRNO_ACCES, "attempt to set times with no permissions succeeded")?;
        Ok(())
    }
}

unsafe fn expect_success(
    fd: wasi::Fd,
    atim: wasi::Timestamp,
    mtim: wasi::Timestamp,
    fst_flags: wasi::Fstflags
) -> Result<(), String> {
    if let Err(e) = wasi::fd_filestat_set_times(fd, atim, mtim, fst_flags) {
        Err(format!(
            "In fd_filestat_set_times({}, {}, {}, {}): {:?}",
            fd, atim, mtim, fst_flags, e))
    } else { Ok(()) }
}

unsafe fn expect_error(
    fd: wasi::Fd,
    atim: wasi::Timestamp,
    mtim: wasi::Timestamp,
    fst_flags: wasi::Fstflags,
    errno: wasi::Errno,
    msg: &str
) -> Result<(), String> {
    match wasi::fd_filestat_set_times(fd, atim, mtim, fst_flags) {
        Ok(()) => {
            Err(format!(
                "In fd_filestat_set_times({}, {}, {}, {}): {}",
                fd, atim, mtim, fst_flags, msg))
        },
        Err(e) => {
            if e == errno {
                Ok(())
            } else {
                Err(format!(
                    "In fd_filestat_set_times({}, {}, {}, {}): unexpected error code (expected {}, got {})",
                    fd, atim, mtim, fst_flags, errno, e))
            }
        }
    }
}

unsafe fn check_times(
    fd: wasi::Fd,
    atim_ex: Option<wasi::Timestamp>,
    mtim_ex: Option<wasi::Timestamp>,
) -> Result<(), String> {
    let filestat = match wasi::fd_filestat_get(fd) {
        Ok(filestat) => filestat,
        Err(e) => { return Err(e.to_string()) }
    };
    if let Some(m) = mtim_ex {
        if m != filestat.mtim {
            return Err(format!(
                "Unexpected mtim (expected {}, got {})",
                m, filestat.mtim))
        }
    }
    if let Some(a) = atim_ex {
        if a != filestat.atim {
            return Err(format!(
                "Unexpected atim (expected {}, got {})",
                a, filestat.atim))
        }
    }
    Ok(())
}

pub fn test_fd_filestat_set_times() -> Result<(), String> {
    unsafe {
        let file_path = String::from("fd_set_times_file");
        let dir_path = String::from("fd_set_times_dir");
        if let Err(e) = wasi::path_create_directory(constants::PWD_DESC, &dir_path) {
            return Err(e.to_string());
        }

        let mut file_fds: [wasi::Fd; 2] = [0; 2];
        let mut dir_fds: [wasi::Fd; 2] = [0; 2];
        for i in 0..2 {
            dir_fds[i] = match wasi::path_open(
                constants::PWD_DESC, 0, &dir_path, wasi::OFLAGS_DIRECTORY,
                constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
            ) {
                Ok(desc) => desc,
                Err(e) => { return Err(e.to_string()); }
            };
            file_fds[i] = match wasi::path_open(
                constants::PWD_DESC, 0, &file_path, wasi::OFLAGS_CREAT,
                constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0
            ) {
                Ok(desc) => desc,
                Err(e) => { return Err(e.to_string()); }
            };
        }

        let no_permission_fd = match wasi::path_open(
            constants::PWD_DESC, 0, &dir_path, wasi::OFLAGS_DIRECTORY,
            constants::RIGHTS_ALL ^ wasi::RIGHTS_FD_FILESTAT_SET_TIMES,
            constants::RIGHTS_ALL ^ wasi::RIGHTS_FD_FILESTAT_SET_TIMES, 0
        ) {
            Ok(desc) => desc,
            Err(e) => { return Err(e.to_string()); }
        };
        let test = Test {
            root_fd: constants::PWD_DESC,
            dir_fds,
            dir_path,
            file_fds,
            file_path,
            no_permission_fd
        };
        let result = test.run_tests();
        test.tear_down()?;
        result
    }
}
