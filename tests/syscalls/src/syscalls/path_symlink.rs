use super::constants;
use std::str;

struct Test<'a> {
    root_fd: wasi::Fd,
    dir_path: &'a str,
    dir_link: &'a str,
    dir_path_abs: &'a str,
    dir_link_abs: &'a str,
    file_path: &'a str,
    file_link: &'a str,
    file_path_abs: &'a str,
    file_link_abs: &'a str,
    invalid_path: &'a str,
    dummy_links: Vec<&'a str>
}
impl Test<'_> {
    unsafe fn tear_down(&self) {
        for path in [self.dir_link, self.dir_link_abs, self.file_link, self.file_link_abs]
            .iter().chain(self.dummy_links.iter()) {
            _ = wasi::path_unlink_file(self.root_fd, path);
        }
    }
    unsafe fn run_tests(&self) -> Result<(), String> {
        // creating symlinks to existing directory or text file should work
        expect_success(self.dir_path, self.root_fd, self.dir_link)?;
        check_contents(self.root_fd, self.dir_link, self.dir_path)?;
        expect_success(self.file_path, self.root_fd, self.file_link)?;
        check_contents(self.root_fd, self.file_link, self.file_path)?;

        // creating symlinks to existing directory or text file using absolute paths should work
        expect_success(self.dir_path_abs, self.root_fd, self.dir_link_abs)?;
        check_contents(self.root_fd, self.dir_link_abs, self.dir_path_abs)?;
        expect_success(self.file_path_abs, self.root_fd, self.file_link_abs)?;
        check_contents(self.root_fd, self.file_link_abs, self.file_path_abs)?;

        // creating symlinks to invalid files should work
        expect_success(self.invalid_path, self.root_fd, self.dummy_links[0])?;

        // creating symlinks from invalid fd should fail
        let dummy_fd = match wasi::path_open(
            self.root_fd, 0, constants::SAMPLE_DIR_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(fd) => {
                match wasi::fd_close(fd) {
                    Ok(_) => fd,
                    Err(e) => return Err(e.to_string())
                }
            },
            Err(e) => return Err(e.to_string())
        };
        expect_error(
            self.invalid_path, dummy_fd, self.dummy_links[1], wasi::ERRNO_BADF,
            "attempt to create symlink using invalid file descriptor succeeded")?;

        // creating a symlink on a path that already exists should fail
        expect_error(
            self.invalid_path, self.root_fd, self.file_path, wasi::ERRNO_EXIST,
            "attempt to create symlink at path that already exists succeeded")?;

        expect_error(
            self.invalid_path, self.root_fd, self.dir_path, wasi::ERRNO_EXIST,
            "attempt to create symlink at path that already exists succeeded")?;
        Ok(())
    }
}
unsafe fn expect_success(
    old_path: &str,
    fd: wasi::Fd,
    new_path: &str
) -> Result<(), String> {
    if let Err(e) = wasi::path_symlink(old_path, fd, new_path) {
        Err(format!("In path_symlink({}, {}, {}): {:?}", old_path, fd, new_path, e))
    } else { Ok(()) }
}

unsafe fn expect_error(
    old_path: &str,
    fd: wasi::Fd,
    new_path: &str,
    errno: wasi::Errno,
    msg: &str
) -> Result<(), String> {
    match wasi::path_symlink(old_path, fd, new_path) {
        Ok(_) => {
            Err(format!("In path_symlink({}, {}, {}): {}", old_path, fd, new_path, msg))
        },
        Err(e) => {
            if e == errno {
                Ok(())
            } else {
                Err(format!(
                    "In path_symlink({}, {}, {}): unexpected error code (expected {}, got {})",
                    old_path, fd, new_path, errno, e))
            }
        }
    }
}

unsafe fn check_contents(
    fd: wasi::Fd,
    link_path: &str,
    expected: &str
) -> Result<(), String> {
    let len = expected.len() + 1;
    let mut buf = vec![0u8; len];
    match wasi::path_readlink(fd, link_path, buf.as_mut_ptr(), len) {
        Ok(l) => {
            // in case some runtime adds \0 on the end
            if (l == len || l == len - 1) && str::from_utf8(&buf[0..len-1]).unwrap() == expected {
                Ok(())
            } else {
                Err(format!(
                    "In path_readlink({}, {}, {:?}, {}): unexpected link contents (expected {}, got {})",
                    fd, link_path, buf.as_mut_ptr(), len, expected, str::from_utf8(&buf[0..l]).unwrap()))
            }
        },
        Err(e) => {
            Err(format!("In path_readlink({}, {}, {:?}, {}): {:?}", fd, link_path, buf.as_mut_ptr(), len, e))
        }
    }
}

pub fn test_path_symlink() -> Result<(), String> {
    unsafe {
        let test = Test {
            root_fd: constants::PWD_DESC,
            dir_path: constants::SAMPLE_DIR_FILENAME,
            dir_link: "path_symlink_dir_link",
            dir_path_abs: constants::SAMPLE_DIR_FILENAME_ABS,
            dir_link_abs: "path_symlink_dir_link_abs",
            file_path: constants::SAMPLE_TEXT_FILENAME,
            file_link: "path_symlink_file_link",
            file_path_abs: constants::SAMPLE_TEXT_FILENAME_ABS,
            file_link_abs: "path_symlink_file_link_abs",
            invalid_path: "invalid_path",
            dummy_links: vec!["dummy_link1", "dummy_link2"]
        };
        let result = test.run_tests();
        test.tear_down();
        result
    }
}
