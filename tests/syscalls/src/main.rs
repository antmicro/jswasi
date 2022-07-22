mod syscalls;
use syscalls::*;

fn main() -> std::io::Result<()>{
    println!("[TEST] environ_sizes_get: {:?}", environ_sizes_get::test_environ_sizes_get());
    println!("[TEST] args_sizes_get: {:?}", args_sizes_get::test_args_sizes_get());
    println!("[TEST] fd_prestat_get: {:?}", fd_prestat_get::test_fd_prestat_get());
    println!("[TEST] fd_fdstat_get: {:?}", fd_fdstat_get::test_fd_fdstat_get());
    println!("[TEST] fd_filestat_get: {:?}", fd_filestat_get::test_fd_filestat_get());
    Ok(())
}
