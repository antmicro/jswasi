use std::io::{Error, ErrorKind};

pub fn test_environ_sizes_get() -> std::io::Result<()> {
    unsafe{
        // Currently, exporting variables is not supported in wasi
        // so we can only check if the invocation succeeds
        match wasi::environ_sizes_get() {
            Ok(_) => Ok(()),
            Err(e) => { Err(Error::new(ErrorKind::Other, e)) }
        }
    }
}
