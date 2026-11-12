//! The typed IPC commands. Contract names use dots (`instance.list`), Rust
//! function names map 1:1 (`instance_list`); Microsoft commands exist only
//! in `microsoft` builds and are then not registered at all. Errors are the
//! SDK's stable `SdkError` everywhere; long operations run through the task
//! registry with `task-update` events.

use crate::state::ShellState;
use crate::tasks::{TaskRecord, TaskState};
use nacl_next_sdk::account::{AccountProvider, LocalProfileStore};
use nacl_next_sdk::capability::CapabilityRegistry;
use nacl_next_sdk::instance::{self, CreateInstanceRequest, InstanceConfig};
use crate::preferences::{self, HostPreferences};
use nacl_next_sdk::java::{self, JavaRuntime};
use nacl_next_sdk::launch::{self, LaunchPreview};
use nacl_next_sdk::{LocalProfile, SdkError};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path};
use tauri::{AppHandle, Emitter, Manager, State};

const TASK_EVENT: &str = "task-update";
const LOG_READ_LIMIT_BYTES: u64 = 2 * 1024 * 1024;

// ---------- capabilities ----------

/// `capabilities.query` — reflects the compiled feature set and the project
/// mode; a B build does not even register the Microsoft commands. Discovery
/// is not authorization.
#[tauri::command]
pub fn capabilities_query() -> Vec<nacl_next_sdk::CapabilityDescriptor> {
    let mode = crate::mode::PROJECT_MODE;
    let mut result: Vec<_> = CapabilityRegistry::builtin()
        .list()
        .into_iter()
        .filter(|capability| mode.allows_capability(&capability.name))
        .collect();
    result.push(nacl_next_sdk::capability::CapabilityDescriptor { namespace: "nacl-next".into(), name: "host.preferences".into(), contract_version: 1, permissions: vec![] });
    result
}

/// `project.info` — static build identity for the renderer. A page generated
/// for another mode/version is rejected before mounting.
#[tauri::command]
pub fn project_info() -> crate::mode::ProjectInfo {
    crate::mode::ProjectInfo::current()
}

// ---------- instances (`instance.*`) ----------

/// Wire representation only: SDK and instance.json retain numeric u128 values.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceIpc {
    schema_version: u32,
    id: String,
    name: String,
    game_version: String,
    loader: instance::LoaderConfig,
    game_directory: std::path::PathBuf,
    java: instance::JavaSelection,
    memory: instance::MemorySettings,
    #[serde(default)]
    display: instance::DisplaySettings,
    #[serde(default)]
    advanced: instance::AdvancedSettings,
    #[serde(default)]
    installation: InstallationIpc,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallationIpc {
    state: instance::InstallationState,
    #[serde(default, serialize_with = "serialize_epoch", deserialize_with = "deserialize_epoch")]
    installed_epoch_ms: Option<u128>,
}

fn serialize_epoch<S: serde::Serializer>(value: &Option<u128>, serializer: S) -> Result<S::Ok, S::Error> {
    match value { Some(value) => serializer.serialize_some(&value.to_string()), None => serializer.serialize_none() }
}

fn deserialize_epoch<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<u128>, D::Error> {
    let value = Option::<String>::deserialize(deserializer)?;
    value.map(|text| {
        if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(serde::de::Error::custom("installedEpochMs must be a nonempty decimal string or null"));
        }
        text.parse::<u128>().map_err(serde::de::Error::custom)
    }).transpose()
}

impl From<InstanceConfig> for InstanceIpc {
    fn from(value: InstanceConfig) -> Self {
        Self { schema_version: value.schema_version, id: value.id, name: value.name,
            game_version: value.game_version, loader: value.loader, game_directory: value.game_directory,
            java: value.java, memory: value.memory, display: value.display, advanced: value.advanced,
            installation: InstallationIpc { state: value.installation.state, installed_epoch_ms: value.installation.installed_epoch_ms } }
    }
}

impl From<InstanceIpc> for InstanceConfig {
    fn from(value: InstanceIpc) -> Self {
        Self { schema_version: value.schema_version, id: value.id, name: value.name,
            game_version: value.game_version, loader: value.loader, game_directory: value.game_directory,
            java: value.java, memory: value.memory, display: value.display, advanced: value.advanced,
            installation: instance::InstallationInfo { state: value.installation.state, installed_epoch_ms: value.installation.installed_epoch_ms } }
    }
}

#[tauri::command]
pub fn instance_list(state: State<'_, ShellState>) -> Result<Vec<InstanceIpc>, SdkError> {
    instance::list_instances(&state.context).map(|items| items.into_iter().map(Into::into).collect()).map_err(SdkError::from)
}

#[tauri::command]
pub fn instance_create(
    state: State<'_, ShellState>,
    request: CreateInstanceRequest,
) -> Result<InstanceIpc, SdkError> {
    create_instance_with_preferences(&state, request).map(Into::into)
}

pub fn create_instance_with_preferences(state: &ShellState, request: CreateInstanceRequest) -> Result<InstanceConfig, SdkError> {
    let _guard = state.preferences_lock.lock().map_err(|_| SdkError::new("preferences/lock-failed", "偏好设置暂不可用", true))?;
    let defaults = preferences::read_preferences(&state.context)?.instance_defaults();
    instance::create_instance(&state.context, request, &defaults).map_err(SdkError::from)
}

#[tauri::command]
pub fn host_preferences_get(state: State<'_, ShellState>) -> Result<HostPreferences, SdkError> {
    let _guard = state.preferences_lock.lock().map_err(|_| SdkError::new("preferences/lock-failed", "偏好设置暂不可用", true))?;
    preferences::read_preferences(&state.context)
}

#[tauri::command]
pub fn host_preferences_save(state: State<'_, ShellState>, preferences: HostPreferences) -> Result<HostPreferences, SdkError> {
    let _guard = state.preferences_lock.lock().map_err(|_| SdkError::new("preferences/lock-failed", "偏好设置暂不可用", true))?;
    preferences::save_preferences(&state.context, &preferences)
}

#[tauri::command]
pub fn instance_update(
    state: State<'_, ShellState>,
    instance: InstanceIpc,
) -> Result<InstanceIpc, SdkError> {
    instance::update_instance(&state.context, instance.into()).map(Into::into).map_err(SdkError::from)
}

#[tauri::command]
pub fn instance_duplicate(
    state: State<'_, ShellState>,
    instance_id: String,
) -> Result<InstanceIpc, SdkError> {
    instance::duplicate_instance(&state.context, &instance_id).map(Into::into).map_err(SdkError::from)
}

#[tauri::command]
pub fn instance_delete(state: State<'_, ShellState>, instance_id: String) -> Result<(), SdkError> {
    instance::delete_instance(&state.context, &instance_id).map_err(SdkError::from)
}

#[tauri::command]
pub fn instance_list_deleted(
    state: State<'_, ShellState>,
) -> Result<Vec<InstanceIpc>, SdkError> {
    instance::list_deleted_instances(&state.context).map(|items| items.into_iter().map(Into::into).collect()).map_err(SdkError::from)
}

#[tauri::command]
pub fn instance_restore(
    state: State<'_, ShellState>,
    instance_id: String,
) -> Result<InstanceIpc, SdkError> {
    instance::restore_instance(&state.context, &instance_id).map(Into::into).map_err(SdkError::from)
}

#[tauri::command]
pub fn instance_permanently_delete(
    state: State<'_, ShellState>,
    instance_id: String,
) -> Result<(), SdkError> {
    instance::permanently_delete_instance(&state.context, &instance_id).map_err(SdkError::from)
}

// ---------- java (`java.*`) ----------

#[tauri::command]
pub fn java_detect(state: State<'_, ShellState>) -> Vec<JavaRuntime> {
    java::detect_java_runtimes(&state.context)
}

#[tauri::command]
pub fn java_inspect(path: String) -> Result<JavaRuntime, SdkError> {
    java::inspect_java_runtime(Path::new(&path)).map_err(SdkError::from)
}

// ---------- local profiles (`profile.local.*`) ----------

#[tauri::command]
pub fn profile_local_list(state: State<'_, ShellState>) -> Result<Vec<LocalProfile>, SdkError> {
    LocalProfileStore::new(&state.context)
        .list()
        .map_err(SdkError::from)
}

#[tauri::command]
pub fn profile_local_create(
    state: State<'_, ShellState>,
    username: String,
) -> Result<LocalProfile, SdkError> {
    LocalProfileStore::new(&state.context)
        .create(username)
        .map_err(SdkError::from)
}

#[tauri::command]
pub fn profile_local_rename(
    state: State<'_, ShellState>,
    profile_id: String,
    username: String,
) -> Result<LocalProfile, SdkError> {
    LocalProfileStore::new(&state.context)
        .rename(&profile_id, username)
        .map_err(SdkError::from)
}

#[tauri::command]
pub fn profile_local_delete(
    state: State<'_, ShellState>,
    profile_id: String,
) -> Result<(), SdkError> {
    LocalProfileStore::new(&state.context)
        .delete(&profile_id)
        .map_err(SdkError::from)
}

// ---------- microsoft (`microsoft.*`; only compiled with the feature) ----------

#[cfg(feature = "microsoft")]
#[tauri::command]
pub fn microsoft_login_begin(
    state: State<'_, ShellState>,
) -> Result<nacl_next_sdk::LoginHandle, SdkError> {
    state.microsoft()?.begin_login().map_err(SdkError::from)
}

#[cfg(feature = "microsoft")]
#[tauri::command]
pub async fn microsoft_login_complete(
    app: AppHandle,
    login_id: String,
) -> Result<TaskRecord, SdkError> {
    run_task(&app, "microsoft.login", move |app| {
        let state = app.state::<ShellState>();
        let provider = state.microsoft()?;
        provider
            .complete_login(&login_id)
            .map(|account| serde_json::to_value(account).unwrap_or(serde_json::Value::Null))
            .map_err(SdkError::from)
    })
    .await
}

#[cfg(feature = "microsoft")]
#[tauri::command]
pub fn microsoft_status(
    state: State<'_, ShellState>,
) -> Result<Option<nacl_next_sdk::MicrosoftAccount>, SdkError> {
    state.microsoft()?.account().map_err(SdkError::from)
}

#[cfg(feature = "microsoft")]
#[tauri::command]
pub fn microsoft_logout(state: State<'_, ShellState>) -> Result<(), SdkError> {
    state.microsoft()?.logout().map_err(SdkError::from)
}

/// Drops a pending login session (the URL may already be open in a browser).
/// A `microsoft.login.complete` task already blocked on the callback still
/// ends by its own timeout; cancelling cannot interrupt it.
#[cfg(feature = "microsoft")]
#[tauri::command]
pub fn microsoft_login_cancel(
    state: State<'_, ShellState>,
    login_id: String,
) -> Result<(), SdkError> {
    state
        .microsoft()?
        .cancel_login(&login_id)
        .map_err(SdkError::from)
}

// ---------- launch (`launch.*`) ----------

/// Explicit identity selection at the IPC boundary. D mode passes either
/// kind; each kind resolves through its own provider with no cross-kind
/// fallback, so a Microsoft failure can never silently become local.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contracts", derive(ts_rs::TS))]
pub struct IdentitySelector {
    pub kind: String,
    pub id: String,
}

pub fn resolve_launch_identity(
    state: &ShellState,
    selector: &IdentitySelector,
) -> Result<nacl_next_sdk::LaunchIdentity, SdkError> {
    let mode = crate::mode::PROJECT_MODE;
    if !matches!(selector.kind.as_str(), "local" | "microsoft") {
        return Err(SdkError::new(
            "identity/unknown-kind",
            format!(
                "未知身份类型 {}；当前项目模式 {} 允许：{}",
                selector.kind,
                mode.as_str().to_uppercase(),
                allowed_identity_hint(mode)
            ),
            false,
        )
        .with_details(serde_json::json!({ "kind": selector.kind })));
    }
    // A kind that exists in the compiled SDK but not in this project mode is
    // rejected explicitly — never redirected to the other identity source.
    if !mode.allows_identity(&selector.kind) {
        return Err(SdkError::new(
            "mode/identity-not-available",
            format!(
                "当前项目模式 {} 不提供 {} 身份；不会自动改用其他身份",
                mode.as_str().to_uppercase(),
                selector.kind
            ),
            false,
        )
        .with_details(serde_json::json!({
            "kind": selector.kind,
            "mode": mode.as_str(),
        })));
    }
    match selector.kind.as_str() {
        "local" => LocalProfileStore::new(&state.context)
            .prepare_launch_identity(&selector.id)
            .map_err(SdkError::from),
        #[cfg(feature = "microsoft")]
        "microsoft" => {
            let provider: &nacl_next_sdk::MicrosoftProvider = state.microsoft()?;
            AccountProvider::prepare_launch_identity(provider, &selector.id).map_err(SdkError::from)
        }
        _ => unreachable!("identity kind was validated above"),
    }
}

fn allowed_identity_hint(mode: crate::mode::ProjectMode) -> &'static str {
    match mode {
        crate::mode::ProjectMode::A => "microsoft",
        crate::mode::ProjectMode::B => "local",
        crate::mode::ProjectMode::D => "local、microsoft",
    }
}

/// `launch.resolve` — dry-run preview; reports missing files, never fetches.
#[tauri::command]
pub fn launch_resolve(
    state: State<'_, ShellState>,
    instance_id: String,
) -> Result<LaunchPreview, SdkError> {
    instance::find_instance(&state.context, &instance_id).map_err(SdkError::from)?;
    Ok(launch::preview_launch(&state.context, &instance_id, None))
}

/// `launch.start` — task-wrapped full launch; the queued record carries the
/// task id, the final record's `result` holds the launched process info.
#[tauri::command]
pub async fn launch_start(
    app: AppHandle,
    instance_id: String,
    identity: IdentitySelector,
    preferred_java_path: Option<String>,
) -> Result<TaskRecord, SdkError> {
    run_task(&app, "launch.start", move |app| {
        let state = app.state::<ShellState>();
        let selected = resolve_launch_identity(&state, &identity)?;
        let preferred = preferred_java_path.as_deref().map(Path::new);
        let launched = launch::launch(
            &state.context,
            &state.executor,
            &instance_id,
            &selected,
            preferred,
        )
        .map_err(SdkError::from)?;
        serde_json::to_value(launched)
            .map_err(|error| SdkError::new("launch/serialize-failed", error.to_string(), false))
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contracts", derive(ts_rs::TS))]
pub struct ProcessStatusDto {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

#[tauri::command]
pub fn launch_process_status(state: State<'_, ShellState>, process_id: u32) -> ProcessStatusDto {
    match state.executor.process_status(process_id) {
        launch::ExitState::Running => ProcessStatusDto {
            state: "running".into(),
            exit_code: None,
        },
        launch::ExitState::Exited(code) => ProcessStatusDto {
            state: "exited".into(),
            exit_code: Some(code),
        },
        launch::ExitState::Terminated => ProcessStatusDto {
            state: "terminated".into(),
            exit_code: None,
        },
        launch::ExitState::Unknown => ProcessStatusDto {
            state: "unknown".into(),
            exit_code: None,
        },
    }
}

// ---------- tasks & logs (`task.*`, `log.*`) ----------

#[tauri::command]
pub fn task_status(state: State<'_, ShellState>, task_id: String) -> Result<TaskRecord, SdkError> {
    state.tasks.status(&task_id)
}

/// `task.list` — lets a reloaded page recover task state without relying on
/// events it may have missed.
#[tauri::command]
pub fn task_list(state: State<'_, ShellState>) -> Vec<TaskRecord> {
    state.tasks.list()
}

#[tauri::command]
pub fn log_list(state: State<'_, ShellState>) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(&state.context.logs_root)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .file_type()
                        .map(|kind| kind.is_file())
                        .unwrap_or(false)
                })
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[tauri::command]
pub fn log_read(state: State<'_, ShellState>, name: String) -> Result<String, SdkError> {
    let relative = Path::new(&name);
    if relative.components().count() != 1
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(SdkError::new(
            "log/invalid-name",
            "日志名必须是 logs 目录内的单个文件名",
            false,
        ));
    }
    let path = state.context.logs_root.join(relative);
    if let Ok(metadata) = std::fs::metadata(&path) {
        if metadata.len() > LOG_READ_LIMIT_BYTES {
            return Err(SdkError::new(
                "log/too-large",
                format!("日志超过 {LOG_READ_LIMIT_BYTES} 字节读取上限"),
                false,
            ));
        }
    }
    std::fs::read_to_string(&path)
        .map_err(|source| SdkError::new("log/io", format!("无法读取日志 {name}：{source}"), false))
}

// ---------- task runner ----------

/// Creates the task record, reports it, runs `work` on the blocking pool and
/// mirrors every transition into `task-update` events. Returns the queued
/// record immediately so the caller gets its task id.
async fn run_task<F>(app: &AppHandle, kind: &'static str, work: F) -> Result<TaskRecord, SdkError>
where
    F: FnOnce(&AppHandle) -> Result<serde_json::Value, SdkError> + Send + 'static,
{
    let record = app.state::<ShellState>().tasks.create(kind)?;
    emit(app, &record);

    let handle = app.clone();
    let task_id = record.task_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let tasks = &handle.state::<ShellState>().tasks;
        if let Ok(running) = tasks.transition(&task_id, TaskState::Running) {
            emit(&handle, &running);
        }
        let final_record = match work(&handle) {
            Ok(value) => tasks.finish_success(&task_id, value),
            Err(error) => tasks.finish_failure(&task_id, error),
        };
        if let Ok(done) = &final_record {
            emit(&handle, done);
        } else if let Err(error) = final_record {
            eprintln!("task {task_id} final transition failed: {error}");
        }
    });
    Ok(record)
}

fn emit(app: &AppHandle, record: &TaskRecord) {
    if let Err(error) = app.emit(TASK_EVENT, record) {
        eprintln!("task event emit failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{capabilities_query, IdentitySelector};
    use crate::mode::PROJECT_MODE;

    #[test]
    fn identity_selector_deserializes_camel_case() {
        let selector: IdentitySelector =
            serde_json::from_str(r#"{"kind":"local","id":"abc"}"#).unwrap();
        assert_eq!(selector.kind, "local");
        assert_eq!(selector.id, "abc");
    }

    #[test]
    fn advertised_capabilities_follow_the_compiled_mode() {
        let capabilities = capabilities_query();
        let has = |name: &str| {
            capabilities
                .iter()
                .any(|capability| capability.name == name)
        };
        assert_eq!(has("account.local"), PROJECT_MODE.allows_identity("local"));
        assert_eq!(
            has("account.microsoft"),
            PROJECT_MODE.allows_identity("microsoft")
        );
        assert!(has("instance.manage"));
        assert!(has("launch.game"));
    }
}
