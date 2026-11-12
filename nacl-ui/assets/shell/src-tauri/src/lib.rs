//! NaCL Next S1 thin Tauri shell (library half).
//!
//! Roots come from the host: `NACL_NEXT_S1_ROOT` env var, or a data folder
//! next to the executable. The Microsoft client id (A/D builds) comes from
//! `NACL_NEXT_MICROSOFT_CLIENT_ID`; without it the local branch works and
//! every `microsoft.*` command reports `auth/microsoft/missing-client-id`.
//!
//! Exactly one project mode feature (`mode-a`, `mode-b`, `mode-d`) selects
//! the registered command surface. The renderer reads the same mode through
//! `project.info` and refuses a page generated for another mode.

pub mod commands;
pub mod mode;
pub mod preferences;
pub mod state;
pub mod tasks;

use nacl_next_sdk::context::SdkContext;
use state::ShellState;
use std::path::PathBuf;

pub fn resolve_data_root() -> PathBuf {
    if let Some(root) = std::env::var_os("NACL_NEXT_S1_ROOT") {
        return PathBuf::from(root);
    }
    std::env::current_exe()
        .expect("executable path")
        .parent()
        .expect("executable directory")
        .to_path_buf()
        .join("s1-data")
}

#[cfg(feature = "microsoft")]
fn resolve_microsoft_client_id() -> Option<String> {
    std::env::var("NACL_NEXT_MICROSOFT_CLIENT_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn run() {
    let context = SdkContext::from_root(resolve_data_root());

    #[cfg(feature = "microsoft")]
    let state = ShellState::new(context, resolve_microsoft_client_id());
    #[cfg(not(feature = "microsoft"))]
    let state = ShellState::new(context);

    let state = state.expect("shell state should initialize");

    tauri::Builder::default()
        .manage(state)
        .invoke_handler({
            #[cfg(feature = "mode-a")]
            {
                tauri::generate_handler![
                    commands::capabilities_query,
                    commands::project_info,
                    commands::host_preferences_get,
                    commands::host_preferences_save,
                    commands::instance_list,
                    commands::instance_create,
                    commands::instance_update,
                    commands::instance_duplicate,
                    commands::instance_delete,
                    commands::instance_list_deleted,
                    commands::instance_restore,
                    commands::instance_permanently_delete,
                    commands::java_detect,
                    commands::java_inspect,
                    commands::microsoft_login_begin,
                    commands::microsoft_login_complete,
                    commands::microsoft_login_cancel,
                    commands::microsoft_status,
                    commands::microsoft_logout,
                    commands::launch_resolve,
                    commands::launch_start,
                    commands::launch_process_status,
                    commands::task_status,
                    commands::task_list,
                    commands::log_list,
                    commands::log_read
                ]
            }
            #[cfg(feature = "mode-b")]
            {
                tauri::generate_handler![
                    commands::capabilities_query,
                    commands::project_info,
                    commands::host_preferences_get,
                    commands::host_preferences_save,
                    commands::instance_list,
                    commands::instance_create,
                    commands::instance_update,
                    commands::instance_duplicate,
                    commands::instance_delete,
                    commands::instance_list_deleted,
                    commands::instance_restore,
                    commands::instance_permanently_delete,
                    commands::java_detect,
                    commands::java_inspect,
                    commands::profile_local_list,
                    commands::profile_local_create,
                    commands::profile_local_rename,
                    commands::profile_local_delete,
                    commands::launch_resolve,
                    commands::launch_start,
                    commands::launch_process_status,
                    commands::task_status,
                    commands::task_list,
                    commands::log_list,
                    commands::log_read
                ]
            }
            #[cfg(feature = "mode-d")]
            {
                tauri::generate_handler![
                    commands::capabilities_query,
                    commands::project_info,
                    commands::host_preferences_get,
                    commands::host_preferences_save,
                    commands::instance_list,
                    commands::instance_create,
                    commands::instance_update,
                    commands::instance_duplicate,
                    commands::instance_delete,
                    commands::instance_list_deleted,
                    commands::instance_restore,
                    commands::instance_permanently_delete,
                    commands::java_detect,
                    commands::java_inspect,
                    commands::profile_local_list,
                    commands::profile_local_create,
                    commands::profile_local_rename,
                    commands::profile_local_delete,
                    commands::microsoft_login_begin,
                    commands::microsoft_login_complete,
                    commands::microsoft_login_cancel,
                    commands::microsoft_status,
                    commands::microsoft_logout,
                    commands::launch_resolve,
                    commands::launch_start,
                    commands::launch_process_status,
                    commands::task_status,
                    commands::task_list,
                    commands::log_list,
                    commands::log_read
                ]
            }
        })
        .run(tauri::generate_context!())
        .expect("S1 shell runtime");
}
