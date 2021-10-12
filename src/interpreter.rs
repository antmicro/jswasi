use conch_parser::ast;
use std::collections::HashMap;
use std::env;

use crate::shell_base::{syscall, Shell};

pub fn interpret(shell: &mut Shell, cmd: &ast::TopLevelCommand<String>) {
    // println!("{:#?}", cmd);
    match &cmd.0 {
        ast::Command::Job(list) => handle_listable_command(shell, list, true),
        ast::Command::List(list) => handle_listable_command(shell, list, false),
    };
}

fn handle_listable_command(shell: &mut Shell, list: &ast::DefaultAndOrList, background: bool) {
    match &list.first {
        ast::ListableCommand::Single(cmd) => match cmd {
            ast::PipeableCommand::Simple(cmd) => handle_simple_command(shell, &cmd, background),
            any => println!("{:#?}", any),
        },
        ast::ListableCommand::Pipe(_, _cmds) => println!("{:#?}", _cmds), // TODO: handle pipes
    }

    // TODO: handle list.rest
}

fn handle_simple_command(shell: &mut Shell, cmd: &ast::DefaultSimpleCommand, background: bool) {
    let env = cmd
        .redirects_or_env_vars
        .iter()
        .filter_map(|redirect_or_env_var| match redirect_or_env_var {
            ast::RedirectOrEnvVar::EnvVar(key, value) => {
                let value = match value {
                    None => Some("".to_string()),
                    Some(top_level_word) => handle_top_level_word(&shell, &top_level_word),
                };
                match value {
                    None => None,
                    Some(value) => Some((key.clone(), value)),
                }
            }
            _ => None,
        })
        .collect::<HashMap<_, _>>();
    let mut words = cmd
        .redirects_or_cmd_words
        .iter()
        .filter_map(|redirect_or_cmd_word| match redirect_or_cmd_word {
            ast::RedirectOrCmdWord::Redirect(_) => None, // TODO: handle redirects
            ast::RedirectOrCmdWord::CmdWord(cmd_word) => handle_top_level_word(&shell, &cmd_word.0),
        });

    if let Some(command) = words.next() {
        let mut args = words.collect::<Vec<_>>();
        let result = shell.execute_command(&command, &mut args, &env, background);
    } else {
        for (key, value) in env.iter() {
            // if it's a global update env, if shell variable update only vars
            if env::var(key).is_ok() {
                env::set_var(&key, &value);
                syscall("set_env", &[&key, &value], &env, false);
            } else {
                shell.vars.insert(key.clone(), value.clone());
            }
        }
    }
}

fn handle_top_level_word<'a>(
    shell: &'a Shell,
    word: &'a ast::DefaultComplexWord,
) -> Option<String> {
    match word {
        ast::ComplexWord::Single(word) => handle_single(&shell, word),
        ast::ComplexWord::Concat(words) => Some(
            words
                .iter()
                .filter_map(|w| handle_single(&shell, w))
                .collect::<Vec<_>>()
                .join(""),
        ),
    }
}

fn handle_single<'a>(shell: &'a Shell, word: &'a ast::DefaultWord) -> Option<String> {
    match &word {
        ast::Word::SingleQuoted(w) => Some(w.clone()),
        ast::Word::Simple(w) => handle_simple_word(&shell, w),
        ast::Word::DoubleQuoted(words) => Some(
            words
                .iter()
                .filter_map(|w| handle_simple_word(&shell, w))
                .collect::<Vec<_>>()
                .join(" "),
        ),
    }
}

fn handle_simple_word<'a>(shell: &'a Shell, word: &'a ast::DefaultSimpleWord) -> Option<String> {
    match word {
        ast::SimpleWord::Literal(w) => Some(w.clone()),
        ast::SimpleWord::Colon => Some(":".to_string()),
        ast::SimpleWord::Tilde => Some(env::var("HOME").unwrap()),
        ast::SimpleWord::Param(p) => match p {
            ast::Parameter::Var(key) => {
                if let Some(variable) = shell.vars.get(key) {
                    Some(variable.clone())
                } else {
                    env::var(key).ok()
                }
            }
            any => Some(format!("{:?}", any)),
        },
        any => Some(format!("{:?}", any)),
    }
}
