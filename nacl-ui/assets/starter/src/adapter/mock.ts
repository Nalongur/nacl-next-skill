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
import type { SdkError } from "../../sdk/contracts/SdkError";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sdkError(code: string, message: string): SdkError {
  return { code, message, retryable: false, details: null };
}

function baseInstance(
  id: string,
  name: string,
  gameVersion: string,
  ready: boolean,
): InstanceConfig {
  return {
    schemaVersion: 2,
    id,
    name,
    gameVersion,
    loader: { kind: "vanilla", version: null, profileId: null },
    gameDirectory: "game",
    java: ready
      ? { mode: "custom", path: "C:\\Java\\temurin-21\\bin\\java.exe" }
      : { mode: "auto" },
    memory: { minimumMb: 1024, maximumMb: 4096 },
    display: { mode: "windowed", width: 1280, height: 720 },
    advanced: { jvmArguments: "", gameArguments: "", debugLogging: false },
    installation: {
      state: ready ? "ready" : "incomplete",
      installedEpochMs: null,
    },
  };
}

const JAVA_RUNTIME: JavaRuntime = {
  path: "C:\\Java\\temurin-21\\bin\\java.exe",
  home: "C:\\Java\\temurin-21",
  version: "21.0.11",
  majorVersion: 21,
  architecture: "x86_64",
  vendor: "Eclipse Adoptium",
  source: "mock",
  managed: false,
};

const LOG_CONTENT = [
  "[mock] NaCL Next S3 演示日志",
  "[mock] 这里仅展示日志阅读器的加载/空/错误状态，不代表真实游戏输出。",
  "[mock] 启动检查不会自动下载或修复任何文件。",
].join("\n");

/**
 * Deterministic in-memory adapter for layout work and offline demos.
 *
 * Every view is labelled MOCK in the shell. It never performs network,
 * account, file-system or process operations, and it is never a substitute
 * for IPC acceptance evidence.
 */
export function createMockAdapter(
  mode: "a" | "b" | "d",
  sdkVersion: string,
  pageSchemaVersion: number,
): LauncherAdapter {
  let instances: InstanceConfig[] = [
    baseInstance("demo-probe", "演示探针实例", "1.21.1-probe", true),
    baseInstance("demo-missing", "缺少客户端文件", "1.21.1-missing", false),
  ];
  let deleted: InstanceConfig[] = [
    baseInstance("demo-deleted", "已删除的旧实例", "1.20.4-probe", false),
  ];
  let profiles: LocalProfile[] = [
    {
      schemaVersion: 1,
      id: "profile-steve",
      username: "Steve_01",
      uuid: "11111111111111111111111111111111",
      createdEpochMs: BigInt(1_700_000_000_000),
    },
    {
      schemaVersion: 1,
      id: "profile-alex",
      username: "Alex_02",
      uuid: "22222222222222222222222222222222",
      createdEpochMs: BigInt(1_700_000_100_000),
    },
  ];
  const tasks = new Map<string, TaskRecord>();
  const subscribers = new Set<(record: TaskRecord) => void>();
  let taskSequence = 0;

  const emit = (record: TaskRecord) => {
    tasks.set(record.taskId, record);
    for (const subscriber of subscribers) subscriber({ ...record });
  };

  const createTask = (kind: string): TaskRecord => {
    taskSequence += 1;
    const now = Date.now();
    const record: TaskRecord = {
      taskId: `mock-task-${taskSequence}`,
      kind,
      state: "queued",
      createdEpochMs: now,
      updatedEpochMs: now,
      summary: "模拟任务：不会接触真实账号、文件或进程",
      error: null,
      result: null,
    };
    emit(record);
    return record;
  };

  const transition = (
    taskId: string,
    state: TaskRecord["state"],
    patch: Partial<TaskRecord> = {},
  ) => {
    const current = tasks.get(taskId);
    if (!current) return;
    emit({ ...current, ...patch, state, updatedEpochMs: Date.now() });
  };

  const startLaunch = async (
    instanceId: string,
    identity: IdentitySelection,
  ): Promise<TaskRecord> => {
    const instance = instances.find((candidate) => candidate.id === instanceId);
    if (!instance) throw sdkError("instance/not-found", `没有实例 ${instanceId}`);
    if (identity.kind === "local" && !profiles.some((profile) => profile.id === identity.id)) {
      throw sdkError("account/unknown-identity", "本地档案不存在");
    }
    if (identity.kind === "microsoft") {
      throw sdkError("account/unavailable", "未登录 Microsoft 账号（模拟适配器没有真实登录）");
    }
    const record = createTask("launch.start");
    setTimeout(() => transition(record.taskId, "running"), 350);
    setTimeout(() => {
      if (instanceId === "demo-missing") {
        transition(record.taskId, "failed", {
          error: sdkError(
            "launch/missing-metadata",
            "缺少版本元数据 1.21.1-missing；不会自动下载或修复",
          ),
        });
        return;
      }
      transition(record.taskId, "succeeded", {
        result: {
          instanceId,
          processId: 4242,
          logFile: "launch-demo.log",
          startedEpochMs: String(Date.now()),
        },
      });
    }, 1900);
    return record;
  };

  return {
    kind: "mock",
    async projectInfo(): Promise<ProjectInfo> {
      return {
        mode,
        sdkVersion,
        shellVersion: sdkVersion,
        pageSchemaVersion,
      };
    },
    async capabilities(): Promise<CapabilityDescriptor[]> {
      return [
        { namespace: "nacl-next", name: "instance.manage", contractVersion: 1, permissions: [] },
        { namespace: "nacl-next", name: "java.detect", contractVersion: 1, permissions: [] },
        ...(mode !== "a"
          ? [
              {
                namespace: "nacl-next",
                name: "account.local",
                contractVersion: 1,
                permissions: [],
              },
            ]
          : []),
        ...(mode !== "b"
          ? [
              {
                namespace: "nacl-next",
                name: "account.microsoft",
                contractVersion: 1,
                permissions: [],
              },
            ]
          : []),
        { namespace: "nacl-next", name: "launch.game", contractVersion: 1, permissions: [] },
        { namespace: "nacl-next", name: "diagnostics.logs", contractVersion: 1, permissions: [] },
      ];
    },
    instances: {
      async list() {
        await delay(120);
        return instances.map((instance) => ({ ...instance }));
      },
      async listDeleted() {
        await delay(60);
        return deleted.map((instance) => ({ ...instance }));
      },
      async create(input: CreateInstanceInput) {
        await delay(180);
        const name = input.name.trim();
        if (name.length < 1) throw sdkError("instance/invalid-name", "实例名称不能为空");
        const instance = baseInstance(
          `demo-${Date.now()}`,
          name,
          input.gameVersion.trim() || "1.21.1-probe",
          false,
        );
        instances = [...instances, instance];
        return { ...instance };
      },
      async update(instance: InstanceConfig) {
        await delay(120);
        instances = instances.map((candidate) =>
          candidate.id === instance.id ? { ...instance } : candidate,
        );
        return { ...instance };
      },
      async duplicate(instanceId: string) {
        await delay(150);
        const source = instances.find((candidate) => candidate.id === instanceId);
        if (!source) throw sdkError("instance/not-found", `没有实例 ${instanceId}`);
        const copy = {
          ...source,
          id: `demo-copy-${Date.now()}`,
          name: `${source.name} 副本`,
        };
        instances = [...instances, copy];
        return { ...copy };
      },
      async remove(instanceId: string) {
        await delay(120);
        const target = instances.find((candidate) => candidate.id === instanceId);
        if (!target) throw sdkError("instance/not-found", `没有实例 ${instanceId}`);
        instances = instances.filter((candidate) => candidate.id !== instanceId);
        deleted = [...deleted, target];
      },
      async restore(instanceId: string) {
        await delay(120);
        const target = deleted.find((candidate) => candidate.id === instanceId);
        if (!target) throw sdkError("instance/not-found", `回收站没有实例 ${instanceId}`);
        deleted = deleted.filter((candidate) => candidate.id !== instanceId);
        instances = [...instances, target];
        return { ...target };
      },
      async permanentlyDelete(instanceId: string) {
        await delay(120);
        deleted = deleted.filter((candidate) => candidate.id !== instanceId);
      },
    },
    java: {
      async detect() {
        await delay(160);
        return [{ ...JAVA_RUNTIME }];
      },
      async inspect(path: string) {
        await delay(200);
        if (!path.trim()) throw sdkError("java/invalid-executable", "Java 路径为空");
        return { ...JAVA_RUNTIME, path: path.trim() };
      },
    },
    profiles: {
      async list() {
        await delay(80);
        return profiles.map((profile) => ({ ...profile }));
      },
      async create(username: string) {
        await delay(140);
        if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
          throw sdkError("account/local/invalid-username", "离线用户名须为 3–16 位字母、数字或下划线");
        }
        if (profiles.some((profile) => profile.username === username)) {
          throw sdkError("account/local/duplicate-username", `已存在同名离线档案 ${username}`);
        }
        const profile: LocalProfile = {
          schemaVersion: 1,
          id: `profile-${Date.now()}`,
          username,
          uuid: String(Date.now()).padStart(32, "0").slice(0, 32),
          createdEpochMs: BigInt(Date.now()),
        };
        profiles = [...profiles, profile];
        return { ...profile };
      },
      async rename(profileId: string, username: string) {
        await delay(120);
        if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
          throw sdkError("account/local/invalid-username", "离线用户名须为 3–16 位字母、数字或下划线");
        }
        if (profiles.some((profile) => profile.username === username && profile.id !== profileId)) {
          throw sdkError("account/local/duplicate-username", `已存在同名离线档案 ${username}`);
        }
        const target = profiles.find((profile) => profile.id === profileId);
        if (!target) throw sdkError("account/local/not-found", "离线档案不存在");
        const updated = { ...target, username };
        profiles = profiles.map((profile) => (profile.id === profileId ? updated : profile));
        return { ...updated };
      },
      async remove(profileId: string) {
        await delay(100);
        if (!profiles.some((profile) => profile.id === profileId)) {
          throw sdkError("account/local/not-found", "离线档案不存在");
        }
        profiles = profiles.filter((profile) => profile.id !== profileId);
      },
    },
    microsoft: {
      async status(): Promise<MicrosoftAccount | null> {
        await delay(80);
        return null;
      },
      async beginLogin(): Promise<LoginHandle> {
        await delay(120);
        return {
          loginId: `mock-login-${Date.now()}`,
          authorizationUrl: "https://example.invalid/mock-microsoft-login",
        };
      },
      async completeLogin(): Promise<TaskRecord> {
        const record = createTask("microsoft.login");
        setTimeout(() => transition(record.taskId, "running"), 250);
        setTimeout(() => {
          transition(record.taskId, "failed", {
            error: sdkError(
              "mock/not-supported",
              "模拟适配器不执行真实 Microsoft 登录；这不是账号或权益结果。",
            ),
          });
        }, 1200);
        return record;
      },
      async cancelLogin() {
        await delay(40);
      },
      async logout() {
        await delay(60);
      },
    },
    launch: {
      async preview(instanceId: string): Promise<LaunchPreview> {
        await delay(140);
        const instance = instances.find((candidate) => candidate.id === instanceId);
        if (!instance) {
          return {
            instanceId,
            ready: false,
            failureCode: "instance/not-found",
            failureMessage: `没有实例 ${instanceId}`,
            metadataId: null,
            requiredJavaMajor: null,
            selectedJava: null,
          };
        }
        if (instance.installation.state !== "ready") {
          return {
            instanceId,
            ready: false,
            failureCode: "launch/missing-metadata",
            failureMessage: `缺少版本元数据 ${instance.gameVersion}；不会自动下载或修复`,
            metadataId: null,
            requiredJavaMajor: null,
            selectedJava: null,
          };
        }
        return {
          instanceId,
          ready: true,
          failureCode: null,
          failureMessage: null,
          metadataId: instance.gameVersion,
          requiredJavaMajor: 21,
          selectedJava: { ...JAVA_RUNTIME },
        };
      },
      start: startLaunch,
    },
    tasks: {
      async list() {
        await delay(40);
        return [...tasks.values()]
          .sort((left, right) => right.updatedEpochMs - left.updatedEpochMs)
          .map((record) => ({ ...record }));
      },
      async status(taskId: string) {
        await delay(30);
        const record = tasks.get(taskId);
        if (!record) throw sdkError("task/not-found", `没有任务 ${taskId}`);
        return { ...record };
      },
    },
    logs: {
      async list() {
        await delay(60);
        return ["launch-demo.log"];
      },
      async read(name: string) {
        await delay(120);
        if (name !== "launch-demo.log") throw sdkError("log/io", `无法读取日志 ${name}`);
        return LOG_CONTENT;
      },
    },
    events: {
      async subscribeTaskUpdates(handler: (record: TaskRecord) => void) {
        subscribers.add(handler);
        return () => subscribers.delete(handler);
      },
    },
  };
}
