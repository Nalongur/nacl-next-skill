//! Managed shell state: injected SDK context, executors, providers, tasks.

use crate::tasks::TaskManager;
use nacl_next_sdk::context::SdkContext;
use nacl_next_sdk::launch::LaunchExecutor;
use nacl_next_sdk::SdkError;

pub struct ShellState {
    pub context: SdkContext,
    pub preferences_lock: std::sync::Mutex<()>,
    pub executor: LaunchExecutor,
    pub tasks: TaskManager,
    #[cfg(feature = "microsoft")]
    pub microsoft: Option<nacl_next_sdk::MicrosoftProvider>,
}

impl ShellState {
    pub fn new(
        context: SdkContext,
        #[cfg(feature = "microsoft")] client_id: Option<String>,
    ) -> Result<Self, SdkError> {
        context
            .initialize()
            .map_err(nacl_next_sdk::context::ContextError::into_sdk_error)?;
        #[cfg(feature = "microsoft")]
        let microsoft = match client_id {
            Some(client_id) => Some(nacl_next_sdk::MicrosoftProvider::new(
                nacl_next_sdk::MicrosoftClientConfig::new(client_id).map_err(SdkError::from)?,
                &context,
            )),
            None => None,
        };
        Ok(Self {
            context,
            preferences_lock: std::sync::Mutex::new(()),
            executor: LaunchExecutor::new(),
            tasks: TaskManager::new(),
            #[cfg(feature = "microsoft")]
            microsoft,
        })
    }

    /// Microsoft adapter, or a stable error when the feature/build or the
    /// developer client id is missing. Never falls back to a local identity.
    #[cfg(feature = "microsoft")]
    pub fn microsoft(&self) -> Result<&nacl_next_sdk::MicrosoftProvider, SdkError> {
        self.microsoft.as_ref().ok_or_else(|| {
            SdkError::new(
                "auth/microsoft/missing-client-id",
                "未配置 Microsoft 应用 Client ID；请由开发者/发行者配置后再使用正版登录",
                false,
            )
        })
    }
}

/// Small extension so state setup maps context errors without leaking the
/// concrete error type into command signatures.
trait ContextErrorExt {
    fn into_sdk_error(self) -> SdkError;
}

impl ContextErrorExt for nacl_next_sdk::context::ContextError {
    fn into_sdk_error(self) -> SdkError {
        SdkError::new("context/io", self.to_string(), false)
    }
}
