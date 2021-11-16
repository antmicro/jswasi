use std::fs;
use std::fs::OpenOptions;
use std::io::Write;

use color_eyre::Report;

use crate::shell_base::{Redirect, STDERR, STDOUT};

/// Wrapper for stdout/stderr operations from shell builtins
/// so that they are redirects-aware
pub struct OutputDevice<'a> {
    redirects: &'a Vec<Redirect>,
    stdout: String,
    stderr: String,
}

impl<'a> OutputDevice<'a> {
    pub fn new(redirects: &'a Vec<Redirect>) -> Self {
        OutputDevice {
            redirects,
            stdout: String::new(),
            stderr: String::new(),
        }
    }

    // TODO: ensure this gets called, maybe move it to custom Drop implementation
    pub fn flush(&self) -> Result<(), Report> {
        self._flush(STDOUT, &self.stdout)?;
        self._flush(STDERR, &self.stderr)?;
        Ok(())
    }

    fn _flush(&self, to_fd: u16, output: &str) -> Result<(), Report> {
        let mut is_redirected = false;
        for redirect in self.redirects {
            match redirect {
                Redirect::Write((fd, file)) => {
                    if *fd == to_fd {
                        fs::write(file, output)?;
                        is_redirected = true;
                    }
                }
                Redirect::Append((fd, file)) => {
                    if *fd == to_fd {
                        let mut file = OpenOptions::new().write(true).append(true).open(file)?;
                        write!(file, "{}", output)?;
                        is_redirected = true;
                    }
                }
                _ => {}
            }
        }

        if !is_redirected {
            if to_fd == STDOUT {
                print!("{}", output);
            } else {
                eprint!("{}", output);
            }
        }

        Ok(())
    }

    pub fn print(&mut self, output: &str) {
        self.stdout.push_str(output);
    }

    pub fn println(&mut self, output: &str) {
        self.stdout.push_str(output);
        self.stdout.push('\n');
    }

    pub fn eprint(&mut self, output: &str) {
        self.stderr.push_str(output);
    }

    pub fn eprintln(&mut self, output: &str) {
        self.stderr.push_str(output);
        self.stderr.push('\n');
    }
}
