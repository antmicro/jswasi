use constants;

pub fn test_args_sizes_get() -> Result<(), String> {
    unsafe {
        let expected_size = constants::ARGV.iter().fold(0, |r, arg| r + arg.len());
        match wasi::args_sizes_get() {
            Ok((n_args, args_size)) => {
                // for all tests we assume that cli args are ones in constants::ARGV constant
                if n_args != constants::ARGV.len() || expected_size != args_size {
                    Err(format!(
                        "In args_sizes_get(): expected (argc: {}, argv_buf_size: {}), \
                        got (argc: {}, argv_buf_size: {})",
                        constants::ARGV.len(), expected_size, n_args, args_size))
                } else {
                    Ok(())
                }
            },
            Err(e) => { Err(format!("In args_sizes_get(): {}", e)) }
        }
    }
}
