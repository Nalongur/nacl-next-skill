import type { CapabilityDescriptor } from "../../sdk/contracts/CapabilityDescriptor";
import type { InstanceConfig } from "../../sdk/contracts/InstanceConfig";
import type { JavaRuntime } from "../../sdk/contracts/JavaRuntime";
import type { LaunchPreview } from "../../sdk/contracts/LaunchPreview";
import type { LocalProfile } from "../../sdk/contracts/LocalProfile";
import type { LoginHandle } from "../../sdk/contracts/LoginHandle";
import type { MicrosoftAccount } from "../../sdk/contracts/MicrosoftAccount";
import type { ProjectInfo } from "../contracts/shell/ProjectInfo";
import type { HostPreferences } from "../contracts/shell/HostPreferences";
import type { TaskRecord as ShellTaskRecord } from "../contracts/shell/TaskRecord";

export type {
  CapabilityDescriptor,
  InstanceConfig,
  JavaRuntime,
  LaunchPreview,
  LocalProfile,
  LoginHandle,
  MicrosoftAccount,
  ProjectInfo,
};

export type IdentityKind = "local" | "microsoft";

export interface IdentitySelection {
  kind: IdentityKind;
  id: string;
}

export interface NormalizedError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/**
 * UI view of the shell task record. The generated shell DTO stays the
 * source for every field; only the two open JSON payloads are widened to
 * `unknown`/NormalizedError so Vue's deep unwrapping of recursive JsonValue
 * does not explode the type checker.
 */
export type TaskRecord = Omit<ShellTaskRecord, "result" | "error"> & {
  error: NormalizedError | null;
  result: unknown;
};

export interface ActionSuccess<T = unknown> {
  ok: true;
  value: T;
}

export interface ActionFailure {
  ok: false;
  error: NormalizedError;
}

export type ActionOutcome<T = unknown> = ActionSuccess<T> | ActionFailure;

export interface CreateInstanceInput {
  name: string;
  gameVersion: string;
}

/**
 * One typed surface implemented by the IPC adapter (real Tauri backend) and
 * the mock adapter. The page contract, components and action registry are
 * identical; `kind` is displayed so a mock run can never be mistaken for a
 * real backend.
 */
export interface LauncherAdapter {
  readonly kind: "ipc" | "mock";
  projectInfo(): Promise<ProjectInfo>;
  capabilities(): Promise<CapabilityDescriptor[]>;
  preferences?: { get(): Promise<HostPreferences>; save(value: HostPreferences): Promise<HostPreferences> };
  instances: {
    list(): Promise<InstanceConfig[]>;
    listDeleted(): Promise<InstanceConfig[]>;
    create(input: CreateInstanceInput): Promise<InstanceConfig>;
    update(instance: InstanceConfig): Promise<InstanceConfig>;
    duplicate(instanceId: string): Promise<InstanceConfig>;
    remove(instanceId: string): Promise<void>;
    restore(instanceId: string): Promise<InstanceConfig>;
    permanentlyDelete(instanceId: string): Promise<void>;
  };
  java: {
    detect(): Promise<JavaRuntime[]>;
    inspect(path: string): Promise<JavaRuntime>;
  };
  profiles: {
    list(): Promise<LocalProfile[]>;
    create(username: string): Promise<LocalProfile>;
    rename(profileId: string, username: string): Promise<LocalProfile>;
    remove(profileId: string): Promise<void>;
  };
  microsoft: {
    status(): Promise<MicrosoftAccount | null>;
    beginLogin(): Promise<LoginHandle>;
    completeLogin(loginId: string): Promise<TaskRecord>;
    cancelLogin(loginId: string): Promise<void>;
    logout(): Promise<void>;
  };
  launch: {
    preview(instanceId: string): Promise<LaunchPreview>;
    start(
      instanceId: string,
      identity: IdentitySelection,
      preferredJavaPath?: string,
    ): Promise<TaskRecord>;
  };
  tasks: {
    list(): Promise<TaskRecord[]>;
    status(taskId: string): Promise<TaskRecord>;
  };
  logs: {
    list(): Promise<string[]>;
    read(name: string): Promise<string>;
  };
  events: {
    subscribeTaskUpdates(handler: (record: TaskRecord) => void): Promise<() => void>;
  };
}

export function normalizeError(error: unknown): NormalizedError {
  if (error && typeof error === "object") {
    const candidate = error as Partial<NormalizedError>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable === true,
        details: candidate.details,
      };
    }
  }
  return {
    code: "ipc/unavailable",
    message:
      typeof error === "string"
        ? error
        : "桌面后端不可用或返回了无法识别的错误；请从构建后的桌面应用打开。",
    retryable: true,
  };
}
