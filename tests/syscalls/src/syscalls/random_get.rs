const BUF_SIZE: usize = 128;

pub fn test_random_get() -> Result<(), String> {
    unsafe {
        let mut buf = vec![0u8; BUF_SIZE];
        match wasi::random_get(buf.as_mut_ptr(), BUF_SIZE) {
            Ok(_) => Ok(()),
            Err(e) => {
                if e == wasi::ERRNO_IO {
                    Ok(())
                } else {
                    Err(format!("In random_get({:?}, {}): {:?}", buf.as_mut_ptr(), BUF_SIZE, e))
                }
            }
        }
    }
}
