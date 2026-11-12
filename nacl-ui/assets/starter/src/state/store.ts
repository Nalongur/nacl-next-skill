import { reactive } from "vue";
import type {
  CapabilityDescriptor,
  IdentityKind,
  InstanceConfig,
  JavaRuntime,
  LaunchPreview,
  LocalProfile,
  LoginHandle,
  MicrosoftAccount,
  NormalizedError,
  ProjectInfo,
  TaskRecord,
} from "../adapter/types";
import type { LayoutId, PageDefinition, PageMode, ProjectConfig } from "../contract/page";
import type { LaunchedProcess } from "../../sdk/contracts/LaunchedProcess";
import type { TaskEvent } from "./taskFlow";

export type { TaskEvent };

export interface EffectiveIdentity {
  kind: IdentityKind;
  id: string;
  username: string;
  label: string;
}

export type MicrosoftStatus =
  | "unknown"
  | "signed-out"
  | "signed-in"
  | "missing-config"
  | "error";

export type EventStatus = "idle" | "connecting" | "subscribed" | "failed";

export interface MicrosoftState {
  account: MicrosoftAccount | null;
  status: MicrosoftStatus;
  error: NormalizedError | null;
  login: LoginHandle | null;
  pendingTaskId: string | null;
  busy: boolean;
}

export interface ShellStore {
  project: ProjectConfig | null;
  page: PageDefinition | null;
  mode: PageMode;
  layout: LayoutId;
  adapterKind: "ipc" | "mock";
  projectInfo: ProjectInfo | null;
  capabilities: CapabilityDescriptor[];
  instances: InstanceConfig[];
  deletedInstances: InstanceConfig[];
  selectedInstanceId: string | null;
  instancesLoading: boolean;
  instancesError: NormalizedError | null;
  javaDetected: JavaRuntime[];
  javaError: NormalizedError | null;
  javaBusy: boolean;
  profiles: LocalProfile[];
  selectedProfileId: string | null;
  profilesLoading: boolean;
  profilesError: NormalizedError | null;
  microsoft: MicrosoftState;
  selectedIdentityKind: IdentityKind | null;
  preview: LaunchPreview | null;
  previewBusy: boolean;
  launchBusy: boolean;
  launchLast: LaunchedProcess | null;
  tasks: TaskRecord[];
  taskEvents: TaskEvent[];
  eventStatus: EventStatus;
  eventsError: string | null;
  taskPolling: boolean;
  logs: string[];
  selectedLog: string | null;
  logContent: string;
  logsLoading: boolean;
  logError: NormalizedError | null;
  globalError: NormalizedError | null;
}

export const store = reactive<ShellStore>({
  project: null,
  page: null,
  mode: "b",
  layout: "sidebar",
  adapterKind: "ipc",
  projectInfo: null,
  capabilities: [],
  instances: [],
  deletedInstances: [],
  selectedInstanceId: null,
  instancesLoading: false,
  instancesError: null,
  javaDetected: [],
  javaError: null,
  javaBusy: false,
  profiles: [],
  selectedProfileId: null,
  profilesLoading: false,
  profilesError: null,
  microsoft: {
    account: null,
    status: "unknown",
    error: null,
    login: null,
    pendingTaskId: null,
    busy: false,
  },
  selectedIdentityKind: null,
  preview: null,
  previewBusy: false,
  launchBusy: false,
  launchLast: null,
  tasks: [],
  taskEvents: [],
  eventStatus: "idle",
  eventsError: null,
  taskPolling: false,
  logs: [],
  selectedLog: null,
  logContent: "",
  logsLoading: false,
  logError: null,
  globalError: null,
});

export function selectedInstance(): InstanceConfig | null {
  return (
    store.instances.find((instance) => instance.id === store.selectedInstanceId) ?? null
  );
}

export function selectedProfile(): LocalProfile | null {
  return store.profiles.find((profile) => profile.id === store.selectedProfileId) ?? null;
}

export function effectiveIdentity(): EffectiveIdentity | null {
  if (store.mode === "a") {
    const account = store.microsoft.account;
    if (!account) return null;
    return {
      kind: "microsoft",
      id: account.minecraftId,
      username: account.minecraftName,
      label: "Microsoft · 已验证",
    };
  }
  if (store.mode === "b") {
    const profile = selectedProfile();
    if (!profile) return null;
    return {
      kind: "local",
      id: profile.id,
      username: profile.username,
      label: "本地档案 · 未官方验证",
    };
  }
  if (store.selectedIdentityKind === "microsoft") {
    const account = store.microsoft.account;
    if (!account) return null;
    return {
      kind: "microsoft",
      id: account.minecraftId,
      username: account.minecraftName,
      label: "Microsoft · 已验证",
    };
  }
  if (store.selectedIdentityKind === "local") {
    const profile = selectedProfile();
    if (!profile) return null;
    return {
      kind: "local",
      id: profile.id,
      username: profile.username,
      label: "本地档案 · 未官方验证",
    };
  }
  return null;
}

export function setGlobalError(error: NormalizedError | null) {
  store.globalError = error;
}

export function resetStore() {
  store.project = null;
  store.page = null;
  store.mode = "b";
  store.layout = "sidebar";
  store.adapterKind = "ipc";
  store.projectInfo = null;
  store.capabilities = [];
  store.instances = [];
  store.deletedInstances = [];
  store.selectedInstanceId = null;
  store.instancesLoading = false;
  store.instancesError = null;
  store.javaDetected = [];
  store.javaError = null;
  store.javaBusy = false;
  store.profiles = [];
  store.selectedProfileId = null;
  store.profilesLoading = false;
  store.profilesError = null;
  store.microsoft = {
    account: null,
    status: "unknown",
    error: null,
    login: null,
    pendingTaskId: null,
    busy: false,
  };
  store.selectedIdentityKind = null;
  store.preview = null;
  store.previewBusy = false;
  store.launchBusy = false;
  store.launchLast = null;
  store.tasks = [];
  store.taskEvents = [];
  store.eventStatus = "idle";
  store.eventsError = null;
  store.taskPolling = false;
  store.logs = [];
  store.selectedLog = null;
  store.logContent = "";
  store.logsLoading = false;
  store.logError = null;
  store.globalError = null;
}
