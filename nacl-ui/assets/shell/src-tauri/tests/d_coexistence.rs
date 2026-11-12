//! A/B/D mode behavior at the shell's identity-selection boundary.
//!
//! The `launch.start` command resolves identities through
//! [`resolve_launch_identity`] — the exact same function these tests drive.
//! Mode features decide which arm exists and which identity kinds are
//! accepted; local and Microsoft never fall back to each other. Nothing
//! here touches the network.

use nacl_next_s1_shell::commands::{resolve_launch_identity, IdentitySelector};
#[cfg(feature = "mode-a")]
use nacl_next_s1_shell::mode::PROJECT_MODE;
use nacl_next_s1_shell::state::ShellState;
#[cfg(feature = "mode-d")]
use nacl_next_sdk::account::AccountProvider;
use nacl_next_sdk::account::LocalProfileStore;
use nacl_next_sdk::context::SdkContext;

fn fresh_state(label: &str, client_id: Option<&str>) -> (tempfile::TempDir, ShellState) {
    let root = tempfile::tempdir().expect("temporary root");
    let context = SdkContext::from_root(root.path().join(label));
    context.initialize().expect("context should initialize");
    #[cfg(feature = "microsoft")]
    let state = ShellState::new(context, client_id.map(str::to_string));
    #[cfg(not(feature = "microsoft"))]
    let state = {
        let _ = client_id;
        ShellState::new(context)
    };
    let state = state.expect("shell state should initialize");
    (root, state)
}

fn local_selector(state: &ShellState) -> IdentitySelector {
    let store = LocalProfileStore::new(&state.context);
    let profile = store.create("Steve_01").expect("local profile");
    IdentitySelector {
        kind: "local".into(),
        id: profile.id,
    }
}

fn microsoft_selector() -> IdentitySelector {
    IdentitySelector {
        kind: "microsoft".into(),
        id: "00000000000000000000000000000000".into(),
    }
}

#[cfg(any(feature = "mode-b", feature = "mode-d"))]
#[test]
fn local_identity_selection_works_in_local_capable_modes() {
    let (root, state) = fresh_state("shell-local", None);
    let selector = local_selector(&state);
    let identity = resolve_launch_identity(&state, &selector).expect("local identity");
    assert_eq!(identity.kind(), nacl_next_sdk::account::IdentityKind::Local);
    drop(root);
}

#[cfg(feature = "mode-a")]
#[test]
fn a_mode_rejects_local_identity_without_fallback() {
    let (root, state) = fresh_state("shell-a-local", None);
    let selector = local_selector(&state);
    let error = resolve_launch_identity(&state, &selector).expect_err("A mode has no local branch");
    assert_eq!(error.code, "mode/identity-not-available");
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|details| details["kind"].as_str()),
        Some("local")
    );
    drop(root);
}

#[cfg(feature = "mode-b")]
#[test]
fn b_mode_rejects_microsoft_identity_without_fallback() {
    let (root, state) = fresh_state("shell-b", None);
    let error = resolve_launch_identity(&state, &microsoft_selector())
        .expect_err("B mode must not expose Microsoft identities");
    assert_eq!(error.code, "mode/identity-not-available");
    drop(root);
}

#[test]
fn unknown_identity_kind_is_rejected_with_stable_code() {
    let (root, state) = fresh_state("shell-unknown", None);
    let error = resolve_launch_identity(
        &state,
        &IdentitySelector {
            kind: "admin".into(),
            id: "any".into(),
        },
    )
    .expect_err("unknown kind must fail");
    assert_eq!(error.code, "identity/unknown-kind");
    drop(root);
}

#[cfg(feature = "mode-d")]
#[test]
fn d_build_microsoft_without_login_fails_without_local_fallback() {
    let (root, state) = fresh_state("shell-d", Some("test-client-id-for-d-build"));

    // Same D build, same context: the local branch is alive…
    let local = resolve_launch_identity(&state, &local_selector(&state))
        .expect("local branch must work in a D build");

    // …while an explicit Microsoft selection without a login fails with a
    // Microsoft-side stable code — never a silent local identity.
    let store = LocalProfileStore::new(&state.context);
    let profiles = store.list_identities().expect("local list");
    assert_eq!(profiles.len(), 1);
    let error = resolve_launch_identity(&state, &microsoft_selector())
        .expect_err("signed-out Microsoft selection must fail");
    // Signed out: the provider reports unavailable before any id matching.
    assert_eq!(error.code, "account/unavailable");
    assert_ne!(
        local.kind(),
        nacl_next_sdk::account::IdentityKind::Microsoft
    );

    // State isolation: logging out the (empty) Microsoft side leaves the
    // local store untouched.
    state.microsoft().unwrap().logout().expect("logout ok");
    assert_eq!(store.list().expect("local list").len(), 1);
    drop(root);
}

#[cfg(feature = "mode-d")]
#[test]
fn d_build_without_client_id_keeps_local_branch_working() {
    let (root, state) = fresh_state("shell-d-no-id", None);

    // The provider is absent: Microsoft selection reports the stable
    // missing-client-id code…
    let error = resolve_launch_identity(&state, &microsoft_selector())
        .expect_err("microsoft without client id must fail");
    assert_eq!(error.code, "auth/microsoft/missing-client-id");

    // …while the local branch in the very same state still launches.
    let selector = local_selector(&state);
    assert!(resolve_launch_identity(&state, &selector).is_ok());
    drop(root);
}

#[cfg(feature = "mode-a")]
#[test]
fn a_build_without_client_id_reports_the_configuration_gap() {
    let (root, state) = fresh_state("shell-a-no-id", None);
    let error = resolve_launch_identity(&state, &microsoft_selector())
        .expect_err("microsoft without client id must fail");
    assert_eq!(error.code, "auth/microsoft/missing-client-id");
    assert_eq!(PROJECT_MODE.as_str(), "a");
    drop(root);
}

#[cfg(any(feature = "mode-a", feature = "mode-d"))]
#[test]
fn microsoft_login_begin_and_cancel_stay_local() {
    let (root, state) = fresh_state("shell-login-cancel", Some("test-client-id-offline"));
    let provider = state.microsoft().expect("provider with client id");
    let handle = provider.begin_login().expect("begin builds a loopback URL");
    assert!(handle
        .authorization_url
        .starts_with("https://login.microsoftonline.com/"));
    assert!(handle.authorization_url.contains("test-client-id-offline"));
    provider
        .cancel_login(&handle.login_id)
        .expect("cancel drops the pending session");
    assert!(provider.cancel_login(&handle.login_id).is_err());
    drop(root);
}
