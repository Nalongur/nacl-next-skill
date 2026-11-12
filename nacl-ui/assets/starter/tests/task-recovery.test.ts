import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionOutcome, NormalizedError, TaskRecord } from "../src/adapter/types";
import { createActionController, type ActionController } from "../src/state/actions";
import { resetStore, store } from "../src/state/store";
import type { PageDefinition, ProjectConfig } from "../src/contract/page";
import {
  LAUNCH_RESULT,
  MICROSOFT_ACCOUNT,
  createFakeAdapter,
  makeTask,
  type FakeAdapter,
} from "./helpers/fake-adapter";

/**
 * Frontend behaviour regressions for task-state recovery (review S3-R1).
 *
 * Everything runs against the real action controller with an injected
 * scriptable adapter: no real accounts, backends or processes are involved.
 * These cases pin how business state (launch busy flag, last launch, logs,
 * login wait) recovers when task-update events are unavailable, missed,
 * early, duplicated or late.
 */

const project: ProjectConfig = {
  schemaVersion: 1,
  mode: "b",
  layout: "sidebar",
  adapter: "ipc",
  pageSchemaVersion: 1,
  sdk: { name: "nacl-next-sdk", version: "0.1.0", snapshotSha256: "0".repeat(64) },
  template: { version: 1, layout: "sidebar", mode: "b" },
  app: {
    productName: "Probe",
    identifier: "local.probe",
    window: { width: 1240, height: 820, minWidth: 980, minHeight: 660 },
  },
};

const page: PageDefinition = {
  schemaVersion: 1,
  mode: "b",
  layout: "sidebar",
  title: "Probe",
  theme: { accent: "#3b82f6", density: "comfortable", radius: 8, font: "system", colorScheme: "dark" },
  blocks: [],
};

let controller: ActionController | null = null;

async function boot(fake: FakeAdapter) {
  controller = createActionController(fake.adapter);
  const boot = await controller.bootstrap(project, page);
  expect(boot.ok).toBe(true);
  return controller;
}

async function selectLocalIdentity() {
  const outcome = await controller!.run("profiles.select", { id: "profile-1" });
  expect(outcome.ok).toBe(true);
}

async function startLaunch(): Promise<TaskRecord> {
  return assertOkTask(await controller!.run("launch.start"));
}

function launchTask(record: TaskRecord, state: TaskRecord["state"], patch: Partial<TaskRecord> = {}) {
  return makeTask(record.taskId, "launch.start", state, {
    createdEpochMs: record.createdEpochMs,
    ...patch,
  });
}

/** Unwraps a successful task action outcome (fails loudly otherwise). */
function assertOkTask(outcome: ActionOutcome): TaskRecord {
  if (!outcome.ok) throw new Error(`动作失败：${outcome.error.code} ${outcome.error.message}`);
  return outcome.value as TaskRecord;
}

/** Unwraps a failed action outcome (fails loudly otherwise). */
function assertFailure(outcome: ActionOutcome): NormalizedError {
  if (outcome.ok) throw new Error("动作应失败，但成功返回");
  return outcome.error;
}

async function drain() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  controller?.dispose();
  controller = null;
  vi.useRealTimers();
});

describe("task state recovery", () => {
  test("命令响应未返回时，首次见到的历史记录只入列表并保持忙碌", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fake.adapter.launch.start.bind(fake.adapter.launch);
    fake.adapter.launch.start = async (...args) => {
      const record = await original(...args);
      await gate;
      return record;
    };
    fake.launch.onLaunchStart = (record, emit) => {
      emit(makeTask("historical-done", "launch.start", "succeeded", {
        createdEpochMs: record.createdEpochMs - 10000,
        updatedEpochMs: record.createdEpochMs - 5000,
        result: { ...LAUNCH_RESULT, processId: 1111 },
      }));
    };
    const pending = controller!.run("launch.start");
    await drain();

    expect(store.launchBusy).toBe(true);
    expect(store.tasks.find((task) => task.taskId === "historical-done")?.state).toBe("succeeded");
    expect(store.taskEvents.map((event) => event.taskId)).toEqual(["historical-done"]);

    release();
    const outcome = assertOkTask(await pending);
    await drain();
    expect(store.launchBusy).toBe(true);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 1111 });

    fake.tasks.emit(makeTask("historical-running", "launch.start", "running", {
      createdEpochMs: outcome.createdEpochMs - 8000,
      updatedEpochMs: outcome.createdEpochMs - 6000,
    }));
    await drain();
    expect(store.launchBusy).toBe(true);
    expect(store.tasks.find((task) => task.taskId === "historical-running")?.state).toBe("running");

    fake.tasks.emit(launchTask(outcome, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
  });

  test("命令确认前禁止再次启动，迟到响应只收尾自身操作", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const original = fake.adapter.launch.start.bind(fake.adapter.launch);
    fake.adapter.launch.start = async (...args) => {
      const record = await original(...args);
      await gateA;
      return record;
    };
    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "succeeded", { result: LAUNCH_RESULT }));
    };
    const firstPending = controller!.run("launch.start");
    await drain();
    expect(store.launchBusy).toBe(true);

    const rejected = await controller!.run("launch.start");
    expect(rejected.ok).toBe(false);
    expect(assertFailure(rejected).code).toBe("launch/command-in-flight");
    expect(store.launchBusy).toBe(true);
    expect(store.tasks.filter((task) => task.kind === "launch.start")).toHaveLength(1);

    releaseA();
    expect((await firstPending).ok).toBe(true);
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);

    fake.launch.onLaunchStart = null;
    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    fake.adapter.launch.start = async (...args) => {
      const record = await original(...args);
      await gateB;
      return record;
    };
    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "succeeded", { result: { ...LAUNCH_RESULT, processId: 5252 } }));
    };
    const secondPending = controller!.run("launch.start");
    await drain();
    expect(store.launchBusy).toBe(true);

    releaseB();
    const second = assertOkTask(await secondPending);
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 5252 });
    expect(store.tasks.find((task) => task.taskId === second.taskId)?.state).toBe("succeeded");
  });

  test("上一命令迟到拒绝：缓冲记录按无归属规则收尾且下一次启动正常", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fake.adapter.launch.start.bind(fake.adapter.launch);
    fake.adapter.launch.start = async (...args) => {
      await original(...args);
      await gate;
      throw { code: "probe/late-reject", message: "响应迟到后拒绝", retryable: false };
    };
    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "succeeded", { result: { ...LAUNCH_RESULT, processId: 6363 } }));
    };
    const pending = controller!.run("launch.start");
    await drain();
    expect(store.launchBusy).toBe(true);

    const rejected = await controller!.run("launch.start");
    expect(rejected.ok).toBe(false);
    expect(assertFailure(rejected).code).toBe("launch/command-in-flight");
    expect(store.launchBusy).toBe(true);

    release();
    expect((await pending).ok).toBe(false);
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 6363 });

    fake.launch.onLaunchStart = null;
    fake.adapter.launch.start = original;
    const next = await startLaunch();
    fake.tasks.emit(launchTask(next, "succeeded", { result: { ...LAUNCH_RESULT, processId: 7373 } }));
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 7373 });
  });

  test("同会话第二次启动终态先于命令响应到达时仍清除忙碌", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    const first = await startLaunch();
    fake.tasks.emit(launchTask(first, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchBusy).toBe(false);

    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "succeeded", {
        result: { ...LAUNCH_RESULT, processId: 5252 },
      }));
    };
    const second = await startLaunch();
    expect(store.tasks.find((task) => task.taskId === second.taskId)?.state).toBe("succeeded");
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 5252 });
  });

  test("同会话第二次启动命令响应先到再收终态时正常结束", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    const first = await startLaunch();
    fake.tasks.emit(launchTask(first, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchBusy).toBe(false);

    const second = await startLaunch();
    expect(store.launchBusy).toBe(true);
    fake.tasks.emit(launchTask(second, "succeeded", {
      result: { ...LAUNCH_RESULT, processId: 5252 },
    }));
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 5252 });
  });

  test("同会话第二次启动终态先行为 failed 时解除忙碌且不覆盖最近启动", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    const first = await startLaunch();
    fake.tasks.emit(launchTask(first, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchLast).toEqual(LAUNCH_RESULT);

    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "failed", {
        error: { code: "launch/probe-failed", message: "探针启动失败", retryable: false },
      }));
    };
    await startLaunch();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
  });

  test("同会话第二次启动终态先行为 cancelled 时解除忙碌", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    const first = await startLaunch();
    fake.tasks.emit(launchTask(first, "succeeded", { result: LAUNCH_RESULT }));
    await drain();

    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "cancelled"));
    };
    await startLaunch();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
  });

  test("启动命令被拒绝后忙碌立即解除且下一次启动可正常认领", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    const first = await startLaunch();
    fake.tasks.emit(launchTask(first, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchBusy).toBe(false);

    fake.launch.failNextStart = { code: "probe/rejected", message: "命令被拒绝", retryable: false };
    const rejected = await controller!.run("launch.start");
    expect(rejected.ok).toBe(false);
    expect(store.launchBusy).toBe(false);

    const second = await startLaunch();
    fake.tasks.emit(launchTask(second, "succeeded", {
      result: { ...LAUNCH_RESULT, processId: 5252 },
    }));
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 5252 });
  });

  test("终态先被认领后命令拒绝不留下残留关联", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    const first = await startLaunch();
    fake.tasks.emit(launchTask(first, "succeeded", { result: LAUNCH_RESULT }));
    await drain();

    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "succeeded", {
        result: { ...LAUNCH_RESULT, processId: 5252 },
      }));
    };
    fake.launch.failNextStart = { code: "probe/rejected", message: "响应丢失", retryable: false };
    const rejected = await controller!.run("launch.start");
    expect(rejected.ok).toBe(false);
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 5252 });

    fake.launch.onLaunchStart = null;
    const third = await startLaunch();
    fake.tasks.emit(launchTask(third, "succeeded", {
      result: { ...LAUNCH_RESULT, processId: 7373 },
    }));
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 7373 });
  });

  test("首次经单任务查询迟到的旧成功任务不覆盖最近启动", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    const latest = await startLaunch();
    fake.tasks.emit(launchTask(latest, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchLast).toEqual(LAUNCH_RESULT);

    const old = makeTask("previously-unseen-old", "launch.start", "succeeded", {
      createdEpochMs: latest.createdEpochMs - 10000,
      updatedEpochMs: latest.createdEpochMs - 5000,
      result: { ...LAUNCH_RESULT, processId: 1111 },
    });
    fake.tasks.setTaskStatus(old);
    const outcome = await controller!.run("tasks.status", { taskId: old.taskId });
    expect(outcome.ok).toBe(true);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
    expect(store.tasks.find((task) => task.taskId === old.taskId)?.state).toBe("succeeded");
  });

  test("首次经事件迟到的旧成功任务不倒退最近启动且事件如实记录", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();
    const latest = await startLaunch();
    fake.tasks.emit(launchTask(latest, "succeeded", { result: LAUNCH_RESULT }));
    await drain();

    fake.tasks.emit(makeTask("late-old-event", "launch.start", "succeeded", {
      createdEpochMs: latest.createdEpochMs - 10000,
      updatedEpochMs: latest.createdEpochMs - 5000,
      result: { ...LAUNCH_RESULT, processId: 1111 },
    }));
    await drain();

    expect(store.launchLast).toEqual(LAUNCH_RESULT);
    expect(store.launchBusy).toBe(false);
    expect(store.taskEvents.at(-1)?.taskId).toBe("late-old-event");
  });

  test("忙碌期间列表查询补入旧终态任务不打断当前启动", async () => {
    const fake = createFakeAdapter();
    fake.tasks.queueTaskList([
      makeTask("old-launch-base", "launch.start", "succeeded", {
        result: { ...LAUNCH_RESULT, processId: 1111 },
      }),
    ]);
    await boot(fake);
    await selectLocalIdentity();
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 1111 });

    const queued = await startLaunch();
    expect(store.launchBusy).toBe(true);

    fake.tasks.queueTaskList([
      makeTask("mid-flight-old", "launch.start", "succeeded", {
        createdEpochMs: queued.createdEpochMs - 10000,
        updatedEpochMs: queued.createdEpochMs - 5000,
        result: { ...LAUNCH_RESULT, processId: 2222 },
      }),
      launchTask(queued, "running"),
    ]);
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.launchBusy).toBe(true);
    expect(store.launchLast).toEqual({ ...LAUNCH_RESULT, processId: 1111 });
    expect(store.tasks.find((task) => task.taskId === "mid-flight-old")?.state).toBe("succeeded");
    expect(store.tasks.find((task) => task.taskId === queued.taskId)?.state).toBe("running");

    fake.tasks.emit(launchTask(queued, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
  });

  test("首次迟到的旧登录终态不打断当前登录等待", async () => {
    const fake = createFakeAdapter();
    fake.setMicrosoftAccount(MICROSOFT_ACCOUNT);
    await boot(fake);

    await controller!.run("microsoft.login.begin");
    const record = assertOkTask(await controller!.run("microsoft.login.complete"));
    expect(store.microsoft.pendingTaskId).toBe(record.taskId);
    expect(store.microsoft.busy).toBe(true);

    fake.tasks.setTaskStatus(makeTask("old-login-1", "microsoft.login", "succeeded", {
      createdEpochMs: record.createdEpochMs - 10000,
      updatedEpochMs: record.createdEpochMs - 5000,
    }));
    await controller!.run("tasks.status", { taskId: "old-login-1" });

    expect(store.microsoft.pendingTaskId).toBe(record.taskId);
    expect(store.microsoft.busy).toBe(true);

    fake.tasks.emit(makeTask(record.taskId, "microsoft.login", "succeeded", {
      createdEpochMs: record.createdEpochMs,
    }));
    await drain();
    expect(store.microsoft.pendingTaskId).toBeNull();
    expect(store.microsoft.busy).toBe(false);
    expect(store.microsoft.account).toEqual(MICROSOFT_ACCOUNT);
  });

  test("订阅失败后，轮询查询到达成功终态并恢复启动忙碌与最近启动", async () => {
    const fake = createFakeAdapter();
    fake.setSubscribeError({ code: "ipc/subscribe-failed", message: "订阅通道不可用", retryable: true });
    await boot(fake);
    await selectLocalIdentity();

    expect(store.eventStatus).toBe("failed");
    expect(store.taskPolling).toBe(true);

    const queued = await startLaunch();
    expect(store.launchBusy).toBe(true);

    fake.tasks.queueTaskList([launchTask(queued, "running")]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.tasks.find((task) => task.taskId === queued.taskId)?.state).toBe("running");

    fake.tasks.queueTaskList([
      launchTask(queued, "succeeded", { result: LAUNCH_RESULT }),
    ]);
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
    expect(fake.counts.logsList).toBeGreaterThanOrEqual(2);
    expect(store.taskEvents).toEqual([]);
  });

  test("订阅失败后，查询到达登录成功终态并解除登录等待、刷新账号", async () => {
    const fake = createFakeAdapter();
    fake.setSubscribeError({ code: "ipc/subscribe-failed", message: "订阅通道不可用", retryable: true });
    fake.setMicrosoftAccount(MICROSOFT_ACCOUNT);
    await boot(fake);

    const begin = await controller!.run("microsoft.login.begin");
    expect(begin.ok).toBe(true);
    const record = assertOkTask(await controller!.run("microsoft.login.complete"));

    fake.tasks.queueTaskList([
      makeTask(record.taskId, "microsoft.login", "succeeded", {
        createdEpochMs: record.createdEpochMs,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.microsoft.pendingTaskId).toBeNull();
    expect(store.microsoft.login).toBeNull();
    expect(store.microsoft.busy).toBe(false);
    expect(store.microsoft.account).toEqual(MICROSOFT_ACCOUNT);
    expect(store.microsoft.status).toBe("signed-in");
  });

  test("查询到达登录失败终态时记录错误并结束等待", async () => {
    const fake = createFakeAdapter();
    fake.setSubscribeError({ code: "ipc/subscribe-failed", message: "订阅通道不可用", retryable: true });
    await boot(fake);

    await controller!.run("microsoft.login.begin");
    const record = assertOkTask(await controller!.run("microsoft.login.complete"));

    fake.tasks.queueTaskList([
      makeTask(record.taskId, "microsoft.login", "failed", {
        createdEpochMs: record.createdEpochMs,
        error: { code: "auth/microsoft/probe-failed", message: "探测登录失败", retryable: false },
      }),
    ]);
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.microsoft.pendingTaskId).toBeNull();
    expect(store.microsoft.login).toBeNull();
    expect(store.microsoft.busy).toBe(false);
    expect(store.microsoft.error?.code).toBe("auth/microsoft/probe-failed");
  });

  test("漏掉终态事件后，单任务查询恢复忙碌标记与最近启动", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();

    const queued = await startLaunch();
    fake.tasks.emit(launchTask(queued, "running"));

    const succeeded = launchTask(queued, "succeeded", { result: LAUNCH_RESULT });
    fake.tasks.drop(succeeded);
    fake.tasks.setTaskStatus(succeeded);
    const outcome = await controller!.run("tasks.status", { taskId: queued.taskId });
    expect(outcome.ok).toBe(true);
    await drain();

    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
    expect(store.tasks.find((task) => task.taskId === queued.taskId)?.state).toBe("succeeded");
    expect(store.taskEvents.map((event) => event.state)).toEqual(["running"]);
  });

  test("启动终态事件先于命令响应到达时不倒退任务状态", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();

    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "succeeded", { result: LAUNCH_RESULT }));
    };
    const queued = await startLaunch();

    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
    expect(store.tasks.find((task) => task.taskId === queued.taskId)?.state).toBe("succeeded");
  });

  test("登录终态事件先于命令响应到达时立即解除登录等待", async () => {
    const fake = createFakeAdapter();
    fake.setMicrosoftAccount(MICROSOFT_ACCOUNT);
    await boot(fake);

    await controller!.run("microsoft.login.begin");
    fake.launch.onCompleteLogin = (record, emit) => {
      emit(makeTask(record.taskId, "microsoft.login", "succeeded", {
        createdEpochMs: record.createdEpochMs,
      }));
    };
    const outcome = await controller!.run("microsoft.login.complete");
    expect(outcome.ok).toBe(true);
    await drain();

    expect(store.microsoft.pendingTaskId).toBeNull();
    expect(store.microsoft.login).toBeNull();
    expect(store.microsoft.busy).toBe(false);
    expect(store.microsoft.account).toEqual(MICROSOFT_ACCOUNT);
  });

  test("页面重载时运行中的启动任务恢复忙碌标记，随后正确结束", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();

    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "running"));
    };
    const queued = await startLaunch();
    const running = store.tasks.find((task) => task.taskId === queued.taskId)!;
    controller!.dispose();

    resetStore();
    fake.tasks.queueTaskList([running]);
    controller = createActionController(fake.adapter);
    const reloaded = await controller.bootstrap(project, page);
    expect(reloaded.ok).toBe(true);

    expect(store.launchBusy).toBe(true);
    expect(store.taskEvents).toEqual([]);

    fake.tasks.emit(launchTask(queued, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
    expect(store.taskEvents.map((event) => event.state)).toEqual(["succeeded"]);
  });

  test("迟到的 running 事件或查询不能覆盖已确认终态", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();

    const queued = await startLaunch();
    fake.tasks.emit(launchTask(queued, "running"));
    fake.tasks.emit(launchTask(queued, "succeeded", { result: LAUNCH_RESULT }));
    await drain();
    expect(store.launchBusy).toBe(false);

    const late = launchTask(queued, "running");
    fake.tasks.emit(late);
    fake.tasks.queueTaskList([late]);
    await vi.advanceTimersByTimeAsync(2000);

    expect(store.tasks.find((task) => task.taskId === queued.taskId)?.state).toBe("succeeded");
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
    expect(store.launchBusy).toBe(false);
  });

  test("重复终态不重复触发日志刷新副作用", async () => {
    const fake = createFakeAdapter();
    await boot(fake);
    await selectLocalIdentity();

    const queued = await startLaunch();
    const succeeded = launchTask(queued, "succeeded", { result: LAUNCH_RESULT });
    fake.tasks.emit(succeeded);
    await drain();
    const callsAfterFirst = fake.counts.logsList;

    fake.tasks.emit(succeeded);
    fake.tasks.queueTaskList([succeeded]);
    await vi.advanceTimersByTimeAsync(2000);

    expect(fake.counts.logsList).toBe(callsAfterFirst);
    expect(store.launchLast).toEqual(LAUNCH_RESULT);
  });

  test("无关旧任务的终态不覆盖当前启动，重载后恢复最近启动结果", async () => {
    const oldResult = { ...LAUNCH_RESULT, processId: 1111 };
    const fake = createFakeAdapter();
    fake.tasks.queueTaskList([
      makeTask("old-launch-1", "launch.start", "succeeded", { result: oldResult }),
    ]);
    await boot(fake);
    await selectLocalIdentity();

    expect(store.launchLast).toEqual(oldResult);

    fake.launch.onLaunchStart = (record, emit) => {
      emit(launchTask(record, "running"));
    };
    const queued = await startLaunch();
    expect(store.launchBusy).toBe(true);

    fake.tasks.queueTaskList([
      launchTask(queued, "running"),
      makeTask("old-launch-1", "launch.start", "succeeded", { result: oldResult }),
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.launchBusy).toBe(true);

    const newResult = { ...LAUNCH_RESULT, processId: 4242 };
    fake.tasks.emit(launchTask(queued, "succeeded", { result: newResult }));
    await drain();
    expect(store.launchBusy).toBe(false);
    expect(store.launchLast).toEqual(newResult);
  });

  test("订阅失败、查询失败与重新订阅均有明确可恢复状态", async () => {
    const fake = createFakeAdapter();
    fake.setSubscribeError({ code: "ipc/subscribe-failed", message: "订阅通道不可用", retryable: true });
    await boot(fake);
    await selectLocalIdentity();

    expect(store.eventStatus).toBe("failed");
    expect(store.eventsError ?? "").toContain("订阅通道不可用");
    expect(store.taskPolling).toBe(true);

    fake.tasks.failNextTaskList({ code: "task/list-failed", message: "查询失败", retryable: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.eventStatus).toBe("failed");

    fake.tasks.queueTaskList([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.eventStatus).toBe("failed");

    fake.setSubscribeError(null);
    const outcome = await controller!.run("tasks.resubscribe");
    expect(outcome.ok).toBe(true);
    expect(store.eventStatus).toBe("subscribed");
    expect(store.eventsError).toBeNull();
  });
});

test("selecting a newly created log makes it visible without a prior list refresh", async () => {
  const fake = createFakeAdapter();
  const actions = await boot(fake);
  store.logs = [];
  const outcome = await actions.run("logs.select", { name: "new.log" });
  expect(outcome.ok).toBe(true);
  expect(store.logs).toContain("new.log");
  expect(store.logContent).toBe("[probe] new.log");
});

test("failed log read returns a failure and preserves its diagnostic", async () => {
  const fake = createFakeAdapter();
  fake.adapter.logs.read = async () => { throw { code: "logs/missing", message: "missing", retryable: false }; };
  const actions = await boot(fake);
  const outcome = await actions.run("logs.select", { name: "missing.log" });
  expect(outcome.ok).toBe(false);
  expect(store.logError?.code).toBe("logs/missing");
});

test("instance settings preserve untouched fields and reject a stale selection", async () => {
  const fake = createFakeAdapter();
  const update = vi.spyOn(fake.adapter.instances, "update");
  const actions = await boot(fake);
  const before = store.instances[0];
  const values = { instanceId: before.id, minimumMb: 2048, maximumMb: 6144, mode: "windowed", width: 1600, height: 900 };
  const result = await actions.run("instances.update-settings", values);
  expect(result.ok).toBe(true);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: before.id, java: before.java, advanced: before.advanced, loader: before.loader, memory: { minimumMb: 2048, maximumMb: 6144 }, display: { mode: "windowed", width: 1600, height: 900 } }));
  update.mockClear();
  store.selectedInstanceId = null;
  const stale = await actions.run("instances.update-settings", values);
  expect(stale.ok).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

test.each(["settings", "java"])("rejects overlapping full-instance updates while %s save is pending", async (first) => {
  const fake = createFakeAdapter();
  let finish!: (instance: any) => void;
  vi.spyOn(fake.adapter.instances, "update").mockImplementation((instance) => new Promise((resolve) => { finish = () => resolve(instance); }));
  const actions = await boot(fake);
  const current = store.instances[0];
  const settings = { instanceId: current.id, minimumMb: 2048, maximumMb: 6144, mode: "windowed", width: 1600, height: 900 };
  const runtime = await fake.adapter.java.inspect("C:\\probe-java.exe");
  const pending = first === "settings" ? actions.run("instances.update-settings", settings) : actions.run("instances.update-java", { runtime });
  const other = first === "settings" ? await actions.run("instances.update-java", { runtime }) : await actions.run("instances.update-settings", settings);
  expect(other.ok).toBe(false);
  finish(null);
  expect((await pending).ok).toBe(true);
});

test("stale instance refresh cannot overwrite a later settings save", async () => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const before = store.instances[0];
  let finish!: (value: any) => void;
  vi.spyOn(fake.adapter.instances, "list").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const refreshing = actions.run("instances.refresh");
  const saved = await actions.run("instances.update-settings", { instanceId: before.id, minimumMb: 2048, maximumMb: 6144, mode: "windowed", width: 1600, height: 900 });
  expect(saved.ok).toBe(true); finish([before]); await refreshing;
  expect(store.instances[0].memory.maximumMb).toBe(6144);
});
test("refuses to delete an instance while its settings save is pending", async () => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const before = store.instances[0];
  let finish!: () => void;
  vi.spyOn(fake.adapter.instances, "update").mockImplementation((instance) => new Promise((resolve) => { finish = () => resolve(instance); }));
  const remove = vi.spyOn(fake.adapter.instances, "remove");
  const pending = actions.run("instances.update-settings", { instanceId: before.id, minimumMb: 2048, maximumMb: 6144, mode: "windowed", width: 1600, height: 900 });
  expect((await actions.run("instances.delete", { id: before.id })).ok).toBe(false); expect(remove).not.toHaveBeenCalled();
  finish(); expect((await pending).ok).toBe(true);
});

test("stale failed refresh does not hide a successfully saved instance", async () => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const before = store.instances[0];
  let fail!: (error: unknown) => void;
  vi.spyOn(fake.adapter.instances, "list").mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
  const refreshing = actions.run("instances.refresh");
  expect((await actions.run("instances.update-settings", { instanceId: before.id, minimumMb: 2048, maximumMb: 6144, mode: "windowed", width: 1600, height: 900 })).ok).toBe(true);
  fail({ code: "probe/stale", message: "stale", retryable: false }); await refreshing;
  expect(store.instancesError).toBeNull(); expect(store.instances[0].memory.maximumMb).toBe(6144);
});

test("instance creation refresh retries after another instance is saved", async () => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const before = store.instances[0];
  const created = { ...before, id: "new-instance", name: "New" };
  vi.spyOn(fake.adapter.instances, "create").mockResolvedValue(created);
  let finish!: (value: any) => void;
  vi.spyOn(fake.adapter.instances, "list")
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockImplementation(async () => [...store.instances, created]);
  const creating = actions.run("instances.create", { name: "New", gameVersion: "1.21.1-probe" });
  await Promise.resolve();
  store.selectedInstanceId = before.id;
  expect((await actions.run("instances.update-settings", { instanceId: before.id, minimumMb: 2048, maximumMb: 6144, mode: "windowed", width: 1600, height: 900 })).ok).toBe(true);
  finish([before, created]);
  expect((await creating).ok).toBe(true);
  expect(store.selectedInstanceId).toBe(before.id);
  expect(store.instances.some((item) => item.id === created.id)).toBe(true);
  expect(store.instances.find((item) => item.id === before.id)?.memory.maximumMb).toBe(6144);
});

test("older refresh cannot erase an instance created afterward", async () => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const before = store.instances[0];
  const created = { ...before, id: "new-instance", name: "New" };
  vi.spyOn(fake.adapter.instances, "create").mockResolvedValue(created);
  let finish!: (value: any) => void;
  vi.spyOn(fake.adapter.instances, "list")
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue([before, created]);
  const oldRefresh = actions.run("instances.refresh");
  expect((await actions.run("instances.create", { name: "New", gameVersion: "probe" })).ok).toBe(true);
  finish([before]); await oldRefresh;
  expect(store.instances.some((item) => item.id === created.id)).toBe(true);
  expect(store.selectedInstanceId).toBe(created.id);
});
test("creation followed by a failed refresh preserves the new item and reports it was created", async () => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const before = store.instances[0];
  const created = { ...before, id: "new-instance", name: "New" };
  vi.spyOn(fake.adapter.instances, "create").mockResolvedValue(created);
  vi.spyOn(fake.adapter.instances, "list").mockRejectedValue({ code: "probe/list", message: "list failed", retryable: true });
  const result = await actions.run("instances.create", { name: "New", gameVersion: "probe" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toContain("已创建");
  expect(store.instances.some((item) => item.id === created.id)).toBe(true);
  expect(store.instancesError).toBeNull();
});

test("delete reports a failed recycle-bin refresh after the instance was moved", async () => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const before = store.instances[0];
  const sentinel = { ...before, id: "deleted-sentinel" }; store.deletedInstances = [sentinel];
  vi.spyOn(fake.adapter.instances, "listDeleted").mockRejectedValue({ code: "probe/deleted", message: "unavailable", retryable: true });
  const result = await actions.run("instances.delete", { id: before.id });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toContain("已移入回收站");
  expect(store.deletedInstances.map((item) => item.id)).toContain(sentinel.id);
});

test("advanced save changes only the two parameter fields and rejects invalid input", async () => {
  const fake = createFakeAdapter(); const update = vi.spyOn(fake.adapter.instances, "update");
  const actions = await boot(fake); const before = store.instances[0];
  const result = await actions.run("instances.update-advanced", { instanceId: before.id, jvmArguments: '-Dgreeting="你好"', gameArguments: "--demo" });
  expect(result.ok).toBe(true);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: before.id, java: before.java, memory: before.memory, display: before.display, advanced: { ...before.advanced, jvmArguments: '-Dgreeting="你好"', gameArguments: "--demo" } }));
  update.mockClear();
  expect((await actions.run("instances.update-advanced", { instanceId: before.id, jvmArguments: "你".repeat(1366), gameArguments: "" })).ok).toBe(false);
  expect((await actions.run("instances.update-advanced", { instanceId: before.id, jvmArguments: "", gameArguments: "bad\nvalue" })).ok).toBe(false);
  expect(update).not.toHaveBeenCalled();
});

test.each([["advanced", "java"], ["java", "advanced"], ["advanced", "settings"], ["settings", "advanced"]])("rejects overlapping %s and %s instance writes", async (first, second) => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const before = store.instances[0];
  let finish!: () => void;
  const update = vi.spyOn(fake.adapter.instances, "update").mockImplementationOnce((instance) => new Promise((resolve) => { finish = () => resolve(instance); }));
  const runtime = await fake.adapter.java.inspect("C:\\probe-java.exe");
  const invoke = (kind: string) => kind === "java" ? actions.run("instances.update-java", { runtime }) : kind === "settings" ? actions.run("instances.update-settings", { instanceId: before.id, minimumMb: 2048, maximumMb: 6144, mode: "windowed", width: 1600, height: 900 }) : actions.run("instances.update-advanced", { instanceId: before.id, jvmArguments: "-Dprobe=true", gameArguments: "--demo" });
  const pending = invoke(first); const rejected = await invoke(second); expect(rejected.ok).toBe(false);
  finish(); expect((await pending).ok).toBe(true); expect((await invoke(second)).ok).toBe(true);
  expect(update).toHaveBeenCalledTimes(2);
  const latest = store.instances.find((item) => item.id === before.id)!;
  expect(latest.advanced.jvmArguments).toBe("-Dprobe=true");
  if ([first, second].includes("java")) expect(latest.java).toEqual({ mode: "custom", path: runtime.path });
  else expect(latest.memory.maximumMb).toBe(6144);
});
test("rename updates only name, validates Unicode, and refuses stale selection", async () => {
  const fake=createFakeAdapter(); const update=vi.spyOn(fake.adapter.instances,"update"); const actions=await boot(fake);const before=store.instances[0];
  expect((await actions.run("instances.rename",{instanceId:before.id,name:"  名😀  "})).ok).toBe(true);
  expect(update).toHaveBeenCalledWith({...before,name:"名😀"});update.mockClear();
  for (const name of [" ","😀".repeat(65),"a\u0001b"]) expect((await actions.run("instances.rename",{instanceId:before.id,name})).ok).toBe(false);
  store.selectedInstanceId=null;expect((await actions.run("instances.rename",{instanceId:before.id,name:"新"})).ok).toBe(false);expect(update).not.toHaveBeenCalled();
});
test.each(["rename","settings"])("same instance rename and settings cannot overlap (%s first)",async (first)=>{
  const fake=createFakeAdapter();const actions=await boot(fake);const before=store.instances[0];let finish!:()=>void;
  vi.spyOn(fake.adapter.instances,"update").mockImplementationOnce(instance=>new Promise(resolve=>{finish=()=>resolve(instance)}));
  const rename=()=>actions.run("instances.rename",{instanceId:before.id,name:"新名称"});
  const settings=()=>actions.run("instances.update-settings",{instanceId:before.id,minimumMb:2048,maximumMb:6144,mode:"windowed",width:1600,height:900});
  const pending=first==="rename"?rename():settings();expect((await (first==="rename"?settings():rename())).ok).toBe(false);finish();expect((await pending).ok).toBe(true);expect((await (first==="rename"?settings():rename())).ok).toBe(true);
  const saved=store.instances.find(x=>x.id===before.id)!;expect(saved.name).toBe("新名称");expect(saved.memory.maximumMb).toBe(6144);expect(saved.gameDirectory).toBe(before.gameDirectory);expect(saved.advanced).toEqual(before.advanced);
});
test("switching a manual Java selection to auto preserves the instance", async () => {
  const fake = createFakeAdapter(); const actions = await boot(fake); const original = store.instances[0];
  const manual = { ...original, java: { mode: "custom" as const, path: "C:\\Java\\bin\\java.exe" } };
  store.instances = [manual, ...store.instances.slice(1)];
  const update = vi.spyOn(fake.adapter.instances, "update");
  const result = await actions.run("instances.java-auto", { instanceId: manual.id });
  expect(result.ok).toBe(true);
  expect(update).toHaveBeenCalledWith({ ...manual, java: { mode: "auto" } });
});
test("auto Java refuses stale selection and leaves a failed write unchanged", async () => {
  const fake=createFakeAdapter();const actions=await boot(fake);const before=store.instances[0];
  const update=vi.spyOn(fake.adapter.instances,"update").mockRejectedValueOnce(new Error("disk failure"));
  expect((await actions.run("instances.java-auto",{instanceId:before.id})).ok).toBe(false);expect(store.instances[0]).toEqual(before);
  update.mockClear();store.selectedInstanceId=null;expect((await actions.run("instances.java-auto",{instanceId:before.id})).ok).toBe(false);expect(update).not.toHaveBeenCalled();
});
test.each([["auto","rename"],["rename","auto"],["auto","settings"],["settings","auto"],["auto","advanced"],["advanced","auto"]])("rejects overlapping %s and %s instance writes",async(first,second)=>{
  const fake=createFakeAdapter();const actions=await boot(fake);const before=store.instances[0];let finish!:()=>void;
  vi.spyOn(fake.adapter.instances,"update").mockImplementationOnce(instance=>new Promise(resolve=>{finish=()=>resolve(instance)}));
  const invoke=(kind:string)=>kind==="auto"?actions.run("instances.java-auto",{instanceId:before.id}):kind==="rename"?actions.run("instances.rename",{instanceId:before.id,name:"新名称"}):kind==="settings"?actions.run("instances.update-settings",{instanceId:before.id,minimumMb:2048,maximumMb:6144,mode:"windowed",width:1600,height:900}):actions.run("instances.update-advanced",{instanceId:before.id,jvmArguments:"-Dtest=1",gameArguments:"--demo"});
  const pending=invoke(first);expect((await invoke(second)).ok).toBe(false);finish();expect((await pending).ok).toBe(true);expect((await invoke(second)).ok).toBe(true);
  const saved=store.instances.find(x=>x.id===before.id)!;expect(saved.java).toEqual({mode:"auto"});expect(saved.gameDirectory).toBe(before.gameDirectory);expect(saved.loader).toEqual(before.loader);
  if ([first,second].includes("rename")) expect(saved.name).toBe("新名称");
  if ([first,second].includes("settings")) expect(saved.memory.maximumMb).toBe(6144);
  if ([first,second].includes("advanced")) expect(saved.advanced.jvmArguments).toBe("-Dtest=1");
});
test("an old refresh cannot undo saved auto Java",async()=>{
  const fake=createFakeAdapter();const actions=await boot(fake);const before=store.instances[0];
  const manual={...before,java:{mode:"custom" as const,path:"C:\\Java\\bin\\java.exe"}};store.instances=[manual,...store.instances.slice(1)];let finish!:(x:any)=>void;
  vi.spyOn(fake.adapter.instances,"list").mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const refreshing=actions.run("instances.refresh");expect((await actions.run("instances.java-auto",{instanceId:manual.id})).ok).toBe(true);finish([manual]);await refreshing;
  expect(store.instances[0].java).toEqual({mode:"auto"});
});
test("missing host preferences capability is local and does not hide unrelated errors", async()=>{
 const fake=createFakeAdapter();const actions=await boot(fake);const unrelated={code:"probe/error",message:"其他错误",retryable:false};store.globalError=unrelated;
 const result=await actions.run("host.preferences.get");expect(result.ok).toBe(false);if(!result.ok) expect(result.error.code).toBe("preferences/unavailable");expect(store.globalError).toEqual(unrelated);
});
