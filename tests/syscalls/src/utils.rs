unsafe fn check_times(
    filestat: wasi::Filestat,
    atim_ex: Option<wasi::Timestamp>,
    mtim_ex: Option<wasi::Timestamp>
) -> Result<(), String> {
    if let Some(m) = mtim_ex {
        if m != filestat.mtim {
            return Err(format!(
                "Unexpected mtim (expected {}, got {})",
                m, filestat.mtim))
        }
    }
    if let Some(a) = atim_ex {
        if a != filestat.atim {
            return Err(format!(
                "Unexpected atim (expected {}, got {})",
                a, filestat.atim))
        }
    }
    Ok(())
}

pub unsafe fn fd_check_times(
    fd: wasi::Fd,
    atim_ex: Option<wasi::Timestamp>,
    mtim_ex: Option<wasi::Timestamp>
) -> Result<(), String> {
    check_times(match wasi::fd_filestat_get(fd) {
        Ok(filestat) => filestat,
        Err(e) => { return Err(e.to_string()) }
    }, atim_ex, mtim_ex)
}

pub unsafe fn path_check_times(
    fd: wasi::Fd,
    lookupflags: wasi::Lookupflags,
    path: &str,
    atim_ex: Option<wasi::Timestamp>,
    mtim_ex: Option<wasi::Timestamp>
) -> Result<(), String> {
    check_times(match wasi::path_filestat_get(fd, lookupflags, path) {
        Ok(filestat) => filestat,
        Err(e) => { return Err(e.to_string()); }
    }, atim_ex, mtim_ex)
}
