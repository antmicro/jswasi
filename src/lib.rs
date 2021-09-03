use conch_parser::ast;

pub fn execute(cmd: ast::TopLevelCommand<String>) {
    let result = count_echo_top_level(&cmd);
}

fn count_echo_top_level(cmd: &ast::TopLevelCommand<String>) -> usize {
    match &cmd.0 {
        ast::Command::Job(list) | ast::Command::List(list) => std::iter::once(&list.first)
            .chain(list.rest.iter().map(|and_or| match and_or {
                ast::AndOr::And(cmd) | ast::AndOr::Or(cmd) => cmd,
            }))
            .map(|cmd| count_echo_listable(&cmd))
            .sum(),
    }
}

fn count_echo_listable(cmd: &ast::DefaultListableCommand) -> usize {
    match cmd {
        ast::ListableCommand::Single(cmd) => count_echo_pipeable(cmd),
        ast::ListableCommand::Pipe(_, cmds) => cmds.into_iter().map(count_echo_pipeable).sum(),
    }
}

fn count_echo_pipeable(cmd: &ast::DefaultPipeableCommand) -> usize {
    match cmd {
        ast::PipeableCommand::Simple(cmd) => count_echo_simple(cmd),
        _ => 0
    }
}

fn count_echo_simple(cmd: &ast::DefaultSimpleCommand) -> usize {
    cmd.redirects_or_cmd_words
        .iter()
        .filter_map(|redirect_or_word| match redirect_or_word {
            ast::RedirectOrCmdWord::CmdWord(w) => Some(&w.0),
            ast::RedirectOrCmdWord::Redirect(_) => None,
        })
        .filter_map(|word| match word {
            ast::ComplexWord::Single(w) => Some(w),
            // We're going to ignore concatenated words for simplicity here
            ast::ComplexWord::Concat(_) => None,
        })
        .filter_map(|word| match word {
            ast::Word::SingleQuoted(w) => Some(w.clone()),
            ast::Word::Simple(w) => get_simple_word_as_string(w),
            ast::Word::DoubleQuoted(words) => Some(words.iter().filter_map(|w| get_simple_word_as_string(w)).collect::<Vec<_>>().join(" ")), // Ignore all multi-word double quoted strings
        })
    .filter(|w| *w == "echo")
        .count()
}

fn get_simple_word_as_string(word: &ast::DefaultSimpleWord) -> Option<String> {
    match word {
        ast::SimpleWord::Literal(w) => Some(w.clone()),
        _ => None, // Ignoring substitutions and others for simplicity here
    }
}
