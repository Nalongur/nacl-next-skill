//! Exports the shell's IPC DTOs to TypeScript bindings.
//!
//! ```text
//! TS_RS_EXPORT_DIR=../contracts cargo run --example export_contracts --features contracts
//! ```
//!
//! Rust remains the source. The generated directory is consumed by the S3
//! template; the generator copies `SdkError`/`JsonValue` alongside these
//! files so their imports resolve after the shell is copied.

fn main() {
    use nacl_next_s1_shell::commands::{IdentitySelector, ProcessStatusDto};
    use nacl_next_s1_shell::mode::ProjectInfo;
    use nacl_next_s1_shell::preferences::HostPreferences;
    use nacl_next_s1_shell::tasks::{TaskRecord, TaskState};
    use ts_rs::TS;

    let mut exported: Vec<String> = Vec::new();
    let mut run = |name: &str, result: Result<(), ts_rs::ExportError>| {
        result.unwrap_or_else(|error| panic!("export {name} failed: {error}"));
        exported.push(name.to_string());
    };

    run("TaskRecord", TaskRecord::export_all());
    run("TaskState", TaskState::export_all());
    run("ProjectInfo", ProjectInfo::export_all());
    run("HostPreferences", HostPreferences::export_all());
    run("ProcessStatusDto", ProcessStatusDto::export_all());
    run("IdentitySelector", IdentitySelector::export_all());

    println!(
        "exported {} shell DTO groups: {}",
        exported.len(),
        exported.join(", ")
    );
}
