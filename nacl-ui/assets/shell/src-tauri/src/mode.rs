//! Compile-time project mode (A/B/D) for the IPC shell.
//!
//! Exactly one mode feature must be active. The mode gates which identity
//! commands are registered and which capabilities are advertised; call
//! sites still re-check the mode, so a direct IPC call cannot bypass a
//! missing UI. B builds never enable the `microsoft` feature (no dependency,
//! no command, no request); A and D enable it, while A does not register the
//! local-profile commands.

use serde::Serialize;

/// Page contract version understood by this shell and the bundled renderer.
pub const PAGE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectMode {
    /// Microsoft identity only.
    A,
    /// Local profiles only; no Microsoft dependency or commands.
    B,
    /// Both identity kinds; the caller/UI chooses explicitly per launch.
    D,
}

impl ProjectMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::A => "a",
            Self::B => "b",
            Self::D => "d",
        }
    }

    pub fn allows_identity(self, kind: &str) -> bool {
        match kind {
            "microsoft" => matches!(self, Self::A | Self::D),
            "local" => matches!(self, Self::B | Self::D),
            _ => false,
        }
    }

    /// Host-level view of the advertised capability set. Discovery is not
    /// authorization; every command call is re-checked by the provider.
    pub fn allows_capability(self, name: &str) -> bool {
        match name {
            "account.microsoft" => matches!(self, Self::A | Self::D),
            "account.local" => matches!(self, Self::B | Self::D),
            _ => true,
        }
    }
}

#[cfg(any(
    all(feature = "mode-a", feature = "mode-b"),
    all(feature = "mode-a", feature = "mode-d"),
    all(feature = "mode-b", feature = "mode-d")
))]
compile_error!("exactly one of mode-a, mode-b, mode-d may be enabled");

#[cfg(not(any(feature = "mode-a", feature = "mode-b", feature = "mode-d")))]
compile_error!("one project mode feature (mode-a, mode-b or mode-d) is required");

// The `microsoft` dependency feature is an implementation detail of A/D:
// enabling it under B would contradict the "no Microsoft dependency" rule.
#[cfg(all(
    feature = "microsoft",
    not(any(feature = "mode-a", feature = "mode-d"))
))]
compile_error!("the `microsoft` feature must be enabled via mode-a or mode-d, not on its own");

#[cfg(feature = "mode-a")]
pub const PROJECT_MODE: ProjectMode = ProjectMode::A;
#[cfg(feature = "mode-b")]
pub const PROJECT_MODE: ProjectMode = ProjectMode::B;
#[cfg(feature = "mode-d")]
pub const PROJECT_MODE: ProjectMode = ProjectMode::D;

/// Static description surfaced to the renderer so a page generated for a
/// different mode or SDK version is rejected before any UI renders.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contracts", derive(ts_rs::TS))]
pub struct ProjectInfo {
    pub mode: &'static str,
    pub sdk_version: &'static str,
    pub shell_version: &'static str,
    pub page_schema_version: u32,
}

impl ProjectInfo {
    pub fn current() -> Self {
        Self {
            mode: PROJECT_MODE.as_str(),
            sdk_version: nacl_next_sdk::SDK_VERSION,
            shell_version: env!("CARGO_PKG_VERSION"),
            page_schema_version: PAGE_SCHEMA_VERSION,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ProjectInfo, ProjectMode, PROJECT_MODE};

    #[test]
    fn mode_and_identity_matrix_is_consistent() {
        assert!(ProjectMode::A.allows_identity("microsoft"));
        assert!(!ProjectMode::A.allows_identity("local"));
        assert!(!ProjectMode::B.allows_identity("microsoft"));
        assert!(ProjectMode::B.allows_identity("local"));
        assert!(ProjectMode::D.allows_identity("microsoft"));
        assert!(ProjectMode::D.allows_identity("local"));
        assert!(!ProjectMode::D.allows_identity("admin"));
    }

    #[test]
    fn project_info_reports_compiled_mode() {
        let info = ProjectInfo::current();
        assert_eq!(info.mode, PROJECT_MODE.as_str());
        assert_eq!(info.page_schema_version, 1);
        assert!(!info.sdk_version.is_empty());
    }
}
