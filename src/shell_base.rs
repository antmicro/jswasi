use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::io;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::thread;
use std::time::Duration;
use substring::Substring;

use conch_parser::lexer::Lexer;
use conch_parser::parse::DefaultParser;
use iterm2;

use crate::interpreter::interpret;

use std::collections::HashMap;

// communicate with the worker thread
pub fn syscall(
    command: &str,
    args: &[&str],
    env: &HashMap<String, String>,
    background: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    #[cfg(target_os = "wasi")]
    let result = fs::read_link(format!(
        "/!{}\x1b\x1b{}\x1b\x1b{}\x1b\x1b{}",
        command,
        args.join("\x1b"),
        env.iter()
            .map(|(key, val)| format!("{}={}", key, val))
            .collect::<Vec<_>>()
            .join("\x1b"),
        background
    ))?;
    #[cfg(not(target_os = "wasi"))]
    let result = {
        if command == "spawn" {
            let mut iter = args.iter();
            let mut cmd = std::process::Command::new(iter.next().unwrap());
            for arg in iter {
                cmd.arg(arg);
            }
            let mut app = cmd.spawn().unwrap();
            app.wait()?;
        }
        PathBuf::from("")
    };
    Ok(result
        .to_str()
        .unwrap()
        .trim_matches(char::from(0))
        .to_string())
}

pub struct Shell {
    pub pwd: String,
    pub history: Vec<String>,
    pub vars: HashMap<String, String>,
}

impl Shell {
    pub fn new(pwd: &str) -> Self {
        Shell {
            pwd: pwd.to_string(),
            history: Vec::new(),
            vars: HashMap::new(),
        }
    }

    pub fn run_command(&mut self, command: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.handle_input(command)
    }

    pub fn run_script(
        &mut self,
        script_name: impl Into<PathBuf>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.handle_input(&fs::read_to_string(script_name.into())?)
    }

    pub fn run_interpreter(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        // disable echoing on hterm side (ignore Error that will arise on platforms other than web
        let _ = syscall("set_echo", &["0"], &HashMap::new(), false);

        // TODO: see https://github.com/WebAssembly/wasi-filesystem/issues/24
        env::set_current_dir(env::var("PWD")?)?;

        let history_path = {
            if PathBuf::from(env::var("HOME")?).exists() {
                format!("{}/.shell_history", env::var("HOME")?)
            } else {
                format!("{}/.shell_history", env::var("PWD")?)
            }
        };
        if PathBuf::from(&history_path).exists() {
            self.history = fs::read_to_string(&history_path)?
                .lines()
                .map(str::to_string)
                .collect();
        }
        let mut shell_history = match OpenOptions::new()
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
            if PathBuf::from(env::var("HOME")?).exists() {
                format!("{}/.shellrc", env::var("HOME")?)
            } else {
                format!("{}/.shellrc", env::var("PWD")?)
            }
        };
        if PathBuf::from(&shellrc_path).exists() {
            self.run_script(shellrc_path)?;
        }

        let mut cursor_position = 0;

        let motd_path = PathBuf::from("/etc/motd");
        if motd_path.exists() {
            println!("{}", fs::read_to_string(motd_path)?);
        }

        loop {
            let mut input = String::new();
            let mut input_stash = String::new();
            let mut display_path = String::new();

            // prompt for input
            if self.pwd.substring(0, env::var("HOME")?.len()) == env::var("HOME")? {
                display_path.push_str(&format!(
                    "~{}",
                    self.pwd.substring(env::var("HOME")?.len(), 4096)
                ));
            } else {
                display_path.push_str(&self.pwd);
            }
            print!("\x1b[1;34mant@webshell \x1b[1;33m{}$ \x1b[0m", display_path);
            io::stdout().flush()?;

            let mut c1 = [0];
            let mut escaped = false;
            let mut history_entry_to_display: i32 = -1;
            // read line
            loop {
                io::stdin().read_exact(&mut c1)?;
                if escaped {
                    match c1[0] {
                        0x5b => {
                            let mut c2 = [0];
                            io::stdin().read_exact(&mut c2)?;
                            match c2[0] {
                                0x32 | 0x33 | 0x35 | 0x36 => {
                                    let mut c3 = [0];
                                    io::stdin().read_exact(&mut c3)?;
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
                                            if input.len() - cursor_position > 0 {
                                                print!(
                                                    "{}",
                                                    " ".repeat(input.len() - cursor_position + 1)
                                                );
                                                input.remove(cursor_position);
                                                print!(
                                                    "{}",
                                                    format!("{}", 8 as char)
                                                        .repeat(input.len() - cursor_position + 2)
                                                );
                                                print!(
                                                    "{}",
                                                    input
                                                        .chars()
                                                        .skip(cursor_position)
                                                        .collect::<String>(),
                                                );
                                                print!(
                                                    "{}",
                                                    format!("{}", 8 as char)
                                                        .repeat(input.len() - cursor_position)
                                                );
                                            }
                                            escaped = false;
                                        }
                                        [0x33, 0x3b] => {
                                            println!("TODO: SHIFT + DELETE");
                                            let mut c4 = [0];
                                            // TWO MORE! TODO: improve!
                                            io::stdin().read_exact(&mut c4)?;
                                            io::stdin().read_exact(&mut c4)?;
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
                                            history_entry_to_display =
                                                (self.history.len() - 1) as i32;
                                            input_stash = input.clone();
                                        } else if history_entry_to_display > 0 {
                                            history_entry_to_display -= 1;
                                        }
                                        // bring cursor to the end so that clearing later starts from
                                        // proper position
                                        print!(
                                            "{}",
                                            input.chars().skip(cursor_position).collect::<String>(),
                                        );
                                        for _ in 0..input.len() {
                                            print!("{} {}", 8 as char, 8 as char);
                                            // '\b \b', clear left of cursor
                                        }
                                        input =
                                            self.history[history_entry_to_display as usize].clone();
                                        cursor_position = input.len();
                                        print!("{}", input);
                                    }
                                    escaped = false;
                                }
                                // down arrow
                                0x42 => {
                                    if history_entry_to_display != -1 {
                                        // bring cursor to the end so that clearing later starts from
                                        // proper position
                                        print!(
                                            "{}",
                                            input.chars().skip(cursor_position).collect::<String>(),
                                        );
                                        for _ in 0..input.len() {
                                            print!("{} {}", 8 as char, 8 as char);
                                            // '\b \b', clear left of cursor
                                        }
                                        if self.history.len() - 1
                                            > (history_entry_to_display as usize)
                                        {
                                            history_entry_to_display += 1;
                                            input = self.history[history_entry_to_display as usize]
                                                .clone();
                                        } else {
                                            input = input_stash.clone();
                                            history_entry_to_display = -1;
                                        }
                                        cursor_position = input.len();
                                        print!("{}", input);
                                    }
                                    escaped = false;
                                }
                                // right arrow
                                0x43 => {
                                    if cursor_position < input.len() {
                                        print!("{}", input.chars().nth(cursor_position).unwrap());
                                        cursor_position += 1;
                                    }
                                    escaped = false;
                                }
                                // left arrow
                                0x44 => {
                                    if cursor_position > 0 {
                                        print!("{}", 8 as char);
                                        cursor_position -= 1;
                                    }
                                    escaped = false;
                                }
                                // end key
                                0x46 => {
                                    print!(
                                        "{}",
                                        input.chars().skip(cursor_position).collect::<String>(),
                                    );
                                    cursor_position = input.len();
                                    escaped = false;
                                }
                                // home key
                                0x48 => {
                                    print!("{}", format!("{}", 8 as char).repeat(cursor_position));
                                    cursor_position = 0;
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
                            input = input.trim().to_string();
                            println!();
                            cursor_position = 0;
                            break;
                        }
                        // backspace
                        127 => {
                            if !input.is_empty() && cursor_position > 0 {
                                print!("{}", 8 as char);
                                print!("{}", " ".repeat(input.len() - cursor_position + 1));
                                input.remove(cursor_position - 1);
                                cursor_position -= 1;
                                print!(
                                    "{}",
                                    format!("{}", 8 as char)
                                        .repeat(input.len() - cursor_position + 1)
                                );
                                print!(
                                    "{}",
                                    input.chars().skip(cursor_position).collect::<String>(),
                                );
                                print!(
                                    "{}",
                                    format!("{}", 8 as char).repeat(input.len() - cursor_position)
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
                            input.insert(cursor_position, c1[0] as char);
                            // echo
                            print!(
                                "{}{}",
                                input.chars().skip(cursor_position).collect::<String>(),
                                format!("{}", 8 as char).repeat(input.len() - cursor_position - 1)
                            );
                            cursor_position += 1;
                        }
                    }
                }
                io::stdout().flush()?;
            }

            // handle line

            // TODO: incorporate this into interpreter of parsed input

            if input.replace(" ", "").is_empty() {
                continue;
            }

            // handle '!' history
            if input.starts_with('!') {
                let sbstr = input
                    .split_whitespace()
                    .next()
                    .unwrap()
                    .substring(1, 64)
                    .split_whitespace()
                    .next()
                    .unwrap();
                let history_entry_id: usize = sbstr.parse().unwrap_or_else(|_| {
                    if sbstr.is_empty() {
                        return 0;
                    }
                    let mut j = 0;
                    let mut found = 0;
                    for entry in &self.history {
                        j += 1;
                        if entry.substring(0, sbstr.len()) == sbstr {
                            found = j;
                            break;
                        }
                    }
                    found
                });
                if history_entry_id == 0 || self.history.len() < history_entry_id {
                    if sbstr.is_empty() {
                        println!("!{}: event not found", sbstr);
                    }
                    input.clear();
                    continue;
                } else {
                    let input = format!(
                        "{}{}",
                        self.history[history_entry_id - 1],
                        input.strip_prefix(&format!("!{}", sbstr)).unwrap()
                    );
                    cursor_position = input.len();
                }
            }

            // only write to file is successfully created
            if let Some(ref mut shell_history) = shell_history {
                // don't push !commands and duplicate commands
                if input.substring(0, 1) != "!" && Some(&input) != self.history.last() {
                    self.history.push(input.clone());
                    writeln!(shell_history, "{}", &input)?;
                }
            }

            if let Err(error) = self.handle_input(&input) {
                println!("{:#?}", error);
            };
        }
    }

    fn handle_input(&mut self, input: &str) -> Result<(), Box<dyn std::error::Error>> {
        let lex = Lexer::new(input.chars());
        let parser = DefaultParser::new(lex);
        for cmd in parser {
            match cmd {
                Ok(cmd) => interpret(self, &cmd),
                Err(e) => {
                    println!("{:?}", e);
                }
            }
        }
        Ok(())
    }

    pub fn execute_command(
        &mut self,
        command: &str,
        args: &mut Vec<String>,
        env: &HashMap<String, String>,
        background: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        match command {
            // built in commands
            "clear" => {
                print!("\x1b[2J\x1b[H");
            }
            "exit" => {
                let exit_code: i32 = {
                    if args.is_empty() {
                        0
                    } else {
                        args[0].parse()?
                    }
                };
                exit(exit_code);
            }
            "pwd" => println!("{}", env::current_dir()?.display()),
            "cd" => {
                let path = if args.is_empty() {
                    PathBuf::from(env::var("HOME")?)
                } else if args[0] == "-" {
                    PathBuf::from(env::var("OLDPWD")?)
                } else if args[0].starts_with('/') {
                    PathBuf::from(&args[0])
                } else {
                    PathBuf::from(&self.pwd).join(&args[0])
                };

                // simply including this in source breaks shell
                if !Path::new(&path).exists() {
                    println!("cd: {}: No such file or directory", path.display());
                } else {
                    let metadata = fs::metadata(&path);
                    if metadata.unwrap().is_file() {
                        println!("cd: {}: Not a directory", path.display());
                    } else {
                        env::set_var("OLDPWD", env::current_dir()?.to_str().unwrap());
                        syscall(
                            "set_env",
                            &["OLDPWD", env::current_dir()?.to_str().unwrap()],
                            env,
                            background,
                        )?;
                        #[cfg(not(target_os = "wasi"))]
                        let pwd_path = fs::canonicalize(path)?;
                        #[cfg(target_os = "wasi")]
                        let pwd_path = PathBuf::from(syscall(
                            "set_env",
                            &["PWD", path.to_str().unwrap()],
                            env,
                            background,
                        )?);
                        self.pwd = String::from(pwd_path.to_str().unwrap());
                        env::set_var("PWD", &self.pwd);
                        env::set_current_dir(&pwd_path)?;
                    }
                }
            }
            "history" => {
                for (i, history_entry) in self.history.iter().enumerate() {
                    println!("{}: {}", i, history_entry);
                }
            }
            "unset" => {
                if args.is_empty() {
                    println!("unset: help: unset <VAR> [<VAR>] ...");
                }
                for arg in args {
                    if arg == "PWD" || arg == "HOME" {
                        println!("unset: cannot unset {}", &arg);
                    } else {
                        self.vars.remove(arg);
                        if env::var(&arg).is_ok() {
                            env::remove_var(&arg);
                            syscall("set_env", &[arg], env, background)?;
                        }
                    }
                }
            }
            "declare" => {
                if args.is_empty() {
                    // TODO: we should join and sort the variables!
                    for (key, value) in self.vars.iter() {
                        println!("{}={}", key, value);
                    }
                    for (key, value) in env::vars() {
                        println!("{}={}", key, value);
                    }
                } else if args[0] == "-x" || args[0] == "+x" {
                    // if -x is provided declare works as export
                    // if +x then makes global var local
                    for arg in args.iter().skip(1) {
                        if args[0] == "-x" {
                            if let Some((key, value)) = arg.split_once("=") {
                                syscall("set_env", &[key, value], env, background)?;
                            }
                        } else if let Some((key, value)) = arg.split_once("=") {
                            syscall("set_env", &[key], env, background)?;
                            self.vars.insert(key.to_string(), value.to_string());
                        } else {
                            let value = env::var(arg)?;
                            syscall("set_env", &[arg], env, background)?;
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
            }
            "export" => {
                // export creates an env value if A=B notation is used, or just
                // copies a local var to env if no "=" is used.
                // export on unexisting local var exports empty variable.
                if args.is_empty() {
                    println!("export: help: export <VAR>[=<VALUE>] [<VAR>[=<VALUE>]] ...");
                }
                for arg in args {
                    if let Some((key, value)) = arg.split_once("=") {
                        self.vars.remove(key);
                        env::set_var(&key, &value);
                        syscall("set_env", &[key, value], env, background)?;
                    } else if let Some(value) = self.vars.remove(arg) {
                        env::set_var(&arg, &value);
                        syscall("set_env", &[arg, &value], env, background)?;
                    } else {
                        env::set_var(&arg, "");
                        syscall("set_env", &[arg, ""], env, background)?;
                    }
                }
            }
            "source" => {
                if let Some(filename) = args.get(0) {
                    self.run_script(filename)?;
                } else {
                    println!("source: help: source <filename>");
                }
            }
            "write" => {
                if args.len() < 2 {
                    println!("write: help: write <filename> <contents>");
                } else {
                    match fs::write(args.remove(0), args.join(" ")) {
                        Ok(_) => {}
                        Err(error) => {
                            println!("write: failed to write to file: {}", error)
                        }
                    }
                }
            }
            "imgcat" => {
                if args.is_empty() {
                    println!("usage: imgcat <IMAGE>");
                } else {
                    // TODO: find out why it breaks the order of prompt
                    iterm2::File::read(&args[0])?
                        .width(iterm2::Dimension::Auto)
                        .height(iterm2::Dimension::Auto)
                        .preserve_aspect_ratio(true)
                        .show()?;
                }
            }
            "unzip" => {
                if let Some(filepath) = &args.get(0) {
                    let file = fs::File::open(&PathBuf::from(filepath))?;
                    let mut archive = zip::ZipArchive::new(file)?;
                    for i in 0..archive.len() {
                        let mut file = archive.by_index(i)?;
                        let outpath = file.enclosed_name().to_owned().unwrap();
                        if file.name().ends_with('/') {
                            println!("creating dir {}", outpath.display());
                            fs::create_dir_all(&outpath)?;
                            continue;
                        }
                        if let Some(parent) = outpath.parent() {
                            if !parent.exists() {
                                println!("creating dir {}", parent.display());
                                fs::create_dir_all(&parent)?;
                            }
                        }
                        println!("decompressing {}", file.enclosed_name().unwrap().display());
                        let mut outfile = fs::File::create(&outpath)?;
                        io::copy(&mut file, &mut outfile)?;
                        println!(
                            "decompressing {} done.",
                            file.enclosed_name().unwrap().display()
                        );
                    }
                } else {
                    println!("unzip: missing operand");
                }
            }
            "sleep" => {
                // TODO: requires poll_oneoff implementation
                if let Some(sec_str) = &args.get(0) {
                    if let Ok(sec) = sec_str.parse() {
                        thread::sleep(Duration::new(sec, 0));
                    } else {
                        println!("sleep: invalid time interval `{}`", sec_str);
                    }
                } else {
                    println!("sleep: missing operand");
                }
            }
            "hexdump" => {
                if args.is_empty() {
                    println!("hexdump: help: hexump <filename>");
                } else {
                    let contents = fs::read(args.remove(0)).unwrap_or_else(|_| {
                        println!("hexdump: error: file not found.");
                        return vec![];
                    });
                    let len = contents.len();
                    let mut v = ['.'; 16];
                    for j in 0..len {
                        let c = contents[j] as char;
                        v[j % 16] = c;
                        if (j % 16) == 0 {
                            print!("{:08x} ", j);
                        }
                        if (j % 8) == 0 {
                            print!(" ");
                        }
                        print!("{:02x} ", c as u8);
                        if (j + 1) == len || (j % 16) == 15 {
                            let mut count = 16;
                            if (j + 1) == len {
                                count = len % 16;
                                for _ in 0..(16 - (len % 16)) {
                                    print!("   ");
                                }
                                if count < 8 {
                                    print!(" ");
                                }
                            }
                            print!(" |");
                            for c in v.iter_mut().take(count) {
                                if (0x20..0x7e).contains(&(*c as u8)) {
                                    print!("{}", *c as char);
                                    *c = '.';
                                } else {
                                    print!(".");
                                }
                            }
                            println!("|");
                        }
                    }
                }
            }
            "mkdir" | "rmdir" | "touch" | "rm" | "mv" | "cp" | "echo" | "date" | "ls"
            | "printf" | "env" | "cat" | "realpath" | "ln" | "printenv" | "md5sum" => {
                args.insert(0, command.to_string());
                #[cfg(target_os = "wasi")]
                args.insert(0, String::from("/usr/bin/coreutils"));
                #[cfg(not(target_os = "wasi"))]
                args.insert(0, String::from("/bin/busybox"));
                let args_: Vec<&str> = args.iter().map(|s| &**s).collect();
                syscall("spawn", &args_[..], env, background)?;
            }
            // no input
            "" => {}
            // external commands or command not found
            _ => {
                let fullpath = if command.starts_with('/') {
                    let fullpath = PathBuf::from(command);
                    if fullpath.is_file() {
                        Ok(fullpath)
                    } else {
                        Err(format!(
                            "shell: no such file or directory: {}",
                            fullpath.display()
                        ))
                    }
                } else if command.starts_with('.') {
                    let path = PathBuf::from(&self.pwd);
                    let fullpath = path.join(command);
                    if fullpath.is_file() {
                        Ok(fullpath)
                    } else {
                        Err(format!(
                            "shell: no such file or directory: {}",
                            fullpath.display()
                        ))
                    }
                } else {
                    let mut found = false;
                    let mut fullpath = PathBuf::new();
                    // get PATH env variable, split it and look for binaries in each directory
                    for bin_dir in env::var("PATH").unwrap_or_default().split(':') {
                        let bin_dir = PathBuf::from(bin_dir);
                        fullpath = bin_dir.join(&command);
                        if fullpath.is_file() {
                            found = true;
                            break;
                        }
                    }
                    if found {
                        Ok(fullpath)
                    } else {
                        Err(format!("command not found: {}", command))
                    }
                };

                match fullpath {
                    Ok(path) => {
                        args.insert(0, path.display().to_string());
                        let args_: Vec<&str> = args.iter().map(|s| &**s).collect();
                        let _result = syscall("spawn", &args_[..], env, background)?;
                    }
                    Err(reason) => println!("{}", reason),
                }
            }
        }
        Ok(())
    }
}
