pub fn test_environ_sizes_get() -> Result<(), String> {
    unsafe{
        // Currently, exporting variables is not supported in wasi
        // so we can only check if the invocation succeeds
        match wasi::environ_sizes_get() {
            Ok(_) => Ok(()),
            Err(e) => { Err(format!("In environ_sizes_get(): {}", e)) }
        }
    }
}
