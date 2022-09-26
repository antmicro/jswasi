use std::{ str, slice };
use constants;

pub fn test_args_get() -> Result<(), String> {
    unsafe {
        let (argc, argv_s) = match wasi::args_sizes_get() {
            Ok(a) => a,
            Err(e) => { return Err(e.to_string()); }
        };
        let mut args_bufs: Vec<*mut u8> = vec![std::ptr::null_mut(); argc];
        let mut argv_buf: Vec<u8> = vec![0; argv_s];
        match wasi::args_get(args_bufs.as_mut_ptr(), argv_buf.as_mut_ptr()) {
            Ok(_) => {
                if args_bufs.len() == constants::ARGV.len() {
                    for i in &args_bufs[1..constants::ARGV.len()] {
                        let delim = *((*i as usize - 1) as *mut u8);
                        if delim != 0 {
                            return Err(format!(
                                "In args_get(): wrong argument delimiter (expected {}, got {})",
                                0, delim));
                        }
                    }
                    for i in 0..constants::ARGV.len() - 1 {
                        let arg = str::from_utf8(
                            slice::from_raw_parts_mut(
                                args_bufs[i], args_bufs[1+i] as usize - args_bufs[i] as usize)).unwrap();
                        if arg != constants::ARGV[i] {
                            return Err(format!(
                                "In args_get(): unexpected command line argument (expected {}, got {})",
                                constants::ARGV[i], arg));
                        }
                    }
                    let arg = str::from_utf8(
                        slice::from_raw_parts_mut(
                        args_bufs[constants::ARGV.len()-1],
                        argv_s + args_bufs[0] as usize - args_bufs[constants::ARGV.len()-1] as usize)).unwrap();
                    if arg != constants::ARGV[constants::ARGV.len()-1] {
                        return Err(format!(
                            "In args_get(): unexpected command line argument (expected {}, got {})",
                            constants::ARGV[constants::ARGV.len()-1], arg));
                    }
                    Ok(())
                } else {
                    Err(format!("Wrong command line args provided (expected are {:?})", constants::ARGV))
                }
            }
            Err(e) => { Err(format!("In args_get(): {:?}", e)) }
        }
    }
}
