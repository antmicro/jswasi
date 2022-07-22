use std::io::{Error, ErrorKind};

pub fn test_args_sizes_get() -> std::io::Result<()> {
    unsafe {
        match wasi::args_sizes_get() {
            Ok((n_args, args_size)) => {
                // args_size depends on binary name, for now it is "test" (\0 at the end is included)
                if n_args != 1 || args_size != 5 {
                    Err(Error::new(
                        ErrorKind::Other,
                        format!(
                            "In args_sizes_get(): expected (argc: {}, argv_buf_size: {}), \
                            got (argc: {}, argv_buf_size: {})", 1, 5, n_args, args_size)))
                } else {
                    Ok(())
                }
            },
            Err(e) => { Err(Error::new(ErrorKind::Other, e)) }
        }
    }
}
