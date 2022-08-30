const PRECISION: wasi::Timestamp = 128; // this is arbitrary and doesn't affect the test

unsafe fn expect_success(id: wasi::Clockid, precision: wasi::Timestamp) -> Result<(), String> {
    if let Err(e) = wasi::clock_time_get(id, precision) {
        Err(format!("In clock_time_get({:?}, {}): {:?}", id, precision, e))
    } else { Ok(()) }
}

pub fn test_clock_time_get() -> Result<(), String> {
    unsafe {
        // Valid clockids should work
        expect_success(wasi::CLOCKID_MONOTONIC, PRECISION)?;
        expect_success(wasi::CLOCKID_REALTIME, PRECISION)?;
        expect_success(wasi::CLOCKID_PROCESS_CPUTIME_ID, PRECISION)?;
        expect_success(wasi::CLOCKID_THREAD_CPUTIME_ID, PRECISION)?;
    }
    Ok(())
}
