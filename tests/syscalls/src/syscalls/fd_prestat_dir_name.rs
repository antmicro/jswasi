use constants;

pub fn test_fd_prestat_dir_name() -> Result<(), String> {
    unsafe {
        let prestat_desc = match wasi::fd_prestat_get(constants::PWD_DESC) {
            Ok(p) => p,
            Err(e) => { return Err(e.to_string()); }
        };
        let mut dir_name_buf: Vec<u8> = vec![0; prestat_desc.u.dir.pr_name_len];
        match wasi::fd_prestat_dir_name(
            constants::PWD_DESC, dir_name_buf.as_mut_ptr(),
            prestat_desc.u.dir.pr_name_len) {
            Ok(_) => {
                if dir_name_buf != "/".as_bytes() {
                    Err(format!(
                        "In fd_prestat_dir_name({}): invalid path (expected {:?}, got {:?})",
                        constants::PWD_DESC, ".", dir_name_buf))
                } else {
                    Ok(())
                }
            }
            Err(e) => { Err(format!("In fd_prestat_dir_name({}): {:?}", constants::PWD_DESC, e)) }
        }
    }
}
