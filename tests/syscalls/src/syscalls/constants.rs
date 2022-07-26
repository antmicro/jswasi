pub const RIGHTS_ALL: u64 = 0x1fff_ffff;
pub const RIGHTS_STDIN: u64 = 0x8200093;
pub const RIGHTS_STDOUT: u64 = 0x82000d1;
pub const RIGHTS_STDERR: u64 = 0x82000d1;

pub const SAMPLE_TEXT_FILENAME: &str = "text";
pub const SAMPLE_TEXT: &[u8] = "sample text\n".as_bytes();
pub const SAMPLE_TEXT_LEN: usize = SAMPLE_TEXT.len();
