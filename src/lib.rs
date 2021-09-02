use conch_parser::ast;

fn execute<T>(cmd: ast::TopLevelCommand<T>) {
    match cmd {
        Ok(cmd) => {
            match &cmd.0 {
                ast::Command::Job(list) | ast::Command::List(list) => {
                    match list.0.first {
                        ast::ListableCommand::Single(cmd) => {
                            match &cmd.0 {
                                ast::PipeableCommand::Simple(cmd) => {
                                    for cmd in &cmd.0.redirects_or_cmd_words {
                                        match cmd {
                                            ast::ListableCommand::Single(cmd) => {
                                                match &cmd.0 {
                                                    ast::PipeableCommand::Simple(cmd) => {
                                                        match &cmd.0 {}
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        ast::ListableCommand::Pipe(_, cmds) => {}
                    }
                }
            }
        }
        Err(e) => {
            println!("{:#?}", e);
        }
    }
}