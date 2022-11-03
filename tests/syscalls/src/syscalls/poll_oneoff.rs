use std::mem;

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
                got success {{: {}}}", err, res
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
    // Syscall return Ok(nevents) but in event buffor schould be errno code
    expect_success(in_, nsubscriptions, events)
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

    unsafe {
        // test one clock subscribion
        let in_ = [ clock_sub ];
        let events = vec![
            wasi::Event {
                userdata: 0,
                error: wasi::ERRNO_SUCCESS,
                type_: wasi::EVENTTYPE_CLOCK,
                fd_readwrite: mem::zeroed()
            }
        ];
        expect_success(in_.as_ptr(), in_.len(), &events)?;

        // test waiting for stdin with timeout - timeout exceed
        let in_ = [
            clock_sub, stdin_sub
        ];
        expect_success(in_.as_ptr(), in_.len(), &events)?;

        let in_ = [
            clock_sub, stdout_sub
        ];
        let events = vec![
            wasi::Event {
                userdata: 2,
                error: wasi::ERRNO_NOTSUP,
                type_: wasi::EVENTTYPE_FD_WRITE,
                fd_readwrite: mem::zeroed()
            }
        ];
        expect_error_event(in_.as_ptr(), in_.len(), &events)?;
    }
    Ok(())
}
