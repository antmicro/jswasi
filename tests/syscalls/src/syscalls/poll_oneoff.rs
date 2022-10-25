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

unsafe fn expect_success(
    in_: *const wasi::Subscription,
    nsubscriptions: wasi::Size,
    events: &Vec<wasi::Event>
) -> Result<(), String> {
    let expected = events.len();
    let mut out: Vec<wasi::Event> = vec![mem::zeroed(); nsubscriptions];

    let got = match wasi::poll_oneoff(in_, out.as_mut_ptr(), nsubscriptions) {
        Ok(n) => {
            if n != expected {
                return Err(
                    format!(
                        "In poll_oneoff({:?}): invalid syscall output \
                        (expected {{occured events: {}}})\
                        got {{occured events: {}}}", in_, expected, n
                    )
                );
            } else { n }
        }
        Err(e) => return Err(
            format!("In poll_oneoff({:?}): {:?}", in_, e)
        ),
    };

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
    }
    Ok(())
}
