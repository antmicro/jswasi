use constants;
use std::env;
use std::fs;

struct Test {
    base_cwd: String,
    dir_path: String,
    file_path: String,
    long_dir: String,
    long_file: String
}

impl Test {
    fn tear_down(&self) -> Result<(), String> {
        if let Err(e) = wasi_ext_lib::chdir(&self.base_cwd) {
            return Err(format!("Couldn't tear down test environment: Couldn't change working directory (error code: {})", e));
        }
        if let Err(e) = unsafe { wasi::path_remove_directory(constants::PWD_DESC, &self.long_dir) } {
            return Err(format!("Couldn't tear down test environment: Couldn't remove {} (error: {:?})", &self.long_dir, e));
        }
        if let Err(e) = unsafe { wasi::path_unlink_file(constants::PWD_DESC, &self.long_file) } {
            return Err(format!("Couldn't tear down test environment: Couldn't remove {} (error: {:?})", &self.long_file, e));
        }
        Ok(())
    }
    fn run_tests(&self) -> Result<(), String> {
        // assume that cwd of parent process is stored in PWD
        getcwd_success(Some(&self.base_cwd))?;
        chdir_success(&self.base_cwd)?;

        // change directory
        let tmp = fs::canonicalize(&self.dir_path).unwrap();
        let realpath = tmp.to_str().unwrap();
        chdir_success(&self.dir_path)?;
        getcwd_success(Some(&realpath))?;
        chdir_success(&self.base_cwd)?;

        // attempt to chdir to a text file
        chdir_error(&self.file_path, wasi::ERRNO_NOTDIR.raw().into(), "attempt to chdir to a text file succeeded")?;
        getcwd_success(Some(&self.base_cwd))?;

        // check against very long directory name
        let tmp = fs::canonicalize(&self.long_dir).unwrap();
        let realpath = tmp.to_str().unwrap();
        chdir_success(&self.long_dir)?;
        getcwd_success(Some(&realpath))?;
        chdir_success(&self.base_cwd)?;

        // test against very long file name
        chdir_error(&self.long_file, wasi::ERRNO_NOTDIR.raw().into(), "attempt to chdir to a text file succeeded")?;
        getcwd_success(Some(&self.base_cwd))?;
        chdir_success(&self.base_cwd)?;
        Ok(())
    }
    fn try_setup() -> Result<Self, String> {
        let long_dir = "a".repeat(1025);
        if let Err(e) = unsafe { wasi::path_create_directory(constants::PWD_DESC, &long_dir) } {
            return Err(format!("Could not setup test environment: {:?}", e));
        }
        let long_file = "b".repeat(2049);
        if let Err(e) = unsafe { wasi::path_open(
            constants::PWD_DESC, 0, &long_file, wasi::OFLAGS_CREAT,
            constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) } {
            return Err(format!("Could not setup test environment: {:?}", e));
        }
        let base_cwd = match env::var("PWD") {
            Ok(pwd) => pwd,
            Err(e) => { return Err(format!("Could not setup test environment: {:?}", e)); }
        };
        Ok(Test {
            base_cwd,
            dir_path: String::from(constants::SAMPLE_DIR_FILENAME),
            file_path: String::from(constants::SAMPLE_TEXT_FILENAME),
            long_dir,
            long_file
        })
    }
}

fn chdir_success(path: &str) -> Result<(), String> {
    match wasi_ext_lib::chdir(path) {
        Ok(()) => Ok(()),
        Err(e) => {
            Err(format!(
                "In chdir({}): syscall failed unexpectedly (error code: {})",
                path, e))
        }
    }
}

fn getcwd_success(expected: Option<&str>) -> Result<(), String> {
    match wasi_ext_lib::getcwd() {
        Ok(path) => {
            if expected.is_none() || &path == expected.unwrap() {
                Ok(())
            } else {
                Err(format!(
                    "In getcwd(): unexpected output (expected {}, got {})",
                    expected.unwrap(), path))
            }
        }
        Err(e) => {
            Err(format!(
                "In getcwd(): syscall failed unexpectedly (error code: {})",
                e))
        }
    }
}

fn chdir_error(path: &str, errno: i32, msg: &str) -> Result<(), String> {
    match wasi_ext_lib::chdir(path) {
        Ok(()) => Err(format!("In chdir(\"{}\"): {}", path, msg)),
        Err(e) => {
            if e == errno {
                Ok(())
            } else {
                Err(format!(
                    "In chdir({}): unexpected error code (expected {}, got {})",
                    path, errno, e))
            }
        }
    }
}

pub fn test_getcwd_chdir() -> Result<(), String> {
    let test = Test::try_setup()?;
    let result = test.run_tests();
    if let Err(e) = test.tear_down() { eprintln!("{}", e); }
    result
}
