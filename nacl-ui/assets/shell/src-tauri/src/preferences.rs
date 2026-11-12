//! Host-owned defaults for future instances, separate from SDK configuration.
use nacl_next_sdk::{context::SdkContext, instance::InstanceDefaults, SdkError};
use serde::{Deserialize, Serialize};
use std::{fs, io::{ErrorKind, Write}, path::Path};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "contracts", derive(ts_rs::TS))]
pub struct HostPreferences {
    pub schema_version: u32,
    pub default_memory_mb: u32,
    pub default_window_width: u32,
    pub default_window_height: u32,
}
impl Default for HostPreferences {
    fn default() -> Self { Self { schema_version: 1, default_memory_mb: 4096, default_window_width: 1280, default_window_height: 720 } }
}
impl HostPreferences {
    fn validate(&self) -> Result<(), SdkError> {
        if self.schema_version != 1 || !(1024..=32768).contains(&self.default_memory_mb)
            || !(854..=7680).contains(&self.default_window_width)
            || !(480..=4320).contains(&self.default_window_height) {
            return Err(SdkError::new("preferences/invalid", "偏好设置版本或数值无效", false));
        }
        Ok(())
    }
    pub fn instance_defaults(&self) -> InstanceDefaults {
        InstanceDefaults { memory_mb: self.default_memory_mb, window_width: self.default_window_width, window_height: self.default_window_height }
    }
}
fn path(context: &SdkContext) -> std::path::PathBuf { context.config_root.join("host-preferences.json") }
pub fn read_preferences(context: &SdkContext) -> Result<HostPreferences, SdkError> {
    let bytes = match fs::read(path(context)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(HostPreferences::default()),
        Err(_) => return Err(SdkError::new("preferences/read-failed", "读取偏好设置失败", true)),
    };
    let result: HostPreferences = serde_json::from_slice(&bytes)
        .map_err(|_| SdkError::new("preferences/invalid", "偏好设置损坏或格式无效", false))?;
    result.validate()?;
    Ok(result)
}
fn atomic_write(destination: &Path, contents: &[u8]) -> std::io::Result<()> {
    let parent = destination.parent().ok_or_else(|| std::io::Error::other("missing parent"))?;
    let temp = parent.join(format!(".host-preferences-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, destination)
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}
pub fn save_preferences(context: &SdkContext, preferences: &HostPreferences) -> Result<HostPreferences, SdkError> {
    preferences.validate()?;
    // A corrupt or inaccessible existing file is never silently replaced.
    read_preferences(context)?;
    let contents = serde_json::to_vec_pretty(preferences)
        .map_err(|_| SdkError::new("preferences/write-failed", "序列化偏好设置失败", false))?;
    atomic_write(&path(context), &contents)
        .map_err(|_| SdkError::new("preferences/write-failed", "保存偏好设置失败", true))?;
    Ok(preferences.clone())
}
