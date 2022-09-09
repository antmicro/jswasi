pub const RIGHTS_ALL: u64 = 0x1fff_ffff;
pub const RIGHTS_STDIN: u64 = 0x8200093;
pub const RIGHTS_STDOUT: u64 = 0x82000d1;
pub const RIGHTS_STDERR: u64 = 0x82000d1;

pub const SAMPLE_TEXT_FILENAME: &str = "text";
pub const SAMPLE_TEXT_FILENAME_ABS: &str = "/home/ant/text";
pub const SAMPLE_DIR_FILENAME: &str = "dir";
pub const SAMPLE_DIR_FILENAME_ABS: &str = "/home/ant/dir";
pub const SAMPLE_LINK_FILENAME: &str = "link";
pub const SAMPLE_DIR_LINK_FILENAME: &str = "dir_link";

pub const SAMPLE_TEXT: &[u8] = "sample text\n".as_bytes();
pub const SAMPLE_TEXT_LEN: usize = SAMPLE_TEXT.len();

pub const PWD_DESC: wasi::Fd = 4;

pub const ARGV: [&str; 3] = ["test\0", "wasi\0", "syscalls\0"];

pub const SAMPLE_DIRENTRY_NAME: &str = "ent";
pub const SAMPLE_DIRENTRY_NAME_LEN: usize = 4;
pub const N_DIRENTRIES: u32 = 10;

pub const DIR_SIZE: usize = 4096;
