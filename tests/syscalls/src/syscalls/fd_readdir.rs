use std::io::{Error, ErrorKind};
use std::convert::TryInto;
use std::collections::HashSet;
use super::constants;

pub unsafe fn wasi_ls(desc: wasi::Fd, buf_len: usize) -> std::io::Result<Vec<String>> {
    let mut filenames: Vec<String> = Vec::new();
    let mut buf: Vec<u8> = Vec::with_capacity(buf_len);
    buf.set_len(buf_len);
    let mut cookie: u64 = 0;
    loop {
        let n_read = match wasi::fd_readdir(desc, buf.as_mut_ptr(), buf_len, cookie) {
            Ok(r) => r,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)) }
        };
        let mut offset = 0;
        'inner: loop {
            let cookie_tmp = if offset + 8 < n_read {
                u64::from_le_bytes(buf[offset..offset+8].try_into().unwrap())
            } else { break 'inner };
            offset+=8;
            
            let _inode = if offset + 8 < n_read {
                u64::from_le_bytes(buf[offset..offset+8].try_into().unwrap())
            } else { break 'inner };
            offset+=8;
            let name_len = if offset + 4 < n_read {
                u32::from_le_bytes(buf[offset..offset+4].try_into().unwrap())
            } else { break 'inner };
            offset+=4;
            let _filetype = if offset + 4 < n_read { // filetype size is 1 byte + 3 bytes of padding
                u32::from_le_bytes(buf[offset..offset+4].try_into().unwrap())
            } else { break 'inner };
            offset+=4;
            let filename = if offset + name_len as usize <= n_read {
                std::str::from_utf8(&buf[offset..offset+name_len as usize]).unwrap()
            } else { break 'inner };
            offset += name_len as usize;
            cookie = cookie_tmp;
            filenames.push(String::from(filename));
        }
        if n_read != buf_len {
            break;
        }
    }
    Ok(filenames)
}

pub fn test_fd_readdir() -> std::io::Result<()> {
    let direntries: HashSet<String> = (0..constants::N_DIRENTRIES)
        .map(|i| format!("{}{}",constants::SAMPLE_DIRENTRY_NAME, i))
        .collect();
    unsafe {
        let desc = match wasi::path_open(
            constants::PWD_DESC, 0, constants::SAMPLE_DIR_FILENAME,
            0, constants::RIGHTS_ALL, constants::RIGHTS_ALL, 0) {
            Ok(d) => d,
            Err(e) => { return Err(Error::new(ErrorKind::Other, e)) }
        };
        let ls = wasi_ls(desc, 256)?;
        if ls.iter().collect::<HashSet<&String>>() == direntries.iter().collect() {
            Ok(())
        } else {
            Err(Error::new(ErrorKind::Other, "Wrong directory entries"))
        }
    }
}
