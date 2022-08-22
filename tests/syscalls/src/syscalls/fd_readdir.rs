use std::convert::TryInto;
use std::collections::HashMap;
use std::mem::size_of;
use super::constants;

#[derive(Debug)]
pub struct Dirent {
    pub d_next: wasi::Dircookie,
    pub d_ino: wasi::Inode,
    pub d_namlen: wasi::Dirnamlen,
    pub d_type: u8,
}

impl PartialEq for Dirent {
    fn eq(&self, other: &Self) -> bool {
        // cookie order is different for different runtimes, so checking it isn't necessary
        // so far we don't implement inode numbers in wash, so we don't check if it matche
        self.d_namlen == other.d_namlen && self.d_type == other.d_type
    }
}

fn cmp_dirent_maps(map1: &HashMap<String, Dirent>, map2: &HashMap<String, Dirent>) -> bool {
    map1.len() == map2.len() && map1.keys().all(|k| {
        let cmp = map2.contains_key(k) && map1[k] == map2[k];
        cmp
    })
}

pub unsafe fn wasi_ls(
    desc: wasi::Fd,
    buf_len: usize,
    d_cookie: u64,
    read_all: bool
) -> Result<(HashMap<String, Dirent>, u64), String> {
    let mut dirents: HashMap<String, Dirent> = HashMap::new();
    let mut buf: Vec<u8> = vec![0; buf_len];
    let mut cookie: u64 = d_cookie;
    loop {
        let n_read = match wasi::fd_readdir(desc, buf.as_mut_ptr(), buf_len, cookie) {
            Ok(r) => r,
            Err(e) => { return Err(format!(
                "In fd_readdir({}, {:?}, {}, {}): {:?}",
                desc, buf.as_mut_ptr(), buf_len, cookie, e))
            }
        };
        let mut offset = 0;
        'inner: loop {
            let cookie_tmp = if offset + 8 < n_read {
                u64::from_le_bytes(buf[offset..offset+8].try_into().unwrap())
            } else { break 'inner };
            offset+=8;
            
            let inode = if offset + 8 < n_read {
                u64::from_le_bytes(buf[offset..offset+8].try_into().unwrap())
            } else { break 'inner };
            offset+=8;
            let name_len = if offset + 4 < n_read {
                u32::from_le_bytes(buf[offset..offset+4].try_into().unwrap())
            } else { break 'inner };
            offset+=4;
            let filetype = if offset + 4 < n_read { // filetype size is 1 byte + 3 bytes of padding
                u32::from_le_bytes(buf[offset..offset+4].try_into().unwrap())
            } else { break 'inner };
            offset+=4;
            let filename = if offset + name_len as usize <= n_read {
                let slice = &buf[offset..offset+name_len as usize];
                if slice.contains(&0u8) {
                    return Err(format!("In fd_readdir: nul byte in file name: {:?}", slice));
                }
                std::str::from_utf8(slice).unwrap()
            } else { break 'inner };
            offset += name_len as usize;
            cookie = cookie_tmp;
            let dirent = Dirent {
                d_next: cookie,
                d_ino: inode,
                d_namlen: name_len,
                d_type: filetype as u8,
            };
            dirents.insert(String::from(filename), dirent);
        }
        if n_read != buf_len || !read_all {
            break;
        }
    }
    Ok((dirents, cookie))
}

// expect success and check if entries match expected ones
unsafe fn expect_success(
    desc: wasi::Fd,
    buffer_size: usize,
    cookie: u64,
    read_all: bool,
    n_expected: usize,
    expected: Option<&HashMap<String, Dirent>>
) -> Result<(), String> {
    match wasi_ls(desc, buffer_size, cookie, read_all) {
        Err(e) => { Err(e) },
        Ok((dirents, last_cookie)) => {
            if dirents.len() != n_expected {
                Err(format!("Unexpected number of read entries (expected {}, got {})", n_expected, dirents.len()))
            } else if last_cookie != cookie + n_expected as u64 {
                Err(format!(
                    "Unexpected dir cookie (expected {}, got {})",
                    cookie + n_expected as u64, last_cookie))
            } else if let Some(exp) = expected {
                // if None provided instead of expected hash map, don't verify contents
                if cmp_dirent_maps(&dirents, exp) {
                    Ok(())
                } else {
                    Err(format!("Unexpected directory contents (expected {:?}, got {:?})",
                    expected, dirents))
                }
            } else {
                Ok(())
            }
        }
    }
}

unsafe fn expect_error(
    desc: wasi::Fd,
    buf_len: usize,
    cookie: u64,
    errno: wasi::Errno,
    msg: &str
) -> Result<(), String> {
    let mut buf: Vec<u8> = vec![0; buf_len];
    match wasi::fd_readdir(desc, buf.as_mut_ptr(), buf_len, cookie) {
        Err(e) => {
            if e == errno {
                Ok(())
            } else {
                Err(format!(
                    "In fd_readdir({}, {:?}, {}, {}): unexpected error code (expected {}, got {})",
                    desc, buf.as_mut_ptr(), buf_len, cookie, errno, e))
            }
        },
        Ok(_) => {
            Err(format!("In fd_readdir({}, {:?}, {}, {}): {}", desc, buf.as_mut_ptr(), buf_len, cookie, msg))
        }
    }
}

struct Test {
    pub dir_fd: wasi::Fd,
    pub text_fd: wasi::Fd,
    pub elink_fd: wasi::Fd,
    pub ulink_fd: wasi::Fd,
    pub dir_elink_fd: wasi::Fd,
    pub dirents: HashMap<String, Dirent>
}

impl Test {
    unsafe fn tear_down(&self) -> Result<(), String> {
        for fd in [self.dir_fd, self.text_fd, self.elink_fd, self.ulink_fd, self.dir_elink_fd] {
            if let Err(e) = wasi::fd_close(fd) {
                return Err(e.to_string())
            }
        }
        Ok(())
    }
    unsafe fn run_tests(&self) -> Result<(), String> {
        // check if test directory contents match for different buffer sizes
        expect_success(self.dir_fd, 128, 0, true, constants::N_DIRENTRIES as usize, Some(&self.dirents))?;
        expect_success(self.dir_fd, 256, 0, true, constants::N_DIRENTRIES as usize, Some(&self.dirents))?;
        expect_success(self.dir_fd, 512, 0, true, constants::N_DIRENTRIES as usize, Some(&self.dirents))?;

        // look for errors when buffer overflows
        expect_success(
            self.dir_fd, (size_of::<Dirent>() + constants::SAMPLE_DIRENTRY_NAME_LEN) * 2 - 1, 0,
            false, 1, None)?;

        // buffer overflow when writing filetype
        expect_success(
            self.dir_fd, size_of::<Dirent>() * 2 + constants::SAMPLE_DIRENTRY_NAME_LEN - 1, 0,
            false, 1, None)?;

        // buffer overflow when writing name length
        expect_success(
            self.dir_fd, size_of::<Dirent>() * 2 + constants::SAMPLE_DIRENTRY_NAME_LEN - 5, 0,
            false, 1, None)?;

        // buffer overflow when writing inode
        expect_success(
            self.dir_fd, size_of::<Dirent>() * 2 + constants::SAMPLE_DIRENTRY_NAME_LEN - 9, 0,
            false, 1, None)?;

        // buffer overflow when writing cookie
        expect_success(
            self.dir_fd, size_of::<Dirent>() * 2 + constants::SAMPLE_DIRENTRY_NAME_LEN - 17, 0,
            false, 1, None)?;

        // reading directory with a buffer precisely matching entries size should work
        expect_success(
            self.dir_fd, (size_of::<Dirent>() + constants::SAMPLE_DIRENTRY_NAME_LEN) * 2, 0,
            false, 2, None)?;

        // attempt to readdir a file should fail
        expect_error(self.text_fd, 128, 0, wasi::ERRNO_BADF, "attempt to read text file as a directory succeeded")?;

        // attempt to readdir expanded symlink to a file should fail
        expect_error(
            self.elink_fd, 128, 0, wasi::ERRNO_BADF,
            "attempt to read expanded text file symlink as a directory succeeded")?;

        // attempt to readdir unexpanded symlink should fail
        expect_error(self.ulink_fd, 128, 0, wasi::ERRNO_BADF, "attempt to read unexpanded symlink as a directory succeeded")?;

        // attempt to readdir expanded directory symlink should succeed
        expect_success(self.dir_elink_fd, 128, 0, true, constants::N_DIRENTRIES as usize, Some(&self.dirents))?;

        let dummy_fd = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => {
                if let Err(e) = wasi::fd_close(d) { return Err(e.to_string()) }
                d
            },
            Err(e) => return Err(e.to_string())
        };

        // attempt to readdir invalid descriptor should fail
        expect_error(dummy_fd, 128, 0, wasi::ERRNO_BADF, "attempt to read invalid descriptor succeeded")?;

        // reading from too big cookie should yield no entries
        expect_success(self.dir_elink_fd, 128, constants::N_DIRENTRIES as u64 * 2, true, 0, None)?;
        Ok(())
    }
}

pub fn test_fd_readdir() -> Result<(), String> {
    unsafe {
        let test = Test {
            dir_fd: match wasi::path_open(
                constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
                0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
                Ok(d) => d,
                Err(e) => { return Err(e.to_string()) }
            },
            text_fd: match wasi::path_open(
                constants::PWD_DESC, 0, constants::SAMPLE_TEXT_FILENAME,
                0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
                Ok(d) => d,
                Err(e) => { return Err(e.to_string()) }
            },
            elink_fd: match wasi::path_open(
                constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW,
                constants::SAMPLE_LINK_FILENAME, 0, constants::RIGHTS_ALL,
                constants::RIGHTS_ALL, 0) {
                Ok(d) => d,
                Err(e) => { return Err(e.to_string()) }
            },
            ulink_fd: match wasi::path_open(
                constants::PWD_DESC, 0, constants::SAMPLE_LINK_FILENAME,
                0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
                Ok(d) => d,
                Err(e) => { return Err(e.to_string()) }
            },
            dir_elink_fd: match wasi::path_open(
                constants::PWD_DESC, wasi::LOOKUPFLAGS_SYMLINK_FOLLOW,
                constants::SAMPLE_DIR_LINK_FILENAME, 0, constants::RIGHTS_ALL,
                constants::RIGHTS_ALL, 0) {
                Ok(d) => d,
                Err(e) => { return Err(e.to_string()) }
            },
            dirents: (0..constants::N_DIRENTRIES)
                .map(|i| {
                    let name = format!("{}{}",constants::SAMPLE_DIRENTRY_NAME, i);
                    let name_len = name.len();
                    (name, Dirent {
                        d_next: i as u64,
                        d_ino: 0,
                        d_namlen: name_len as u32,
                        d_type: wasi::FILETYPE_REGULAR_FILE.raw(),
                    })
                }).collect(),
        };
        let result = test.run_tests();
        test.tear_down()?;
        result?;
    }
    Ok(())
}
