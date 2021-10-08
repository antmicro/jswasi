use conch_parser::ast;
use std::env;
use std::collections::HashMap;

use crate::shell_base::{Shell, syscall};

pub fn interpret(shell: &Shell, cmd: &ast::TopLevelCommand<String>) {
    // println!("{:#?}", cmd);
    match &cmd.0 {
        ast::Command::Job(list) => handle_listable_command(&shell, list, true),
        ast::Command::List(list) => handle_listable_command(&shell, list, false),
    };
    // dbg!(&actions);
}

fn handle_listable_command(shell: &Shell, list: &ast::DefaultAndOrList, background: bool) {
    match &list.first {
        ast::ListableCommand::Single(cmd) => {
            match cmd {
                ast::PipeableCommand::Simple(cmd) => handle_simple_command(&shell, &cmd, background),
                any => println!("{:#?}", any),
            }
        }
        ast::ListableCommand::Pipe(_, _cmds) => println!("{:#?}", _cmds), // TODO: handle pipes
    }

    // TODO: handle list.rest
}

fn handle_simple_command(shell: &Shell, cmd: &ast::DefaultSimpleCommand, background: bool) {
    let env = cmd
        .redirects_or_env_vars
        .iter()
        .filter_map(|redirect_or_env_var| match redirect_or_env_var {
            ast::RedirectOrEnvVar::EnvVar(key, value) => {
                let value = match value {
                    None => Some(""),
                    Some(top_level_word) => handle_top_level_word(&shell, &top_level_word),
                };
                match value {
                    None => None,
                    Some(value) => Some((
                        key,
                        value,
                    )),
                }
            }
            _ => None,
        })
        .collect::<HashMap::<_, _>>();
    let (command, args) = cmd
        .redirects_or_cmd_words
        .iter()
        .filter_map(|redirect_or_cmd_word| match redirect_or_cmd_word {
            ast::RedirectOrCmdWord::Redirect(_) => None, // TODO: handle redirects
            ast::RedirectOrCmdWord::CmdWord(cmd_word) => {
                handle_top_level_word(&shell, &cmd_word.0)
            }
        })
        .collect::<Vec<&str>>()
        .split_first().unwrap();
 
    let result = syscall(&command, &args, &env, background);
}


fn handle_top_level_word<'a>(shell: &'a Shell, word: &'a ast::DefaultComplexWord) -> Option<&'a str> {
    match word {
        ast::ComplexWord::Single(word) => handle_single(&shell, word),
        ast::ComplexWord::Concat(words) => Some(
            &words
                .iter()
                .filter_map(|w| handle_single(&shell, w))
                .collect::<Vec<_>>()
                .join(""),
        ),
    }
}

fn handle_single<'a>(shell: &'a Shell, word: &'a ast::DefaultWord) -> Option<&'a str> {
    match &word {
        ast::Word::SingleQuoted(w) => Some(&w),
        ast::Word::Simple(w) => handle_simple_word(&shell, w),
        ast::Word::DoubleQuoted(words) => Some(
            &words
                .iter()
                .filter_map(|w| handle_simple_word(&shell, w))
                .collect::<Vec<_>>()
                .join(" "),
        ),
    }
}

fn handle_simple_word<'a>(shell: &'a Shell, word: &'a ast::DefaultSimpleWord) -> Option<&'a str> {
    match word {
        ast::SimpleWord::Literal(w) => Some(&w),
        ast::SimpleWord::Colon => Some(":"),
        ast::SimpleWord::Tilde => Some(&env::var("HOME").unwrap()),
        ast::SimpleWord::Param(p) => match p {
            ast::Parameter::Var(key) => {
                if let Some(variable) = shell.vars.get(key) {
                    Some(&variable)
                } else {
                    env::var(key).ok().as_deref()
                }
            }
            any => Some(&format!("{:?}", any)),
        },
        any => Some(&format!("{:?}", any)),
    }
}
