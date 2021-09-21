use conch_parser::ast;
use conch_parser::ast::{PipeableCommand, TopLevelWord, Redirect, CompoundCommand, CompoundCommandKind, AndOrList, SimpleCommand, Command, TopLevelCommand, ListableCommand, RedirectOrCmdWord};
use std::rc::Rc;

#[derive(Debug)]
pub enum Action {
    Command {name: String, args: Vec<String>, background: bool},
    SetEnv {key: String, value: String},
}

pub fn interpret(cmd: &ast::TopLevelCommand<String>) -> Action {
    let mut action: Action;
    match &cmd.0 {
        Command::Job(list) | Command::List(list) => {
            match &list.first {
                ast::ListableCommand::Single(cmd) => {
                    match cmd {
                        ast::PipeableCommand::Simple(cmd) => {
                            let mut words = cmd.redirects_or_cmd_words.iter().filter_map(|redirect_or_cmd_word| match redirect_or_cmd_word {
                                RedirectOrCmdWord::Redirect(_) => None, // TODO: handle redirects
                                RedirectOrCmdWord::CmdWord(cmd_word) => {
                                    match &cmd_word.0 {
                                        ast::ComplexWord::Single(word) => {
                                            match &word {
                                                ast::Word::SingleQuoted(w) => Some(w.clone()),
                                                ast::Word::Simple(w) => get_simple_word_as_string(w),
                                                ast::Word::DoubleQuoted(words) =>
                                                    Some(words
                                                        .iter()
                                                        .filter_map(|w| get_simple_word_as_string(w))
                                                        .collect::<Vec<_>>()
                                                        .join(" "))
                                            }
                                        },
                                        ast::ComplexWord::Concat(_) => None, // TODO: handle concat (just join together?)
                                    }
                                }
                            }).collect::<Vec<String>>();
                            action = Action::Command {name: words.remove(0), args: words, background: false }
                        }
                        _ => unimplemented!(),
                    };
                },
                ast::ListableCommand::Pipe(_, cmds) => unimplemented!(),
            }

            // TODO: handle list.rest
        }
    }

    action
}

fn get_simple_word_as_string(word: &ast::DefaultSimpleWord) -> Option<String> {
    match word {
        ast::SimpleWord::Literal(w) => Some(w.clone()),
        _ => None, // Ignoring substitutions and others for simplicity here
    }
}
