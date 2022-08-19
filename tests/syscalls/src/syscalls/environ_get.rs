pub fn test_environ_get() -> Result<(), String> {
    unsafe {
        let (envc, envv_s) = match wasi::environ_sizes_get() {
            Ok(e) => e,
            Err(e) => { return Err(e.to_string()); }
        };
        let mut envs_bufs: Vec<*mut u8> = vec![std::ptr::null_mut(); envc];
        let mut envv_buf: Vec<u8> = vec![0; envv_s];
        match wasi::environ_get(envs_bufs.as_mut_ptr(), envv_buf.as_mut_ptr()) {
            Ok(_) => {
                // all variables should be delimited by \0 char
                // here, we check if char before every env var (except the first one) is \0
                if envs_bufs.len() > 0 {
                    for i in &envs_bufs[1..] {
                        let delim = *((*i as usize - 1) as *mut u8);
                        if delim != 0 {
                            return Err(format!(
                                "In environ_get(): wrong variable delimiter (expected {}, got {})",
                                0, delim));
                        }
                    }
                    Ok(())
                } else {
                    // fail test if no environment variables provided
                    Err(String::from("No test environment variables provided"))
                }
            }
            Err(e) => { Err(format!("In environ_get(): {:?}", e)) }
        }
    }
}
