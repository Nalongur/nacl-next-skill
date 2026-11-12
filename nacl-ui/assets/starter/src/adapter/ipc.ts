import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HostPreferences } from "../contracts/shell/HostPreferences";
import type {
  CapabilityDescriptor,
  CreateInstanceInput,
  IdentitySelection,
  InstanceConfig,
  JavaRuntime,
  LauncherAdapter,
  LaunchPreview,
  LocalProfile,
  LoginHandle,
  MicrosoftAccount,
  ProjectInfo,
  TaskRecord,
} from "./types";

const TASK_EVENT = "task-update";

/**
 * Real S1 IPC adapter. Every call goes through a registered typed command;
 * there is no fallback to mock data when the backend is missing. Rejections
 * carry the SDK's stable `SdkError` shape.
 */
export function createIpcAdapter(): LauncherAdapter {
  return {
    kind: "ipc",
    projectInfo: () => invoke<ProjectInfo>("project_info"),
    capabilities: () => invoke<CapabilityDescriptor[]>("capabilities_query"),
    preferences: {
      get: () => invoke<HostPreferences>("host_preferences_get"),
      save: (preferences) => invoke<HostPreferences>("host_preferences_save", { preferences }),
    },
    instances: {
      list: () => invoke<InstanceConfig[]>("instance_list"),
      listDeleted: () => invoke<InstanceConfig[]>("instance_list_deleted"),
      create: (input: CreateInstanceInput) =>
        invoke<InstanceConfig>("instance_create", { request: input }),
      update: (instance: InstanceConfig) =>
        invoke<InstanceConfig>("instance_update", { instance }),
      duplicate: (instanceId: string) =>
        invoke<InstanceConfig>("instance_duplicate", { instanceId }),
      remove: (instanceId: string) =>
        invoke<void>("instance_delete", { instanceId }),
      restore: (instanceId: string) =>
        invoke<InstanceConfig>("instance_restore", { instanceId }),
      permanentlyDelete: (instanceId: string) =>
        invoke<void>("instance_permanently_delete", { instanceId }),
    },
    java: {
      detect: () => invoke<JavaRuntime[]>("java_detect"),
      inspect: (path: string) => invoke<JavaRuntime>("java_inspect", { path }),
    },
    profiles: {
      list: () => invoke<LocalProfile[]>("profile_local_list"),
      create: (username: string) =>
        invoke<LocalProfile>("profile_local_create", { username }),
      rename: (profileId: string, username: string) =>
        invoke<LocalProfile>("profile_local_rename", { profileId, username }),
      remove: (profileId: string) =>
        invoke<void>("profile_local_delete", { profileId }),
    },
    microsoft: {
      status: () => invoke<MicrosoftAccount | null>("microsoft_status"),
      beginLogin: () => invoke<LoginHandle>("microsoft_login_begin"),
      completeLogin: (loginId: string) =>
        invoke<TaskRecord>("microsoft_login_complete", { loginId }),
      cancelLogin: (loginId: string) =>
        invoke<void>("microsoft_login_cancel", { loginId }),
      logout: () => invoke<void>("microsoft_logout"),
    },
    launch: {
      preview: (instanceId: string) =>
        invoke<LaunchPreview>("launch_resolve", { instanceId }),
      start: (
        instanceId: string,
        identity: IdentitySelection,
        preferredJavaPath?: string,
      ) =>
        invoke<TaskRecord>("launch_start", {
          instanceId,
          identity,
          preferredJavaPath: preferredJavaPath ?? null,
        }),
    },
    tasks: {
      list: () => invoke<TaskRecord[]>("task_list"),
      status: (taskId: string) => invoke<TaskRecord>("task_status", { taskId }),
    },
    logs: {
      list: () => invoke<string[]>("log_list"),
      read: (name: string) => invoke<string>("log_read", { name }),
    },
    events: {
      async subscribeTaskUpdates(handler: (record: TaskRecord) => void) {
        const unlisten: UnlistenFn = await listen<TaskRecord>(TASK_EVENT, (event) =>
          handler(event.payload),
        );
        return unlisten;
      },
    },
  };
}
