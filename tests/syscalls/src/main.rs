mod syscalls;
use syscalls::*;

fn main() -> std::io::Result<()>{
    println!("[TEST] fd_prestat_get: {:?}", fd_prestat_get::test_fd_prestat_get());
    println!("[TEST] fd_fdstat_get: {:?}", fd_fdstat_get::test_fd_fdstat_get());
    Ok(())
}
