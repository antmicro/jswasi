use std::collections::HashMap;
use std::env;
use std::fs;
use std::fs::{File, OpenOptions};
use std::io;
use std::io::ErrorKind;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::exit;
use std::thread;
use std::time::Duration;

use color_eyre::Report;
use conch_parser::lexer::Lexer;
use conch_parser::parse::DefaultParser;
use iterm2;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Serialize, Serializer};
use serde::ser::SerializeStruct;

use crate::interpreter::interpret;
use crate::output_device::OutputDevice;

type Fd = u16;
type SerializedPath = String;

pub const EXIT_SUCCESS: i32 = 0;
pub const EXIT_FAILURE: i32 = 1;
pub const EXIT_CRITICAL_FAILURE: i32 = 2;
pub const EXIT_CMD_NOT_FOUND: i32 = 127;

pub const STDIN: Fd = 0;
pub const STDOUT: Fd = 1;
pub const STDERR: Fd = 2;

const CLEAR_ESCAPE_CODE: &str = "\x1b[2J\x1b[H";

enum HistoryExpansion {
    Expanded(String),
    EventNotFound(String),
    Unchanged,
}

pub struct SyscallResult {
    pub exit_status: i32,
    pub output: String,
}

#[derive(Debug, Clone)]
pub enum Redirect {
    Read((Fd, SerializedPath)),
    Write((Fd, SerializedPath)),
    Append((Fd, SerializedPath)),
}

impl Serialize for Redirect {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut state = serializer.serialize_struct("Redirect", 3)?;
        match self {
            Redirect::Read((fd, path)) => {
                state.serialize_field("mode", "read")?;
                state.serialize_field("fd", fd)?;
                state.serialize_field("path", path)?;
            }
            Redirect::Write((fd, path)) => {
                state.serialize_field("mode", "write")?;
                state.serialize_field("fd", fd)?;
                state.serialize_field("path", path)?;
            }
            Redirect::Append((fd, path)) => {
                state.serialize_field("mode", "append")?;
                state.serialize_field("fd", fd)?;
                state.serialize_field("path", path)?;
            }
        }
        state.end()
    }
}

// communicate with the worker thread
pub fn syscall(
    command: &str,
    args: &[&str],
    env: &HashMap<String, String>,
    background: bool,
    #[allow(unused_variables)] redirects: &[Redirect],
) -> Result<SyscallResult, Report> {
    #[cfg(target_os = "wasi")]
    let result = {
        use serde_json::json;

        let j = json!({
            "command": command,
            "args": args,
            "env": env,
            "redirects": redirects,
            "background": background,
        })
        .to_string();
        let result = fs::read_link(format!("/!{}", j))?
            .to_str()
            .unwrap()
            .trim_matches(char::from(0))
            .to_string();
        if !background {
            let (exit_status, output) = result.split_once("\x1b").unwrap();
            let exit_status = exit_status.parse::<i32>().unwrap();
            SyscallResult {
                exit_status,
                output: output.to_string(),
            }
        } else {
            SyscallResult {
                exit_status: EXIT_SUCCESS,
                output: "".to_string(),
            }
        }
    };
    #[cfg(not(target_os = "wasi"))]
    let result = {
        if command == "spawn" {
            let mut spawned = std::process::Command::new(args[0])
                .args(&args[1..])
                .envs(env)
                .spawn()
                .unwrap();
            // TODO: add redirects
            if !background {
                let exit_status = spawned.wait().unwrap().code().unwrap();
                SyscallResult {
                    exit_status,
                    output: "".to_string(),
                }
            } else {
                SyscallResult {
                    exit_status: EXIT_SUCCESS,
                    output: "".to_string(),
                }
            }
        } else {
            SyscallResult {
                exit_status: EXIT_SUCCESS,
                output: "".to_string(),
            }
        }
    };
    Ok(result)
}

fn path_exists(path: &str) -> io::Result<bool> {
    fs::metadata(path).map(|_| true).or_else(|error| {
        if error.kind() == ErrorKind::NotFound {
            Ok(false)
        } else {
            Err(error)
        }
    })
}

pub struct Shell {
    pub pwd: PathBuf,
    pub vars: HashMap<String, String>,
    pub last_exit_status: i32,

    history: Vec<String>,
    history_file: Option<File>,
    should_echo: bool,
    cursor_position: usize,
}

impl Shell {
    pub fn new(should_echo: bool, pwd: &str) -> Self {
        Shell {
            should_echo,
            pwd: PathBuf::from(pwd),
            history: Vec::new(),
            history_file: None,
            vars: HashMap::new(),
            last_exit_status: EXIT_SUCCESS,
            cursor_position: 0,
        }
    }

    fn print_prompt(&mut self, input: &str) {
        print!("{}{}", self.parse_prompt_string(), input);
        io::stdout().flush().unwrap();
        self.cursor_position = input.len();
    }

    fn parse_prompt_string(&self) -> String {
        env::var("PS1")
            .unwrap_or_else(|_| "\x1b[1;34m\\u@\\h \x1b[1;33m\\w$\x1b[0m ".to_string())
            .replace(
                "\\u",
                &env::var("USER").unwrap_or_else(|_| "user".to_string()),
            )
            .replace(
                "\\h",
                &env::var("HOSTNAME").unwrap_or_else(|_| "hostname".to_string()),
            )
            // FIXME: should only replace if it starts with HOME
            .replace(
                "\\w",
                &self
                    .pwd
                    .display()
                    .to_string()
                    .replace(&env::var("HOME").unwrap(), "~"),
            )
    }

    fn echo(&self, output: &str) {
        if self.should_echo {
            // TODO: should this maybe use OutputDevice too?
            print!("{}", output);
        }
    }

    pub fn run_command(&mut self, command: &str) -> Result<i32, Report> {
        self.handle_input(command)
    }

    pub fn run_script(&mut self, script_name: impl Into<PathBuf>) -> Result<i32, Report> {
        self.handle_input(&fs::read_to_string(script_name.into()).unwrap())
    }

    /// Builds a line from standard input.
    // TODO: maybe wrap in one more loop and only return when non-empty line is produced?
    fn get_line(&mut self, input: &mut String) {
        let mut input_stash = String::new();

        let mut c1 = [0];
        let mut escaped = false;
        let mut history_entry_to_display: i32 = -1;

        loop {
            // this is to handle EOF when piping to shell
            match io::stdin().read_exact(&mut c1) {
                Ok(()) => {}
                Err(_) => exit(EXIT_SUCCESS),
            }
            if escaped {
                match c1[0] {
                    0x5b => {
                        let mut c2 = [0];
                        io::stdin().read_exact(&mut c2).unwrap();
                        match c2[0] {
                            0x32 | 0x33 | 0x35 | 0x36 => {
                                let mut c3 = [0];
                                io::stdin().read_exact(&mut c3).unwrap();
                                match [c2[0], c3[0]] {
                                    [0x35, 0x7e] => {
                                        println!("TODO: PAGE UP");
                                        escaped = false;
                                    }
                                    [0x36, 0x7e] => {
                                        println!("TODO: PAGE DOWN");
                                        escaped = false;
                                    }
                                    [0x32, 0x7e] => {
                                        println!("TODO: INSERT");
                                        escaped = false;
                                    }
                                    // delete key
                                    [0x33, 0x7e] => {
                                        if input.len() - self.cursor_position > 0 {
                                            self.echo(
                                                &" ".repeat(input.len() - self.cursor_position + 1),
                                            );
                                            input.remove(self.cursor_position);
                                            self.echo(
                                                &format!("{}", 8 as char)
                                                    .repeat(input.len() - self.cursor_position + 2),
                                            );
                                            self.echo(
                                                &input
                                                    .chars()
                                                    .skip(self.cursor_position)
                                                    .collect::<String>(),
                                            );
                                            self.echo(
                                                &format!("{}", 8 as char)
                                                    .repeat(input.len() - self.cursor_position),
                                            );
                                        }
                                        escaped = false;
                                    }
                                    [0x33, 0x3b] => {
                                        println!("TODO: SHIFT + DELETE");
                                        let mut c4 = [0];
                                        // TWO MORE! TODO: improve!
                                        io::stdin().read_exact(&mut c4).unwrap();
                                        io::stdin().read_exact(&mut c4).unwrap();
                                        escaped = false;
                                    }
                                    _ => {
                                        println!(
                                            "TODO: [ + 0x{:02x} + 0x{:02x}",
                                            c2[0] as u8, c3[0] as u8
                                        );
                                        escaped = false;
                                    }
                                }
                            }
                            // up arrow
                            0x41 => {
                                if !self.history.is_empty() && history_entry_to_display != 0 {
                                    if history_entry_to_display == -1 {
                                        history_entry_to_display = (self.history.len() - 1) as i32;
                                        input_stash = input.clone();
                                    } else if history_entry_to_display > 0 {
                                        history_entry_to_display -= 1;
                                    }
                                    // bring cursor to the end so that clearing later starts from
                                    // proper position
                                    self.echo(
                                        &input
                                            .chars()
                                            .skip(self.cursor_position)
                                            .collect::<String>(),
                                    );
                                    for _ in 0..input.len() {
                                        self.echo(&format!("{} {}", 8 as char, 8 as char));
                                    }
                                    *input =
                                        self.history[history_entry_to_display as usize].clone();
                                    self.cursor_position = input.len();
                                    self.echo(input);
                                }
                                escaped = false;
                            }
                            // down arrow
                            0x42 => {
                                if history_entry_to_display != -1 {
                                    // bring cursor to the end so that clearing later starts from
                                    // proper position
                                    self.echo(
                                        &input
                                            .chars()
                                            .skip(self.cursor_position)
                                            .collect::<String>(),
                                    );
                                    for _ in 0..input.len() {
                                        self.echo(&format!("{} {}", 8 as char, 8 as char));
                                        // '\b \b', clear left of cursor
                                    }
                                    if self.history.len() - 1 > (history_entry_to_display as usize)
                                    {
                                        history_entry_to_display += 1;
                                        *input =
                                            self.history[history_entry_to_display as usize].clone();
                                    } else {
                                        *input = input_stash.clone();
                                        history_entry_to_display = -1;
                                    }
                                    self.cursor_position = input.len();
                                    self.echo(input);
                                }
                                escaped = false;
                            }
                            // right arrow
                            0x43 => {
                                if self.cursor_position < input.len() {
                                    self.echo(
                                        &input
                                            .chars()
                                            .nth(self.cursor_position)
                                            .unwrap()
                                            .to_string(),
                                    );
                                    self.cursor_position += 1;
                                }
                                escaped = false;
                            }
                            // left arrow
                            0x44 => {
                                if self.cursor_position > 0 {
                                    self.echo(&format!("{}", 8 as char));
                                    self.cursor_position -= 1;
                                }
                                escaped = false;
                            }
                            // end key
                            0x46 => {
                                self.echo(
                                    &input.chars().skip(self.cursor_position).collect::<String>(),
                                );
                                self.cursor_position = input.len();
                                escaped = false;
                            }
                            // home key
                            0x48 => {
                                self.echo(&format!("{}", 8 as char).repeat(self.cursor_position));
                                self.cursor_position = 0;
                                escaped = false;
                            }
                            _ => {
                                println!("WE HAVE UNKNOWN CONTROL CODE '[' + {}", c2[0] as u8);
                                escaped = false;
                            }
                        }
                    }
                    _ => {
                        escaped = false;
                    }
                }
            } else {
                if c1[0] != 0x1b {
                    history_entry_to_display = -1;
                }
                match c1[0] {
                    // enter
                    10 => {
                        self.echo("\n");
                        self.cursor_position = 0;
                        *input = input.trim().to_string();
                        return;
                    }
                    // backspace
                    127 => {
                        if !input.is_empty() && self.cursor_position > 0 {
                            self.echo(&format!("{}", 8 as char));
                            self.echo(&" ".repeat(input.len() - self.cursor_position + 1));
                            input.remove(self.cursor_position - 1);
                            self.cursor_position -= 1;
                            self.echo(
                                &format!("{}", 8 as char)
                                    .repeat(input.len() - self.cursor_position + 1),
                            );
                            self.echo(
                                &input.chars().skip(self.cursor_position).collect::<String>(),
                            );
                            self.echo(
                                &format!("{}", 8 as char)
                                    .repeat(input.len() - self.cursor_position),
                            );
                        }
                    }
                    // control codes
                    code if code < 32 => {
                        if code == 0x1b {
                            escaped = true;
                        }
                        // ignore rest for now
                    }
                    // regular characters
                    _ => {
                        input.insert(self.cursor_position, c1[0] as char);
                        // echo
                        self.echo(&format!(
                            "{}{}",
                            input.chars().skip(self.cursor_position).collect::<String>(),
                            format!("{}", 8 as char).repeat(input.len() - self.cursor_position - 1),
                        ));
                        self.cursor_position += 1;
                    }
                }
            }
            io::stdout().flush().unwrap();
        }
    }

    /// Expands input line with history expansion.
    fn history_expansion(&mut self, input: &str) -> HistoryExpansion {
        let mut processed = input.to_string();
        if let Some(last_command) = self.history.last() {
            processed = processed.replace("!!", last_command);
        }
        // for eg. "!12", "!-2"
        lazy_static! {
            static ref NUMBER_RE: Regex = Regex::new(r"!(-?\d+)").unwrap();
        }
        // for each match
        for captures in NUMBER_RE.captures_iter(input) {
            // get matched number
            let full_match = captures.get(0).unwrap().as_str();
            let group_match = captures.get(1).unwrap().as_str();
            let history_number = group_match.parse::<i32>().unwrap();
            let history_number = if history_number < 0 {
                (self.history.len() as i32 + history_number) as usize
            } else {
                (history_number - 1) as usize
            };
            // get that entry from history (if it exists)
            if let Some(history_cmd) = self.history.get(history_number) {
                // replace the match with the entry from history
                processed = processed.replace(full_match, history_cmd);
            } else {
                return HistoryExpansion::EventNotFound(full_match.into());
            }
        }

        // $ for eg. "!ls"
        lazy_static! {
            static ref STRING_RE: Regex = Regex::new(r"!(\w+)").unwrap();
        }
        // for each match
        for captures in STRING_RE.captures_iter(&processed.clone()) {
            let full_match = captures.get(0).unwrap().as_str();
            let group_match = captures.get(1).unwrap().as_str();

            // find history entry starting with the match
            if let Some(history_cmd) = self
                .history
                .iter()
                .rev()
                .find(|entry| entry.starts_with(group_match))
            {
                // replace the match with the entry from history
                processed = processed.replace(full_match, history_cmd);
            } else {
                return HistoryExpansion::EventNotFound(full_match.into());
            }
        }

        // don't push duplicates of last command to history
        if Some(&processed) != self.history.last() {
            self.history.push(processed.clone());
            // only write to file if it was successfully created
            if let Some(ref mut history_file) = self.history_file {
                writeln!(history_file, "{}", &processed).unwrap();
            }
        }

        if input == processed {
            HistoryExpansion::Unchanged
        } else {
            HistoryExpansion::Expanded(processed)
        }
    }

    pub fn run_interpreter(&mut self) -> Result<i32, Report> {
        if self.should_echo {
            // disable echoing on hterm side (ignore Error that will arise on wasi runtimes other
            // than ours browser implementation (i. e. wasmer/wasmtime)
            let _ = syscall("set_echo", &["0"], &HashMap::new(), false, &[]);
        }

        // TODO: see https://github.com/WebAssembly/wasi-filesystem/issues/24
        env::set_current_dir(env::var("PWD").unwrap()).unwrap();

        let history_path = {
            if PathBuf::from(env::var("HOME").unwrap()).exists() {
                format!("{}/.shell_history", env::var("HOME").unwrap())
            } else {
                format!("{}/.shell_history", env::var("PWD").unwrap())
            }
        };
        if PathBuf::from(&history_path).exists() {
            self.history = fs::read_to_string(&history_path)
                .unwrap()
                .lines()
                .map(str::to_string)
                .collect();
        }
        self.history_file = match OpenOptions::new()
            .create(true)
            .append(true)
            .open(&history_path)
        {
            Ok(file) => Some(file),
            Err(error) => {
                eprintln!("Unable to open file for storing shell history: {}", error);
                None
            }
        };

        let shellrc_path = {
            if PathBuf::from(env::var("HOME").unwrap()).exists() {
                format!("{}/.shellrc", env::var("HOME").unwrap())
            } else {
                format!("{}/.shellrc", env::var("PWD").unwrap())
            }
        };
        if PathBuf::from(&shellrc_path).exists() {
            self.run_script(shellrc_path).unwrap();
        }

        let motd_path = PathBuf::from("/etc/motd");
        if motd_path.exists() {
            println!("{}", fs::read_to_string(motd_path).unwrap());
        }

        let mut input = String::new();
        // line loop
        loop {
            self.print_prompt(&input);
            self.get_line(&mut input);
            if input.is_empty() {
                continue;
            }

            match self.history_expansion(&input) {
                HistoryExpansion::Expanded(expanded) => {
                    input = expanded;
                    continue;
                }
                HistoryExpansion::EventNotFound(event) => {
                    eprintln!("{}: event not found", event);
                }
                HistoryExpansion::Unchanged => {
                    if let Err(error) = self.handle_input(&input) {
                        eprintln!("{:#?}", error);
                    };
                }
            }

            input.clear();
        }
    }

    fn handle_input(&mut self, input: &str) -> Result<i32, Report> {
        let lex = Lexer::new(input.chars());
        let parser = DefaultParser::new(lex);
        let mut exit_status = EXIT_SUCCESS;
        for cmd in parser {
            exit_status = match cmd {
                Ok(cmd) => interpret(self, &cmd),
                Err(e) => {
                    eprintln!("shell: parse error: {:?}", e);
                    EXIT_FAILURE
                }
            }
        }
        // TODO: pass proper exit status code
        Ok(exit_status)
    }

    pub fn execute_command(
        &mut self,
        command: &str,
        args: &mut Vec<String>,
        env: &HashMap<String, String>,
        background: bool,
        redirects: &mut Vec<Redirect>,
    ) -> Result<i32, Report> {
        let od_result = OutputDevice::new(redirects);
        let mut output_device: OutputDevice;
        match od_result {
            Ok(x) => output_device = x,
            Err(s) => {
                eprintln!("shell: {}", s);
                return Ok(EXIT_FAILURE)
            }
        }
        let result: Result<i32, Report> = match command {
            // built in commands
            "clear" => {
                output_device.print(CLEAR_ESCAPE_CODE);
                Ok(EXIT_SUCCESS)
            }
            "exit" => {
                let exit_code: i32 = {
                    if args.is_empty() {
                        EXIT_SUCCESS
                    } else {
                        args[0].parse().unwrap()
                    }
                };
                exit(exit_code);
            }
            "pwd" => {
                output_device.println(&env::current_dir().unwrap().display().to_string());
                Ok(EXIT_SUCCESS)
            }
            "cd" => {
                let path = if args.is_empty() {
                    PathBuf::from(env::var("HOME").unwrap())
                } else if args[0] == "-" {
                    PathBuf::from(env::var("OLDPWD").unwrap())
                } else if args[0].starts_with('/') {
                    PathBuf::from(&args[0])
                } else {
                    PathBuf::from(&self.pwd).join(&args[0])
                };

                if !path_exists(path.to_str().unwrap())? {
                    output_device.eprintln(&format!(
                        "cd: {}: No such file or directory",
                        path.display()
                    ));
                    Ok(EXIT_FAILURE)
                } else {
                    let metadata = fs::metadata(&path).unwrap();
                    if metadata.is_file() {
                        output_device.eprintln(&format!("cd: {}: Not a directory", path.display()));
                        Ok(EXIT_FAILURE)
                    } else {
                        // TODO: for both targets, chain the commands and exit early if previous
                        // step fails
                        env::set_var("OLDPWD", env::current_dir().unwrap().to_str().unwrap());
                        #[cfg(target_os = "wasi")]
                        {
                            syscall(
                                "set_env",
                                &["OLDPWD", env::current_dir().unwrap().to_str().unwrap()],
                                env,
                                background,
                                &[],
                            )
                            .unwrap();
                            let pwd =
                                syscall("chdir", &[path.to_str().unwrap()], env, background, &[])
                                    .unwrap()
                                    .output;
                            syscall("set_env", &["PWD", &pwd], env, background, &[]).unwrap();
                            self.pwd = PathBuf::from(&pwd);
                        }
                        #[cfg(not(target_os = "wasi"))]
                        {
                            self.pwd = fs::canonicalize(path).unwrap();
                        }
                        env::set_var("PWD", &self.pwd);
                        env::set_current_dir(&self.pwd).unwrap();
                        Ok(EXIT_SUCCESS)
                    }
                }
            }
            "history" => {
                for (i, history_entry) in self.history.iter().enumerate() {
                    output_device.println(&format!("{}: {}", i + 1, history_entry));
                }
                Ok(EXIT_SUCCESS)
            }
            "unset" => {
                if args.is_empty() {
                    output_device.eprintln("unset: help: unset <VAR> [<VAR>] ...");
                    return Ok(EXIT_FAILURE);
                }
                for arg in args {
                    if arg == "PWD" || arg == "HOME" {
                        output_device.println(&format!("unset: cannot unset {}", &arg));
                    } else {
                        self.vars.remove(arg);
                        if env::var(&arg).is_ok() {
                            env::remove_var(&arg);
                            syscall("set_env", &[arg], env, background, &[]).unwrap();
                        }
                    }
                }
                Ok(EXIT_SUCCESS)
            }
            "declare" => {
                if args.is_empty() {
                    // TODO: we should join and sort the variables!
                    for (key, value) in self.vars.iter() {
                        output_device.println(&format!("{}={}", key, value));
                    }
                    for (key, value) in env::vars() {
                        output_device.println(&format!("{}={}", key, value));
                    }
                } else if args[0] == "-x" || args[0] == "+x" {
                    // if -x is provided declare works as export
                    // if +x then makes global var local
                    for arg in args.iter().skip(1) {
                        if args[0] == "-x" {
                            if let Some((key, value)) = arg.split_once("=") {
                                syscall("set_env", &[key, value], env, background, &[]).unwrap();
                            }
                        } else if let Some((key, value)) = arg.split_once("=") {
                            syscall("set_env", &[key], env, background, &[]).unwrap();
                            self.vars.insert(key.to_string(), value.to_string());
                        } else {
                            let value = env::var(arg).unwrap();
                            syscall("set_env", &[arg], env, background, &[]).unwrap();
                            self.vars.insert(arg.clone(), value.clone());
                        }
                    }
                } else {
                    for arg in args {
                        if let Some((key, value)) = arg.split_once("=") {
                            self.vars.insert(key.to_string(), value.to_string());
                        }
                    }
                }
                Ok(EXIT_SUCCESS)
            }
            "export" => {
                // export creates an env value if A=B notation is used,
                // or just copies a local var to env if "=" is not used.
                // Export on nonexisting local var exports empty variable.
                if args.is_empty() {
                    output_device
                        .eprintln("export: help: export <VAR>[=<VALUE>] [<VAR>[=<VALUE>]] ...");
                    return Ok(EXIT_FAILURE);
                }
                for arg in args {
                    if let Some((key, value)) = arg.split_once("=") {
                        self.vars.remove(key);
                        env::set_var(&key, &value);
                        syscall("set_env", &[key, value], env, background, &[]).unwrap();
                    } else if let Some(value) = self.vars.remove(arg) {
                        env::set_var(&arg, &value);
                        syscall("set_env", &[arg, &value], env, background, &[]).unwrap();
                    } else {
                        env::set_var(&arg, "");
                        syscall("set_env", &[arg, ""], env, background, &[]).unwrap();
                    }
                }
                Ok(EXIT_SUCCESS)
            }
            "source" => {
                if let Some(filename) = args.get(0) {
                    self.run_script(filename).unwrap();
                    Ok(EXIT_SUCCESS)
                } else {
                    output_device.eprintln("source: help: source <filename>");
                    Ok(EXIT_FAILURE)
                }
            }
            "write" => {
                if args.len() < 2 {
                    output_device.eprintln("write: help: write <filename> <contents>");
                    Ok(EXIT_FAILURE)
                } else {
                    let filename = args.remove(0);
                    let content = args.join(" ");
                    match fs::write(&filename, &content) {
                        Ok(_) => Ok(EXIT_SUCCESS),
                        Err(error) => {
                            output_device.eprintln(&format!(
                                "write: failed to write to file '{}': {}",
                                filename, error
                            ));
                            Ok(EXIT_FAILURE)
                        }
                    }
                }
            }
            "imgcat" => {
                if args.is_empty() {
                    output_device.eprintln("usage: imgcat <IMAGE>");
                    Ok(EXIT_FAILURE)
                } else {
                    // TODO: find out why it breaks the order of prompt
                    iterm2::File::read(&args[0])
                        .unwrap()
                        .width(iterm2::Dimension::Auto)
                        .height(iterm2::Dimension::Auto)
                        .preserve_aspect_ratio(true)
                        .show()
                        .unwrap();
                    Ok(EXIT_SUCCESS)
                }
            }
            "unzip" => {
                if let Some(filepath) = &args.get(0) {
                    let file = fs::File::open(&PathBuf::from(filepath)).unwrap();
                    let mut archive = zip::ZipArchive::new(file).unwrap();
                    for i in 0..archive.len() {
                        let mut file = archive.by_index(i).unwrap();
                        let output_path = file.enclosed_name().to_owned().unwrap();
                        if file.name().ends_with('/') {
                            output_device
                                .println(&format!("creating dir {}", output_path.display()));
                            fs::create_dir_all(&output_path).unwrap();
                            continue;
                        }
                        if let Some(parent) = output_path.parent() {
                            if !parent.exists() {
                                output_device
                                    .println(&format!("creating dir {}", parent.display()));
                                fs::create_dir_all(&parent).unwrap();
                            }
                        }
                        output_device.println(&format!(
                            "decompressing {}",
                            file.enclosed_name().unwrap().display()
                        ));
                        let mut output_file = fs::File::create(&output_path).unwrap();
                        io::copy(&mut file, &mut output_file).unwrap();
                        println!(
                            "decompressing {} done.",
                            file.enclosed_name().unwrap().display()
                        );
                    }
                    Ok(EXIT_SUCCESS)
                } else {
                    output_device.eprintln("unzip: missing operand");
                    Ok(EXIT_FAILURE)
                }
            }
            "sleep" => {
                // TODO: requires poll_oneoff implementation
                if let Some(sec_str) = &args.get(0) {
                    if let Ok(sec) = sec_str.parse() {
                        thread::sleep(Duration::new(sec, 0));
                        Ok(EXIT_SUCCESS)
                    } else {
                        output_device
                            .eprintln(&format!("sleep: invalid time interval `{}`", sec_str));
                        Ok(EXIT_FAILURE)
                    }
                } else {
                    output_device.eprintln("sleep: missing operand");
                    Ok(EXIT_FAILURE)
                }
            }
            "hexdump" => {
                if args.is_empty() {
                    output_device.eprintln("hexdump: help: hexdump <filename>");
                    Ok(EXIT_FAILURE)
                } else {
                    let contents = fs::read(args.remove(0)).unwrap_or_else(|_| {
                        output_device.println("hexdump: error: file not found.");
                        return vec![];
                    });
                    let len = contents.len();
                    let mut v = ['.'; 16];
                    for j in 0..len {
                        let c = contents[j] as char;
                        v[j % 16] = c;
                        if (j % 16) == 0 {
                            output_device.print(&format!("{:08x} ", j));
                        }
                        if (j % 8) == 0 {
                            output_device.print(" ");
                        }
                        output_device.print(&format!("{:02x} ", c as u8));
                        if (j + 1) == len || (j % 16) == 15 {
                            let mut count = 16;
                            if (j + 1) == len {
                                count = len % 16;
                                for _ in 0..(16 - (len % 16)) {
                                    output_device.print("   ");
                                }
                                if count < 8 {
                                    output_device.print(" ");
                                }
                            }
                            output_device.print(" |");
                            for c in v.iter_mut().take(count) {
                                if (0x20..0x7e).contains(&(*c as u8)) {
                                    output_device.print(&format!("{}", *c as char));
                                    *c = '.';
                                } else {
                                    output_device.print(".");
                                }
                            }
                            output_device.println("|");
                        }
                    }
                    Ok(EXIT_SUCCESS)
                }
            }
            // external commands or command not found
            _ => {
                let full_path = if command.starts_with('/') {
                    let full_path = PathBuf::from(command);
                    if path_exists(full_path.to_str().unwrap())? {
                        Ok(full_path)
                    } else {
                        Err(format!(
                            "{}: no such file or directory",
                            full_path.display()
                        ))
                    }
                } else if command.starts_with('.') {
                    let path = PathBuf::from(&self.pwd);
                    let full_path = path.join(command);
                    if path_exists(full_path.to_str().unwrap())? {
                        Ok(full_path)
                    } else {
                        Err(format!(
                            "{}: no such file or directory",
                            full_path.display()
                        ))
                    }
                } else {
                    let mut found = false;
                    let mut full_path = PathBuf::new();
                    // get PATH env variable, split it and look for binaries in each directory
                    for bin_dir in env::var("PATH").unwrap_or_default().split(':') {
                        let bin_dir = PathBuf::from(bin_dir);
                        full_path = bin_dir.join(&command);
                        // see https://internals.rust-lang.org/t/the-api-of-path-exists-encourages-broken-code/13817/3
                        if path_exists(full_path.to_str().unwrap())? {
                            found = true;
                            break;
                        }
                    }
                    if found {
                        Ok(full_path)
                    } else {
                        Err(format!("{}: command not found", command))
                    }
                };

                match full_path {
                    Ok(path) => {
                        let file = File::open(&path).unwrap();
                        if let Some(Ok(line)) = BufReader::new(file).lines().next() {
                            // file starts with valid UTF-8, most likely a script
                            let binary_path = if let Some(path) = line.strip_prefix("#!") {
                                path.trim().to_string()
                            } else {
                                env::var("SHELL").unwrap()
                            };
                            args.insert(0, binary_path);
                            let args_: Vec<&str> = args.iter().map(|s| &**s).collect();
                            // TODO: how does this interact with stdin redirects inside the script?
                            let mut redirects = redirects.clone();
                            redirects.push(Redirect::Read((
                                STDIN,
                                path.into_os_string().into_string().unwrap(),
                            )));
                            Ok(syscall("spawn", &args_[..], env, background, &redirects)
                                .unwrap()
                                .exit_status)
                        } else {
                            // most likely WASM binary
                            args.insert(0, path.into_os_string().into_string().unwrap());
                            let args_: Vec<&str> = args.iter().map(|s| &**s).collect();
                            Ok(syscall("spawn", &args_[..], env, background, redirects)
                                .unwrap()
                                .exit_status)
                        }
                    }
                    Err(reason) => {
                        output_device.eprintln(&format!("shell: {}", &reason));
                        Ok(EXIT_FAILURE)
                    }
                }
            }
        };

        output_device.flush()?;

        self.last_exit_status = if let Ok(exit_status) = result {
            exit_status
        } else {
            EXIT_CRITICAL_FAILURE
        };
        Ok(self.last_exit_status)
    }
}
