//! Long-task registry for the IPC boundary (plain Rust, unit-testable).
//!
//! One stable task model serves every long-running operation (S1: Microsoft
//! login completion, game launch). The Tauri layer mirrors every transition
//! into a `task-update` event; `task.status` lets a reconnected front end
//! recover state without relying on one-shot events.

use nacl_next_sdk::SdkError;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contracts", derive(ts_rs::TS))]
pub enum TaskState {
    Queued,
    Running,
    Succeeded,
    Failed,
    /// Part of the agreed state machine (guide §6.3). The `task.cancel`
    /// command arrives with the full task protocol; transitions accept it
    /// today so the machine is already correct.
    #[allow(dead_code)]
    Cancelled,
}

impl TaskState {
    fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contracts", derive(ts_rs::TS))]
pub struct TaskRecord {
    pub task_id: String,
    /// `microsoft.login` or `launch.start`.
    pub kind: String,
    pub state: TaskState,
    #[cfg_attr(feature = "contracts", ts(type = "number"))]
    pub created_epoch_ms: u128,
    #[cfg_attr(feature = "contracts", ts(type = "number"))]
    pub updated_epoch_ms: u128,
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<SdkError>,
    /// Redacted success payload (e.g. launched process info).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

#[derive(Default)]
pub struct TaskManager {
    records: Mutex<HashMap<String, TaskRecord>>,
}

impl TaskManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create(&self, kind: &str) -> Result<TaskRecord, SdkError> {
        let now = now_epoch_ms();
        let record = TaskRecord {
            task_id: Uuid::new_v4().simple().to_string(),
            kind: kind.to_string(),
            state: TaskState::Queued,
            created_epoch_ms: now,
            updated_epoch_ms: now,
            summary: None,
            error: None,
            result: None,
        };
        self.records
            .lock()
            .map_err(|_| poisoned())?
            .insert(record.task_id.clone(), record.clone());
        Ok(record)
    }

    /// Queued → Running (or straight to a terminal state when work finished
    /// before the worker reported progress).
    pub fn transition(&self, task_id: &str, state: TaskState) -> Result<TaskRecord, SdkError> {
        self.update(task_id, |record| {
            let allowed = matches!(
                (record.state, state),
                (TaskState::Queued, TaskState::Running)
                    | (TaskState::Queued, TaskState::Cancelled)
                    | (TaskState::Running, TaskState::Succeeded)
                    | (TaskState::Running, TaskState::Failed)
                    | (TaskState::Running, TaskState::Cancelled)
            );
            if !allowed {
                return Err(invalid_transition(record.state, state));
            }
            record.state = state;
            record.updated_epoch_ms = now_epoch_ms();
            Ok(())
        })
    }

    pub fn finish_success(
        &self,
        task_id: &str,
        result: serde_json::Value,
    ) -> Result<TaskRecord, SdkError> {
        self.update(task_id, |record| {
            if record.state != TaskState::Running {
                return Err(invalid_transition(record.state, TaskState::Succeeded));
            }
            record.state = TaskState::Succeeded;
            record.result = Some(result);
            record.updated_epoch_ms = now_epoch_ms();
            Ok(())
        })
    }

    pub fn finish_failure(&self, task_id: &str, error: SdkError) -> Result<TaskRecord, SdkError> {
        self.update(task_id, |record| {
            if record.state.is_terminal() {
                return Err(invalid_transition(record.state, TaskState::Failed));
            }
            record.state = TaskState::Failed;
            record.error = Some(error);
            record.updated_epoch_ms = now_epoch_ms();
            Ok(())
        })
    }

    pub fn status(&self, task_id: &str) -> Result<TaskRecord, SdkError> {
        self.records
            .lock()
            .map_err(|_| poisoned())?
            .get(task_id)
            .cloned()
            .ok_or_else(|| SdkError::new("task/not-found", format!("没有任务 {task_id}"), false))
    }

    /// All known records, most recently updated first. Used by a reloaded
    /// page to recover state that arrived while it was not listening.
    pub fn list(&self) -> Vec<TaskRecord> {
        let Ok(records) = self.records.lock() else {
            return Vec::new();
        };
        let mut records: Vec<TaskRecord> = records.values().cloned().collect();
        records.sort_by(|left, right| {
            right
                .updated_epoch_ms
                .cmp(&left.updated_epoch_ms)
                .then_with(|| right.created_epoch_ms.cmp(&left.created_epoch_ms))
        });
        records
    }

    fn update(
        &self,
        task_id: &str,
        change: impl FnOnce(&mut TaskRecord) -> Result<(), SdkError>,
    ) -> Result<TaskRecord, SdkError> {
        let mut records = self.records.lock().map_err(|_| poisoned())?;
        let record = records
            .get_mut(task_id)
            .ok_or_else(|| SdkError::new("task/not-found", format!("没有任务 {task_id}"), false))?;
        change(record)?;
        Ok(record.clone())
    }
}

fn poisoned() -> SdkError {
    SdkError::new("task/registry-poisoned", "任务注册表状态异常", false)
}

fn invalid_transition(from: TaskState, to: TaskState) -> SdkError {
    SdkError::new(
        "task/invalid-transition",
        format!("任务状态不允许从 {from:?} 变为 {to:?}"),
        false,
    )
    .with_details(serde_json::json!({ "from": format!("{from:?}"), "to": format!("{to:?}") }))
}

fn now_epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
}

#[cfg(test)]
mod tests {
    use super::{TaskManager, TaskState};

    #[test]
    fn lifecycle_follows_the_state_machine() {
        let manager = TaskManager::new();
        let record = manager.create("microsoft.login").unwrap();
        assert_eq!(record.state, TaskState::Queued);

        let running = manager
            .transition(&record.task_id, TaskState::Running)
            .unwrap();
        assert_eq!(running.state, TaskState::Running);

        let done = manager
            .finish_success(&record.task_id, serde_json::json!({"pid": 42}))
            .unwrap();
        assert_eq!(done.state, TaskState::Succeeded);
        assert_eq!(done.result.unwrap()["pid"], 42);
    }

    #[test]
    fn terminal_states_are_final() {
        let manager = TaskManager::new();
        let record = manager.create("launch.start").unwrap();
        manager
            .transition(&record.task_id, TaskState::Running)
            .unwrap();
        manager
            .finish_failure(&record.task_id, sdk_error_stub())
            .unwrap();
        let error = manager
            .transition(&record.task_id, TaskState::Running)
            .unwrap_err();
        assert_eq!(error.code, "task/invalid-transition");
        assert_eq!(
            manager
                .finish_success(&record.task_id, serde_json::json!({}))
                .unwrap_err()
                .code,
            "task/invalid-transition"
        );
    }

    #[test]
    fn queued_task_can_be_cancelled_but_not_finished() {
        let manager = TaskManager::new();
        let record = manager.create("microsoft.login").unwrap();
        assert_eq!(
            manager
                .finish_success(&record.task_id, serde_json::json!({}))
                .unwrap_err()
                .code,
            "task/invalid-transition"
        );
        assert_eq!(
            manager
                .transition(&record.task_id, TaskState::Cancelled)
                .unwrap()
                .state,
            TaskState::Cancelled
        );
    }

    #[test]
    fn unknown_task_reports_stable_code() {
        let manager = TaskManager::new();
        assert_eq!(manager.status("nope").unwrap_err().code, "task/not-found");
    }

    #[test]
    fn list_returns_recent_records_for_reload_recovery() {
        let manager = TaskManager::new();
        let first = manager.create("launch.start").unwrap();
        let second = manager.create("microsoft.login").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        manager
            .transition(&second.task_id, TaskState::Running)
            .unwrap();
        let listed = manager.list();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].task_id, second.task_id);
        assert!(listed.iter().any(|record| record.task_id == first.task_id));
    }

    fn sdk_error_stub() -> nacl_next_sdk::SdkError {
        nacl_next_sdk::SdkError::new("test/stub", "stub", false)
    }
}
