fn main() -> Result<(), Box<dyn std::error::Error>> {
    let hash = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .expect("Failed getting commit hash from git")
        .stdout;
    println!(
        "cargo:rustc-env=SHELL_COMMIT_HASH={}",
        std::str::from_utf8(&hash)?
    );
    println!("cargo:rustc-env=SHELL_TARGET={}", std::env::var("TARGET")?);

    Ok(())
}
