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
} from "../../src/adapter/types";

/**
 * Scriptable adapter for the frontend behaviour regressions. The suite never
 * touches real accounts, files or processes; every task transition, list
 * result and subscription failure is declared by the test.
 */

export interface FakeAdapterOptions {
  mode?: "a" | "b" | "d";
  sdkVersion?: string;
  pageSchemaVersion?: number;
}

export interface FakeTaskControls {
  /** Sends a task-update to the subscribed handler (or records it as missed). */
  emit(record: TaskRecord): void;
  /** Drops a record on purpose: the terminal event is never delivered. */
  drop(record: TaskRecord): void;
  /** Results returned by task.list in order; the last one repeats. */
  queueTaskList(records: TaskRecord[]): void;
  setTaskStatus(record: TaskRecord): void;
  failNextTaskList(error: unknown): void;
}

export interface FakeLaunchControls {
  onLaunchStart: ((record: TaskRecord, emit: (r: TaskRecord) => void) => void) | null;
  onCompleteLogin: ((record: TaskRecord, emit: (r: TaskRecord) => void) => void) | null;
  /** When set, the next launch.start rejects with this error after invoking
   * onLaunchStart (so a raced-ahead terminal can be arranged first); the
   * value is consumed once. */
  failNextStart: unknown;
}

export interface FakeAdapter {
  adapter: LauncherAdapter;
  tasks: FakeTaskControls;
  launch: FakeLaunchControls;
  counts: {
    logsList: number;
    microsoftStatus: number;
    taskList: number;
    subscribe: number;
  };
  setSubscribeError(error: unknown): void;
  setMicrosoftAccount(account: MicrosoftAccount | null): void;
}

const BASE_TIME = 1_700_000_000_000;
let clock = 0;

export function nextTime(): number {
  clock += 1000;
  return BASE_TIME + clock;
}

export function makeTask(
  taskId: string,
  kind: string,
  state: TaskRecord["state"],
  patch: Partial<TaskRecord> = {},
): TaskRecord {
  const now = nextTime();
  return {
    taskId,
    kind,
    state,
    createdEpochMs: patch.createdEpochMs ?? now - 1000,
    updatedEpochMs: patch.updatedEpochMs ?? now,
    summary: `${kind} → ${state}`,
    error: null,
    result: null,
    ...patch,
  };
}

export const LAUNCH_RESULT = {
  instanceId: "instance-1",
  processId: 4242,
  logFile: "launch-demo.log",
  startedEpochMs: "1700000000000",
};

export const MICROSOFT_ACCOUNT: MicrosoftAccount = {
  schemaVersion: 1,
  clientId: "probe-client-id",
  minecraftId: "0123456789abcdef0123456789abcdef",
  minecraftName: "ProbeGamer",
  skins: [],
  capes: [],
  signedInEpochMs: BigInt(1_700_000_000_000),
};

function readyInstance(): InstanceConfig {
  return {
    schemaVersion: 2,
    id: "instance-1",
    name: "自有探针实例",
    gameVersion: "1.21.1-probe",
    loader: { kind: "vanilla", version: null, profileId: null },
    gameDirectory: "game",
    java: { mode: "custom", path: "C:\\Java\\bin\\java.exe" },
    memory: { minimumMb: 1024, maximumMb: 4096 },
    display: { mode: "windowed", width: 1280, height: 720 },
    advanced: { jvmArguments: "", gameArguments: "", debugLogging: false },
    installation: { state: "ready", installedEpochMs: null },
  };
}

const READY_PREVIEW: LaunchPreview = {
  instanceId: "instance-1",
  ready: true,
  failureCode: null,
  failureMessage: null,
  metadataId: "1.21.1-probe",
  requiredJavaMajor: 21,
  selectedJava: {
    path: "C:\\Java\\bin\\java.exe",
    home: "C:\\Java",
    version: "21.0.11",
    majorVersion: 21,
    architecture: "x86_64",
    vendor: "Probe",
    source: "mock",
    managed: false,
  },
};

const PROFILE: LocalProfile = {
  schemaVersion: 1,
  id: "profile-1",
  username: "Probe_01",
  uuid: "11111111111111111111111111111111",
  createdEpochMs: BigInt(1),
};

const LOGIN_HANDLE: LoginHandle = {
  loginId: "login-1",
  authorizationUrl: "https://example.invalid/probe",
};

export function createFakeAdapter(options: FakeAdapterOptions = {}): FakeAdapter {
  const mode = options.mode ?? "b";
  const sdkVersion = options.sdkVersion ?? "0.1.0";
  const pageSchemaVersion = options.pageSchemaVersion ?? 1;

  let handler: ((record: TaskRecord) => void) | null = null;
  let subscribeError: unknown = null;
  let taskListQueue: TaskRecord[][] = [];
  let lastTaskList: TaskRecord[] = [];
  const taskStatusResults = new Map<string, TaskRecord>();
  let failTaskList: unknown = null;
  let microsoftAccount: MicrosoftAccount | null = null;

  const launch: FakeLaunchControls = {
    onLaunchStart: null,
    onCompleteLogin: null,
    failNextStart: null,
  };

  const counts = { logsList: 0, microsoftStatus: 0, taskList: 0, subscribe: 0 };

  const emit = (record: TaskRecord) => {
    handler?.({ ...record });
  };

  let taskSequence = 0;
  const newTaskId = (kind: string) => {
    taskSequence += 1;
    return `probe-${kind}-${taskSequence}`;
  };

  const info: ProjectInfo = { mode, sdkVersion, shellVersion: sdkVersion, pageSchemaVersion };
  const capabilities: CapabilityDescriptor[] = [
    { namespace: "nacl-next", name: "instance.manage", contractVersion: 1, permissions: [] },
    { namespace: "nacl-next", name: "java.detect", contractVersion: 1, permissions: [] },
    { namespace: "nacl-next", name: "launch.game", contractVersion: 1, permissions: [] },
    { namespace: "nacl-next", name: "diagnostics.logs", contractVersion: 1, permissions: [] },
    ...(mode !== "a"
      ? [{ namespace: "nacl-next", name: "account.local", contractVersion: 1, permissions: [] }]
      : []),
    ...(mode !== "b"
      ? [{ namespace: "nacl-next", name: "account.microsoft", contractVersion: 1, permissions: [] }]
      : []),
  ];

  const adapter: LauncherAdapter = {
    kind: "mock",
    async projectInfo() {
      return info;
    },
    async capabilities() {
      return capabilities;
    },
    instances: {
      async list() {
        return [readyInstance()];
      },
      async listDeleted() {
        return [];
      },
      async create(_input: CreateInstanceInput) {
        return readyInstance();
      },
      async update(instance: InstanceConfig) {
        return instance;
      },
      async duplicate() {
        return readyInstance();
      },
      async remove() {},
      async restore() {
        return readyInstance();
      },
      async permanentlyDelete() {},
    },
    java: {
      async detect(): Promise<JavaRuntime[]> {
        return [];
      },
      async inspect(path: string) {
        return { ...READY_PREVIEW.selectedJava!, path };
      },
    },
    profiles: {
      async list() {
        return [{ ...PROFILE }];
      },
      async create() {
        return { ...PROFILE };
      },
      async rename(_id: string, username: string) {
        return { ...PROFILE, username };
      },
      async remove() {},
    },
    microsoft: {
      async status() {
        counts.microsoftStatus += 1;
        return microsoftAccount;
      },
      async beginLogin(): Promise<LoginHandle> {
        return { ...LOGIN_HANDLE };
      },
      async completeLogin(): Promise<TaskRecord> {
        const record = makeTask(newTaskId("microsoft.login"), "microsoft.login", "queued");
        launch.onCompleteLogin?.(record, emit);
        return { ...record };
      },
      async cancelLogin() {},
      async logout() {},
    },
    launch: {
      async preview(instanceId: string): Promise<LaunchPreview> {
        return { ...READY_PREVIEW, instanceId };
      },
      async start(_instanceId: string, _identity: IdentitySelection): Promise<TaskRecord> {
        const record = makeTask(newTaskId("launch.start"), "launch.start", "queued");
        launch.onLaunchStart?.(record, emit);
        if (launch.failNextStart) {
          const error = launch.failNextStart;
          launch.failNextStart = null;
          throw error;
        }
        return { ...record };
      },
    },
    tasks: {
      async list(): Promise<TaskRecord[]> {
        counts.taskList += 1;
        if (failTaskList) {
          const error = failTaskList;
          failTaskList = null;
          throw error;
        }
        const next = taskListQueue.shift();
        if (next) lastTaskList = next;
        return lastTaskList.map((record) => ({ ...record }));
      },
      async status(taskId: string): Promise<TaskRecord> {
        const record = taskStatusResults.get(taskId);
        if (!record) throw { code: "task/not-found", message: `没有任务 ${taskId}`, retryable: false };
        return { ...record };
      },
    },
    logs: {
      async list() {
        counts.logsList += 1;
        return ["launch-demo.log"];
      },
      async read(name: string) {
        return `[probe] ${name}`;
      },
    },
    events: {
      async subscribeTaskUpdates(callback: (record: TaskRecord) => void) {
        counts.subscribe += 1;
        if (subscribeError) throw subscribeError;
        handler = callback;
        return () => {
          handler = null;
        };
      },
    },
  };

  return {
    adapter,
    launch,
    counts,
    setSubscribeError(error) {
      subscribeError = error;
    },
    setMicrosoftAccount(account) {
      microsoftAccount = account;
    },
    tasks: {
      emit,
      drop() {
        // Intentional miss: the record exists on the backend but the handler
        // is never invoked with it.
      },
      queueTaskList(records) {
        taskListQueue = [records];
      },
      setTaskStatus(record) {
        taskStatusResults.set(record.taskId, record);
      },
      failNextTaskList(error) {
        failTaskList = error;
      },
    },
  };
}
