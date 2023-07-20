use std::mem;

use constants;

fn event_eq(s1: &wasi::Event, s2: &wasi::Event) -> bool {
    if s1.type_ == wasi::EVENTTYPE_CLOCK {
        (s1.userdata, s1.error, s1.type_)
        ==
        (s2.userdata, s2.error, s2.type_)
    } else {
        (s1.userdata, s1.error, s1.type_, s1.fd_readwrite.nbytes, s1.fd_readwrite.flags)
        ==
        (s2.userdata, s2.error, s2.type_, s2.fd_readwrite.nbytes, s2.fd_readwrite.flags)
    }
}

fn expected_errno_returned(
    result: Result<wasi::Size, wasi::Errno>,
    expected: Result<wasi::Size, wasi::Errno>,
) -> Result<(), String> {
    match (result, expected) {
        (Ok(res), Ok(exp)) => if res != exp {
            return Err(format!(
                "In poll_oneoff(): invalid syscall output \
                (expected {{events number: {}}})\
                got {{events number: {}}}", exp, res
            ))
        },
        (Err(res), Err(exp)) => if res != exp {
            return Err(format!(
                "In poll_oneoff(): invalid syscall output \
                (expected {{errno: {}}})\
                got {{errno: {}}}", exp, res
            ))
        },
        (Err(res), Ok(num)) => {
            return Err(format!(
                "In poll_oneoff(): invalid syscall output \
                (expected success {{events number: {}}})\
                got fail {{errno: {}}}", num, res
            ))
        },
        (Ok(res), Err(err)) => {
            return Err(format!(
                "In poll_oneoff(): invalid syscall output \
                (expected fail {{errno: {}}})\
                got success {{events number: {}}}", err, res
            ))
        },
    }
    Ok(())
}

unsafe fn expect_success(
    in_: *const wasi::Subscription,
    nsubscriptions: wasi::Size,
    events: &Vec<wasi::Event>
) -> Result<(), String> {
    let expected = events.len();
    let mut out: Vec<wasi::Event> = vec![mem::zeroed(); nsubscriptions];

    let result = wasi::poll_oneoff(in_, out.as_mut_ptr(), nsubscriptions);
    expected_errno_returned(result, Ok(expected))?;

    let got = result.unwrap();

    for i in 0..got {
        if !event_eq(&out[i], &events[i]) {
            return Err(
                format!(
                    "In poll_oneoff({:?}): invalid syscall output \
                    (expected {{events[{i}]: {:?}}})\
                    got {{events[{i}]: {:?}}}", in_, events[i], out[i]
                )
            );
        }
    }

    Ok(())
}

unsafe fn expect_error_event(
    in_: *const wasi::Subscription,
    nsubscriptions: wasi::Size,
    events: &Vec<wasi::Event>
) -> Result<(), String> {
    // Syscall return Ok(nevents) but in events buffor schould be errno code
    expect_success(in_, nsubscriptions, events)
}

unsafe fn expect_error(
    in_: *const wasi::Subscription,
    nsubscriptions: wasi::Size,
    errno: wasi::Errno
) -> Result<(), String> {
    let mut out: Vec<wasi::Event> = vec![mem::zeroed(); nsubscriptions];

    let result = wasi::poll_oneoff(in_, out.as_mut_ptr(), nsubscriptions);
    expected_errno_returned(result, Err(errno))
}

pub fn test_poll_oneoff() -> Result<(), String> {
    let clock_sub = wasi::Subscription {
        userdata: 0,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_CLOCK.raw(),
            u: wasi::SubscriptionUU {
                clock: wasi::SubscriptionClock {
                    id: wasi::CLOCKID_MONOTONIC,
                    timeout: 100000000,
                    precision: 0,
                    flags: 0
                }
            }
        }
    };

    let stdin_sub = wasi::Subscription {
        userdata: 1,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_FD_READ.raw(),
            u: wasi::SubscriptionUU {
                fd_read: wasi::SubscriptionFdReadwrite {
                    file_descriptor: 0
                }
            }
        }
    };

    let stdout_sub = wasi::Subscription {
        userdata: 2,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_FD_WRITE.raw(),
            u: wasi::SubscriptionUU {
                fd_read: wasi::SubscriptionFdReadwrite {
                    file_descriptor: 1
                }
            }
        }
    };

    let file_fd = unsafe {
        let dirflags = 0;
        let oflags = 0;
        let fdflags = wasi::FDFLAGS_SYNC | wasi::FDFLAGS_DSYNC;

        match wasi::path_open(
            constants::PWD_DESC, dirflags,
            constants::SAMPLE_TEXT_FILENAME,
            oflags,
            constants::RIGHTS_ALL,
            constants::RIGHTS_ALL,
            fdflags
        ) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        }
    };

    let file_read_sub = wasi::Subscription {
        userdata: 3,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_FD_READ.raw(),
            u: wasi::SubscriptionUU {
                fd_read: wasi::SubscriptionFdReadwrite {
                    file_descriptor: file_fd
                }
            }
        }
    };

    let file_write_sub = wasi::Subscription {
        userdata: 4,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_FD_WRITE.raw(),
            u: wasi::SubscriptionUU {
                fd_read: wasi::SubscriptionFdReadwrite {
                    file_descriptor: file_fd
                }
            }
        }
    };

    let dir_fd = unsafe {
        let dirflags = 0;
        let oflags = 0;
        let fdflags = 0;

        match wasi::path_open(
            constants::PWD_DESC,
            dirflags,
            constants::SAMPLE_DIR_FILENAME,
            oflags,
            constants::RIGHTS_ALL,
            constants::RIGHTS_ALL,
            fdflags
        ) {
            Ok(d) => d,
            Err(e) => { return Err(e.to_string()) }
        }
    };

    let dir_read_sub = wasi::Subscription {
        userdata: 5,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_FD_READ.raw(),
            u: wasi::SubscriptionUU {
                fd_read: wasi::SubscriptionFdReadwrite {
                    file_descriptor: dir_fd
                }
            }
        }
    };

    let dir_write_sub = wasi::Subscription {
        userdata: 6,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_FD_WRITE.raw(),
            u: wasi::SubscriptionUU {
                fd_read: wasi::SubscriptionFdReadwrite {
                    file_descriptor: dir_fd
                }
            }
        }
    };

    let bad_fd_read_sub = wasi::Subscription {
        userdata: 7,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_FD_READ.raw(),
            u: wasi::SubscriptionUU {
                fd_read: wasi::SubscriptionFdReadwrite {
                    file_descriptor: 1024
                }
            }
        }
    };

    let bad_fd_write_sub = wasi::Subscription {
        userdata: 8,
        u: wasi::SubscriptionU {
            tag: wasi::EVENTTYPE_FD_WRITE.raw(),
            u: wasi::SubscriptionUU {
                fd_read: wasi::SubscriptionFdReadwrite {
                    file_descriptor: 1024
                }
            }
        }
    };

    let invalid_sub = wasi::Subscription {
        userdata: 9,
        u: wasi::SubscriptionU {
            tag: 0xff,
            u: unsafe { mem::zeroed() }
        }
    };

    unsafe {
        // test one clock subscribion
        let in_ = [ clock_sub ];
        let events = vec![
            wasi::Event {
                userdata: 0,
                error: wasi::ERRNO_SUCCESS,
                type_: wasi::EVENTTYPE_CLOCK,
                fd_readwrite: mem::zeroed()
            },
        ];
        expect_success(in_.as_ptr(), in_.len(), &events)?;

        // test waiting for stdin with timeout - timeout exceed
        let in_ = [
            clock_sub, stdin_sub,
        ];
        expect_success(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
            stdout_sub, file_write_sub,
        ];
        let events = vec![
            wasi::Event {
                userdata: 2,
                error: wasi::ERRNO_SUCCESS,
                type_: wasi::EVENTTYPE_FD_WRITE,
                fd_readwrite: mem::zeroed()
            },
            wasi::Event {
                userdata: 4,
                error: wasi::ERRNO_SUCCESS,
                type_: wasi::EVENTTYPE_FD_WRITE,
                fd_readwrite: wasi::EventFdReadwrite {
                    nbytes: constants::SAMPLE_TEXT_LEN as u64,
                    flags: 0
                }
            },
        ];

        // Writing to any file type is unsupported right now
        expect_error_event(in_.as_ptr(), in_.len(), &events)?;
        let in_ = [
           clock_sub, stdout_sub, file_write_sub,
        ];

        // With clock sub output should be the same for writing
        expect_error_event(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
           file_read_sub,
        ];

        let events = vec![
            wasi::Event {
                userdata: 3,
                error: wasi::ERRNO_SUCCESS,
                type_: wasi::EVENTTYPE_FD_READ,
                fd_readwrite: wasi::EventFdReadwrite {
                    nbytes: constants::SAMPLE_TEXT_LEN as u64,
                    flags: 0
                }
            },
        ];

        // Read sub for regular files is not permited
        expect_error_event(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
            clock_sub, file_read_sub,
        ];

        expect_error_event(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
           dir_read_sub, dir_write_sub,
        ];

        let events = vec![
            wasi::Event {
                userdata: 5,
                error: wasi::ERRNO_NOTSUP,
                type_: wasi::EVENTTYPE_FD_READ,
                fd_readwrite: mem::zeroed()
            },
            wasi::Event {
                userdata: 6,
                error: wasi::ERRNO_NOTSUP,
                type_: wasi::EVENTTYPE_FD_WRITE,
                fd_readwrite: mem::zeroed()
            },
        ];

        // Any operation on directiories are not permited/supported
        expect_error_event(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
            clock_sub, dir_read_sub, dir_write_sub,
        ];

        expect_error_event(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
           bad_fd_read_sub, bad_fd_write_sub,
        ];

        let events = vec![
            wasi::Event {
                userdata: 7,
                error: wasi::ERRNO_BADF,
                type_: wasi::EVENTTYPE_FD_READ,
                fd_readwrite: mem::zeroed()
            },
            wasi::Event {
                userdata: 8,
                error: wasi::ERRNO_BADF,
                type_: wasi::EVENTTYPE_FD_WRITE,
                fd_readwrite: mem::zeroed()
            },
        ];

        // When user passes unopened file descriptor then syscall should returns errno
        expect_error_event(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
            clock_sub, bad_fd_read_sub, bad_fd_write_sub,
        ];

        expect_error_event(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
           invalid_sub,
        ];

        // User used undefined tag for event subscription
        expect_error(in_.as_ptr(), in_.len(), wasi::ERRNO_INVAL)?;
    }
    
    Ok(())
}
