use std::env;

fn expect_success(key: &str, val: Option<&str>) -> Result<(), String> {
    if let Err(e) = wasi_ext_lib::set_env(key, val) {
        Err(format!(
            "In set_env({}, {:?}): syscall failed unexpectedly ({:?})",
            key, val, e))
    } else { Ok(()) }
}

fn check_env(key: &str, val: Option<&str>) -> Result<(), String> {
    let actual = env::var(key);
    match actual {
        Ok(var) => {
            if val.is_some() && val.unwrap() == var {
                Ok(())
            } else {
                Err(format!(
                    "Unexpected variable value (expected {}, got {})",
                    val.unwrap(), var))
            }
        }
        Err(env::VarError::NotPresent) => {
            if let None = val { Ok(()) }
            else { Err(format!(
                "Unexpected variable value (expected {:?}, got {:?})",
                val.unwrap(), None::<&str>))
            }
        }
        Err(e) => Err(format!("Unexpected error ({:?})", e))
    }
}

pub fn test_set_env() -> Result<(), String> {
    expect_success("KEY", Some("VAL"))?;
    check_env("KEY", Some("VAL"))?;

    expect_success("KEY", None)?;
    check_env("KEY", None)?;

    expect_success("KEY", Some(""))?;
    check_env("KEY", Some(""))?;

    Ok(())
}
