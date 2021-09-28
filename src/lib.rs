use conch_parser::ast;
use std::env;

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

pub fn interpret(cmd: &ast::TopLevelCommand<String>) -> Action {
    println!("{:?}", cmd);
    let action = match &cmd.0 {
        ast::Command::Job(list) => handle_listable_command(list, true),
        ast::Command::List(list) => handle_listable_command(list, false),
    };
    dbg!(&action);
    action
}

fn handle_listable_command(list: &ast::DefaultAndOrList, background: bool) -> Action {
    match &list.first {
        ast::ListableCommand::Single(cmd) => {
            match cmd {
                ast::PipeableCommand::Simple(cmd) => {
                    let mut words = cmd
                        .redirects_or_cmd_words
                        .iter()
                        .filter_map(|redirect_or_cmd_word| match redirect_or_cmd_word {
                            ast::RedirectOrCmdWord::Redirect(_) => None, // TODO: handle redirects
                            ast::RedirectOrCmdWord::CmdWord(cmd_word) => match &cmd_word.0 {
                                ast::ComplexWord::Single(word) => handle_single(word),
                                ast::ComplexWord::Concat(words) => Some(
                                    words
                                        .iter()
                                        .filter_map(|w| handle_single(w))
                                        .collect::<Vec<_>>()
                                        .join(""),
                                ),
                            },
                        })
                        .collect::<Vec<String>>();
                    // println!("{:?}", words);
                    Action::Command {
                        name: words.remove(0),
                        args: words,
                        background,
                    }
                }
                _ => Action::Invalid,
            }
        }
        ast::ListableCommand::Pipe(_, _cmds) => Action::Invalid, // TODO: handle pipes
    }

    // TODO: handle list.rest
}

fn handle_single(word: &ast::DefaultWord) -> Option<String> {
    match &word {
        ast::Word::SingleQuoted(w) => Some(w.clone()),
        ast::Word::Simple(w) => handle_simple_word(w),
        ast::Word::DoubleQuoted(words) => Some(
            words
                .iter()
                .filter_map(|w| handle_simple_word(w))
                .collect::<Vec<_>>()
                .join(" "),
        ),
    }
}

fn handle_simple_word(word: &ast::DefaultSimpleWord) -> Option<String> {
    match word {
        ast::SimpleWord::Literal(w) => Some(w.clone()),
        ast::SimpleWord::Colon => Some(":".to_string()),
        ast::SimpleWord::Tilde => Some(env::var("HOME").unwrap()),
        any => Some(format!("{:?}", any)),
    }
}
