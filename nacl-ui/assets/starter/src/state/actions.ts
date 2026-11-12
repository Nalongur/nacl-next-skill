import type {
  ActionOutcome,
  InstanceConfig,
  IdentitySelection,
  JavaRuntime,
  LauncherAdapter,
  LocalProfile,
  NormalizedError,
  TaskRecord,
} from "../adapter/types";
import { normalizeError } from "../adapter/types";
import { validAdvancedArguments } from "./advanced-arguments";
import { normalizedInstanceName } from "./instance-name";
import type { PageDefinition, ProjectConfig } from "../contract/page";
import {
  effectiveIdentity,
  selectedInstance,
  selectedProfile,
  setGlobalError,
  store,
} from "./store";
import { createTaskFlow } from "./taskFlow";

type Payload = Record<string, any>;
type ActionHandler = (payload: Payload) => Promise<unknown> | unknown;

export interface BootstrapResult {
  ok: boolean;
  error?: NormalizedError;
}

export interface ActionController {
  bootstrap(project: ProjectConfig, page: PageDefinition): Promise<BootstrapResult>;
  run(actionId: string, payload?: Payload): Promise<ActionOutcome>;
  dispose(): void;
}

function failure(code: string, message: string): NormalizedError {
  return { code, message, retryable: false };
}

function hasActiveTask(): boolean {
  return store.tasks.some(
    (task) => task.state === "queued" || task.state === "running",
  );
}

export function createActionController(adapter: LauncherAdapter): ActionController {
  let instanceRevision = 0;
  let unlisten: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // One reconciliation path for task-update events, task queries and
  // command-returned records (review S3-R1): business state recovery no
  // longer depends on events being received.
  const flow = createTaskFlow(store, {
    refreshLogs: () => {
      void refreshLogs();
    },
    refreshMicrosoft: () => {
      void refreshMicrosoft();
    },
  });

  const stopPolling = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
      store.taskPolling = false;
    }
  };

  const ensurePolling = () => {
    if (pollTimer !== null) return;
    if (store.eventStatus !== "failed" && !hasActiveTask()) return;
    pollTimer = setInterval(() => {
      void refreshTasks();
      if (store.eventStatus !== "failed" && !hasActiveTask()) stopPolling();
    }, 2000);
    store.taskPolling = true;
  };

  const handleTask = (record: TaskRecord) => {
    flow.ingest(record, "event");
    ensurePolling();
  };

  async function refreshInstances(options: { selectFirst?: boolean; retryStale?: boolean } = {}) {
    const revision = instanceRevision;
    store.instancesLoading = true;
    store.instancesError = null;
    try {
      const [active, removed] = await Promise.all([
        adapter.instances.list(),
        options.retryStale ? adapter.instances.listDeleted() : adapter.instances.listDeleted().catch(() => []),
      ]);
      if (revision !== instanceRevision) {
        if (options.retryStale) await refreshInstances(options);
        return;
      }
      store.instances = active;
      store.deletedInstances = removed;
      const stillThere = active.some(
        (instance) => instance.id === store.selectedInstanceId,
      );
      if (!stillThere) {
        const next = options.selectFirst && active.length > 0 ? active[0].id : null;
        store.selectedInstanceId = next;
        store.preview = null;
        if (next) await resolvePreview();
      }
    } catch (error) {
      if (revision !== instanceRevision && options.retryStale) await refreshInstances(options);
      else if (revision === instanceRevision) {
        if (options.retryStale) throw error;
        store.instancesError = normalizeError(error);
      }
    } finally {
      store.instancesLoading = false;
    }
  }

  async function refreshAfterMutation(description: string, selectFirst = false) {
    try { await refreshInstances({ selectFirst, retryStale: true }); }
    catch { throw failure("instance/refresh-after-write", `${description}，但列表刷新失败；请手动刷新，勿重复操作`); }
  }

  async function resolvePreview() {
    const instance = selectedInstance();
    if (!instance) {
      store.preview = null;
      return;
    }
    const instanceId = instance.id;
    store.previewBusy = true;
    try {
      const preview = await adapter.launch.preview(instanceId);
      if (store.selectedInstanceId === instanceId) store.preview = preview;
    } catch (error) {
      const normalized = normalizeError(error);
      if (store.selectedInstanceId === instanceId) {
        store.preview = {
          instanceId,
          ready: false,
          failureCode: normalized.code,
          failureMessage: normalized.message,
          metadataId: null,
          requiredJavaMajor: null,
          selectedJava: null,
        };
      }
    } finally {
      store.previewBusy = false;
    }
  }

  async function refreshJava() {
    store.javaBusy = true;
    store.javaError = null;
    try {
      store.javaDetected = await adapter.java.detect();
    } catch (error) {
      store.javaError = normalizeError(error);
    } finally {
      store.javaBusy = false;
    }
  }

  async function refreshProfiles() {
    store.profilesLoading = true;
    store.profilesError = null;
    try {
      store.profiles = await adapter.profiles.list();
      if (
        store.selectedProfileId &&
        !store.profiles.some((profile) => profile.id === store.selectedProfileId)
      ) {
        store.selectedProfileId = null;
        if (store.mode === "d" && store.selectedIdentityKind === "local") {
          store.selectedIdentityKind = null;
        }
      }
    } catch (error) {
      store.profilesError = normalizeError(error);
    } finally {
      store.profilesLoading = false;
    }
  }

  async function refreshMicrosoft() {
    store.microsoft.error = null;
    try {
      const account = await adapter.microsoft.status();
      store.microsoft.account = account;
      store.microsoft.status = account ? "signed-in" : "signed-out";
      if (!account && store.mode === "d" && store.selectedIdentityKind === "microsoft") {
        // The selected identity disappeared; clear it instead of silently
        // switching the launch identity to a local profile.
        store.selectedIdentityKind = null;
      }
    } catch (error) {
      const normalized = normalizeError(error);
      store.microsoft.account = null;
      store.microsoft.error = normalized;
      store.microsoft.status =
        normalized.code === "auth/microsoft/missing-client-id"
          ? "missing-config"
          : "error";
      if (store.mode === "d" && store.selectedIdentityKind === "microsoft") {
        store.selectedIdentityKind = null;
      }
    }
  }

  async function refreshTasks() {
    try {
      const records = await adapter.tasks.list();
      flow.ingestMany(records, "query");
    } catch (error) {
      if (store.eventStatus === "failed") {
        store.eventsError = normalizeError(error).message;
      }
    }
  }

  async function subscribeTasks() {
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
    store.eventStatus = "connecting";
    try {
      unlisten = await adapter.events.subscribeTaskUpdates(handleTask);
      store.eventStatus = "subscribed";
      store.eventsError = null;
      stopPolling();
      // Closing the event-loss/reload gap with an explicit state query.
      await refreshTasks();
    } catch (error) {
      store.eventStatus = "failed";
      store.eventsError = normalizeError(error).message;
      ensurePolling();
      throw error;
    }
  }

  async function refreshLogs() {
    store.logsLoading = true;
    store.logError = null;
    try {
      store.logs = await adapter.logs.list();
      if (store.selectedLog && !store.logs.includes(store.selectedLog)) {
        store.selectedLog = null;
        store.logContent = "";
      }
    } catch (error) {
      store.logError = normalizeError(error);
    } finally {
      store.logsLoading = false;
    }
  }

  async function readLog(name: string) {
    store.selectedLog = name;
    store.logsLoading = true;
    store.logError = null;
    try {
      store.logContent = await adapter.logs.read(name);
      if (!store.logs.includes(name)) store.logs = [name, ...store.logs];
    } catch (error) {
      store.logContent = "";
      store.logError = normalizeError(error);
      throw error;
    } finally {
      store.logsLoading = false;
    }
  }

  const instanceUpdates = new Set<string>();
  async function withInstanceUpdate<T>(id: string, update: () => Promise<T>): Promise<T> {
    if (instanceUpdates.has(id)) throw failure("instance/update-busy", "该实例正在保存，请稍后重试");
    instanceUpdates.add(id);
    try { return await update(); } finally { instanceUpdates.delete(id); }
  }

  async function setJava(runtime: JavaRuntime) {
    const selected = selectedInstance();
    if (!selected) throw failure("instance/not-selected", "请先选择实例");
    return withInstanceUpdate(selected.id, async () => {
      const instance = store.instances.find((item) => item.id === selected.id);
      if (!instance) throw failure("instance/not-selected", "实例不存在");
      const updated: InstanceConfig = {
        ...instance,
        java: { mode: "custom", path: runtime.path },
      };
      const saved = await adapter.instances.update(updated);
      instanceRevision++;
      store.instances = store.instances.map((candidate) =>
        candidate.id === saved.id ? saved : candidate,
      );
      store.javaDetected = [
        runtime,
        ...store.javaDetected.filter((candidate) => candidate.path !== runtime.path),
      ];
      if (store.selectedInstanceId === saved.id) await resolvePreview();
      return saved;
    });
  }

  const handlers: Record<string, ActionHandler> = {
    "host.preferences.get": () => {
      if (!store.capabilities.some(item => item.name === "host.preferences") || !adapter.preferences) throw failure("preferences/unavailable", "宿主不支持偏好设置");
      return adapter.preferences.get();
    },
    "host.preferences.save": (payload) => {
      if (!store.capabilities.some(item => item.name === "host.preferences") || !adapter.preferences) throw failure("preferences/unavailable", "宿主不支持偏好设置");
      return adapter.preferences.save(payload.preferences);
    },
    "instances.refresh": () => refreshInstances(),
    "instances.select": (payload) => {
      store.selectedInstanceId = String(payload.id);
      store.preview = null;
      store.launchLast = null;
      return resolvePreview();
    },
    "instances.create": async (payload) => {
      const instance = await adapter.instances.create({
        name: String(payload.name ?? "").trim(),
        gameVersion: String(payload.gameVersion ?? "").trim(),
      });
      instanceRevision++;
      store.instances = [...store.instances.filter((item) => item.id !== instance.id), instance];
      store.selectedInstanceId = instance.id;
      await refreshAfterMutation("实例已创建");
      await resolvePreview();
      return instance;
    },
    "instances.duplicate": async (payload) => {
      const instance = await adapter.instances.duplicate(String(payload.id));
      instanceRevision++;
      await refreshAfterMutation("实例已复制");
      return instance;
    },
    "instances.delete": async (payload) => {
      const id = String(payload.id);
      return withInstanceUpdate(id, async () => {
        await adapter.instances.remove(id);
        instanceRevision++;
        if (store.selectedInstanceId === id) {
          store.selectedInstanceId = null;
          store.preview = null;
        }
        store.instances = store.instances.filter((item) => item.id !== id);
        await refreshAfterMutation("实例已移入回收站", true);
      });
    },
    "instances.restore": async (payload) => {
      const instance = await adapter.instances.restore(String(payload.id));
      instanceRevision++;
      await refreshAfterMutation("实例已恢复");
      return instance;
    },
    "instances.purge": async (payload) => {
      await adapter.instances.permanentlyDelete(String(payload.id));
      instanceRevision++;
      await refreshAfterMutation("实例已彻底删除");
    },
    "instances.update-java": (payload) => setJava(payload.runtime as JavaRuntime),
    "instances.java-auto": async (payload) => {
      const current = selectedInstance();
      if (!current || current.id !== payload.instanceId) throw failure("instance/stale-selection", "实例已切换，请重新选择后保存");
      return withInstanceUpdate(current.id, async () => {
        const latest = store.instances.find((item) => item.id === current.id);
        if (!latest || store.selectedInstanceId !== current.id) throw failure("instance/stale-selection", "实例已切换，请重新选择后保存");
        const saved = await adapter.instances.update({ ...latest, java: { mode: "auto" } });
        instanceRevision++;
        store.instances = store.instances.map((item) => item.id === saved.id ? saved : item);
        if (store.selectedInstanceId === saved.id) await resolvePreview();
        return saved;
      });
    },
    "instances.rename": async (payload) => {
      const current = selectedInstance();
      if (!current || current.id !== payload.instanceId) throw failure("instance/stale-selection", "实例已切换，请重新选择后保存");
      const name = normalizedInstanceName(payload.name);
      if (name === null) throw failure("instance/invalid-name", "名称不能为空，最多 64 个 Unicode 字符，且不能包含控制字符");
      return withInstanceUpdate(current.id, async () => {
        const latest = store.instances.find((item) => item.id === current.id);
        if (!latest || store.selectedInstanceId !== current.id) throw failure("instance/stale-selection", "实例已切换，请重新选择后保存");
        const saved = await adapter.instances.update({ ...latest, name });
        instanceRevision++;
        store.instances = store.instances.map((item) => item.id === saved.id ? saved : item);
        if (store.selectedInstanceId === saved.id) await resolvePreview();
        return saved;
      });
    },
    "instances.update-settings": async (payload) => {
      const current = selectedInstance();
      if (!current || current.id !== payload.instanceId) throw failure("instance/stale-selection", "实例已切换，请重新选择后保存");
      const { minimumMb, maximumMb, width, height, mode } = payload;
      if (![minimumMb, maximumMb, width, height].every(Number.isInteger) || minimumMb < 512 || maximumMb > 32768 || minimumMb > maximumMb || width < 854 || width > 7680 || height < 480 || height > 4320 || !["windowed", "maximized", "fullscreen"].includes(mode)) throw failure("instance/invalid-settings", "内存或窗口设置超出允许范围");
      return withInstanceUpdate(current.id, async () => {
        const latest = store.instances.find((item) => item.id === current.id);
        if (!latest || store.selectedInstanceId !== current.id) throw failure("instance/stale-selection", "实例已切换，请重新选择后保存");
        const updated: InstanceConfig = { ...latest, memory: { minimumMb, maximumMb }, display: { mode, width, height } };
        const saved = await adapter.instances.update(updated);
        instanceRevision++;
        store.instances = store.instances.map((item) => item.id === saved.id ? saved : item);
        if (store.selectedInstanceId === saved.id) await resolvePreview();
        return saved;
      });
    },
    "instances.update-advanced": async (payload) => {
      const current = selectedInstance();
      if (!current || current.id !== payload.instanceId) throw failure("instance/stale-selection", "实例已切换，请重新选择后保存");
      const { jvmArguments, gameArguments } = payload;
      if (!validAdvancedArguments(jvmArguments) || !validAdvancedArguments(gameArguments)) throw failure("instance/invalid-advanced", "每项最多 4096 个 UTF-8 字节，且不能包含控制字符");
      return withInstanceUpdate(current.id, async () => {
        const latest = store.instances.find((item) => item.id === current.id);
        if (!latest || store.selectedInstanceId !== current.id) throw failure("instance/stale-selection", "实例已切换，请重新选择后保存");
        const updated: InstanceConfig = { ...latest, advanced: { ...latest.advanced, jvmArguments, gameArguments } };
        const saved = await adapter.instances.update(updated);
        instanceRevision++;
        store.instances = store.instances.map((item) => item.id === saved.id ? saved : item);
        if (store.selectedInstanceId === saved.id) await resolvePreview();
        return saved;
      });
    },
    "java.detect": () => refreshJava(),
    "java.inspect": async (payload) => {
      const runtime = await adapter.java.inspect(String(payload.path ?? ""));
      store.javaDetected = [
        runtime,
        ...store.javaDetected.filter((candidate) => candidate.path !== runtime.path),
      ];
      return runtime;
    },
    "profiles.refresh": () => refreshProfiles(),
    "profiles.select": (payload) => {
      store.selectedProfileId = String(payload.id);
      if (store.mode === "d") store.selectedIdentityKind = "local";
    },
    "profiles.create": async (payload) => {
      const profile = await adapter.profiles.create(String(payload.username ?? ""));
      await refreshProfiles();
      store.selectedProfileId = profile.id;
      if (store.mode === "d") store.selectedIdentityKind = "local";
      return profile;
    },
    "profiles.rename": async (payload) => {
      const profile = await adapter.profiles.rename(
        String(payload.id),
        String(payload.username ?? ""),
      );
      await refreshProfiles();
      return profile;
    },
    "profiles.delete": async (payload) => {
      await adapter.profiles.remove(String(payload.id));
      if (store.selectedProfileId === String(payload.id)) {
        store.selectedProfileId = null;
        if (store.mode === "d" && store.selectedIdentityKind === "local") {
          store.selectedIdentityKind = null;
        }
      }
      await refreshProfiles();
    },
    "microsoft.refresh": () => refreshMicrosoft(),
    "microsoft.login.begin": async () => {
      store.microsoft.busy = true;
      store.microsoft.error = null;
      try {
        const handle = await adapter.microsoft.beginLogin();
        store.microsoft.login = handle;
        store.microsoft.status = "signed-out";
        return handle;
      } finally {
        store.microsoft.busy = false;
      }
    },
    "microsoft.login.complete": async () => {
      if (!store.microsoft.login) throw failure("auth/microsoft/no-login", "没有待完成的登录");
      const loginId = store.microsoft.login.loginId;
      flow.beginLoginCompletion();
      try {
        const record = await adapter.microsoft.completeLogin(loginId);
        flow.ingest(record, "command");
        ensurePolling();
        return record;
      } finally {
        flow.endLoginCompletion();
      }
    },
    "microsoft.login.cancel": async () => {
      if (!store.microsoft.login) return;
      await adapter.microsoft.cancelLogin(store.microsoft.login.loginId);
      store.microsoft.login = null;
      store.microsoft.busy = false;
    },
    "microsoft.logout": async () => {
      await adapter.microsoft.logout();
      store.microsoft.account = null;
      store.microsoft.status = "signed-out";
      store.microsoft.error = null;
      store.microsoft.login = null;
      store.microsoft.pendingTaskId = null;
      if (store.mode === "d" && store.selectedIdentityKind === "microsoft") {
        store.selectedIdentityKind = null;
      }
    },
    "identity.refresh": async () => {
      await Promise.all([refreshMicrosoft(), refreshProfiles()]);
    },
    "identity.select": (payload) => {
      const kind = String(payload.kind);
      if (kind !== "local" && kind !== "microsoft") {
        throw failure("identity/unknown-kind", `未知身份类型 ${kind}`);
      }
      if (kind === "local" && payload.profileId) {
        store.selectedProfileId = String(payload.profileId);
      }
      if (kind === "microsoft" && !store.microsoft.account) {
        throw failure("identity/not-signed-in", "尚未登录 Microsoft 账号，不能选择正版身份");
      }
      if (kind === "local" && !selectedProfile()) {
        throw failure("identity/no-profile", "尚未选择本地档案，不能选择离线身份");
      }
      store.selectedIdentityKind = kind;
    },
    "launch.resolve": () => resolvePreview(),
    "launch.start": async () => {
      const instance = selectedInstance();
      if (!instance) throw failure("instance/not-selected", "请先选择实例");
      const identity = effectiveIdentity();
      if (!identity) throw failure("identity/not-selected", "请先明确选择本次启动身份");
      if (!store.preview?.ready) {
        throw failure(
          store.preview?.failureCode ?? "launch/not-ready",
          store.preview?.failureMessage ?? "启动检查未通过",
        );
      }
      const selection: IdentitySelection = { kind: identity.kind, id: identity.id };
      // One unconfirmed launch command at a time (review R3-A/R3-B): the
      // response's taskId is the only ownership evidence, so until it
      // returns no second launch may start and early records are buffered
      // by the flow. begin refusing means the previous command is still in
      // flight — abort must not run for that error, it would close the
      // other operation.
      if (!flow.beginLaunchOperation()) {
        throw failure("launch/command-in-flight", "上一次启动命令尚未返回，请稍后再试");
      }
      try {
        const record = await adapter.launch.start(instance.id, selection);
        flow.ingest(record, "command");
        ensurePolling();
        return record;
      } catch (error) {
        flow.abortLaunchOperation();
        throw error;
      }
    },
    "tasks.refresh": () => refreshTasks(),
    "tasks.resubscribe": () => subscribeTasks(),
    "tasks.status": async (payload) => {
      const record = await adapter.tasks.status(String(payload.taskId));
      flow.ingest(record, "query");
      if (record.state === "queued" || record.state === "running") ensurePolling();
      return record;
    },
    "logs.refresh": () => refreshLogs(),
    "logs.read": (payload) => readLog(String(payload.name)),
    "logs.select": (payload) => readLog(String(payload.name)),
  };

  async function bootstrap(
    project: ProjectConfig,
    page: PageDefinition,
  ): Promise<BootstrapResult> {
    store.project = project;
    store.page = page;
    store.mode = project.mode;
    store.layout = project.layout;
    store.adapterKind = adapter.kind;

    try {
      const info = await adapter.projectInfo();
      store.projectInfo = info;
      if (info.mode !== project.mode) {
        return {
          ok: false,
          error: failure(
            "page/backend-mode-mismatch",
            `页面模式 ${project.mode.toUpperCase()} 与桌面后端 ${info.mode.toUpperCase()} 不一致`,
          ),
        };
      }
      if (info.sdkVersion !== project.sdk.version) {
        return {
          ok: false,
          error: failure(
            "page/sdk-version-mismatch",
            `项目记录 SDK ${project.sdk.version}，后端为 ${info.sdkVersion}；请重新生成工程`,
          ),
        };
      }
      if (info.pageSchemaVersion !== project.pageSchemaVersion) {
        return {
          ok: false,
          error: failure(
            "page/schema-version-mismatch",
            `页面 schema ${project.pageSchemaVersion} 与后端 ${info.pageSchemaVersion} 不一致`,
          ),
        };
      }
      store.capabilities = await adapter.capabilities();
      const available = new Set(store.capabilities.map((capability) => capability.name));
      const required =
        project.mode === "a"
          ? ["account.microsoft", "launch.game", "instance.manage"]
          : project.mode === "b"
            ? ["account.local", "launch.game", "instance.manage"]
            : ["account.local", "account.microsoft", "launch.game", "instance.manage"];
      const missing = required.filter((name) => !available.has(name));
      if (missing.length > 0) {
        return {
          ok: false,
          error: failure(
            "page/capability-mismatch",
            `后端缺少页面所需能力：${missing.join("、")}`,
          ),
        };
      }
    } catch (error) {
      return { ok: false, error: normalizeError(error) };
    }

    await Promise.all([
      refreshInstances({ selectFirst: true }),
      refreshJava(),
      project.mode === "a" ? Promise.resolve() : refreshProfiles(),
      project.mode === "b" ? Promise.resolve() : refreshMicrosoft(),
      refreshLogs(),
    ]);

    store.eventStatus = "connecting";
    try {
      await subscribeTasks();
    } catch {
      // Subscription failure is recoverable from the UI; boot continues and
      // state polling is already armed.
    }
    ensurePolling();
    return { ok: true };
  }

  async function run(actionId: string, payload: Payload = {}): Promise<ActionOutcome> {
    const handler = handlers[actionId];
    if (!handler) {
      return {
        ok: false,
        error: failure("page/unknown-action", `未注册动作 ${actionId}`),
      };
    }
    const localPreferencesError = actionId.startsWith("host.preferences.");
    if (!localPreferencesError) setGlobalError(null);
    try {
      const value = await handler(payload);
      return { ok: true, value };
    } catch (error) {
      const normalized = normalizeError(error);
      if (!localPreferencesError) setGlobalError(normalized);
      return { ok: false, error: normalized };
    }
  }

  function dispose() {
    stopPolling();
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  }

  return { bootstrap, run, dispose };
}
