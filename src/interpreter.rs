use conch_parser::ast;
use std::env;

use crate::shell_base::{Shell, syscall};

#[derive(Debug)]
pub enum Action {
    Command {
        name: String,
        args: Vec<String>,
        background: bool,
    },
    SetEnv {
        key: String,
        value: String,
    },
    Invalid,
}

pub fn interpret(shell: &Shell, cmd: &ast::TopLevelCommand<String>) -> Vec<Action> {
    // println!("{:#?}", cmd);
    let actions = match &cmd.0 {
        ast::Command::Job(list) => handle_listable_command(&shell, list, true),
        ast::Command::List(list) => handle_listable_command(&shell, list, false),
    };
    // dbg!(&actions);
    actions
}

fn handle_listable_command(shell: &Shell, list: &ast::DefaultAndOrList, background: bool) -> Vec<Action> {
    match &list.first {
        ast::ListableCommand::Single(cmd) => {
            match cmd {
                ast::PipeableCommand::Simple(cmd) => handle_simple_command(&shell, &cmd, background),
                _ => vec![],
            }
        }
        ast::ListableCommand::Pipe(_, _cmds) => vec![], // TODO: handle pipes
    }

    // TODO: handle list.rest
}

fn handle_simple_command(shell: &Shell, cmd: &ast::DefaultSimpleCommand, background: bool) -> Vec<Action> {
    let mut env_vars = cmd
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
                    Some(value) => Some(Action::SetEnv {
                        key: key.clone(),
                        value,
                    }),
                }
            }
            _ => None,
        })
        .collect::<Vec<Action>>();
    let mut words = cmd
        .redirects_or_cmd_words
        .iter()
        .filter_map(|redirect_or_cmd_word| match redirect_or_cmd_word {
            ast::RedirectOrCmdWord::Redirect(_) => None, // TODO: handle redirects
            ast::RedirectOrCmdWord::CmdWord(cmd_word) => {
                handle_top_level_word(&shell, &cmd_word.0)
            }
        })
        .collect::<Vec<String>>();
    if !words.is_empty() {
        env_vars.push(Action::Command {
            name: words.remove(0),
            args: words,
            background,
        });
    }

    // TODO: syscall should happen here
    env_vars
}


fn handle_top_level_word(shell: &Shell, word: &ast::DefaultComplexWord) -> Option<String> {
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

fn handle_single(shell: &Shell, word: &ast::DefaultWord) -> Option<String> {
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

fn handle_simple_word(shell: &Shell, word: &ast::DefaultSimpleWord) -> Option<String> {
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
