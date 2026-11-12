import type { NormalizedError, TaskRecord } from "../adapter/types";

/**
 * Re-entrant task-state reconciliation shared by every input path:
 * task-update events, task.list / task.status queries and command-returned
 * records (review S3-R1). All four sources flow through `ingest`, so a
 * terminal state found by a query recovers the same business state
 * (launch busy flag, last launch result, log refresh, login wait) as a
 * received event would.
 *
 * Invariants:
 *  - the event trail records only records delivered by task-update; query
 *    and command sources never fabricate event evidence;
 *  - a late queued/running record never overwrites a confirmed terminal
 *    state, and a terminal is applied at most once per session;
 *  - launch ownership is bound by the command response's taskId and nothing
 *    else (review R3-A/R3-B): between issuing `launch.start` and its
 *    response there is exactly one unconfirmed operation — early records
 *    are buffered (list and event trail stay live, launch effects wait) and
 *    a second launch is refused; once the response binds its taskId, the
 *    buffer is reconciled against that binding. `settle`/`abort` therefore
 *    cannot act on another operation's state, and a historical record is
 *    never mistaken for the current command by "first seen" or "newest
 *    known" heuristics;
 *  - business state never moves backwards (review R4): a terminal that is
 *    not owned by the current operation updates `launchLast` only when it
 *    is newer than the record that produced it, and no record clears a
 *    busy flag or interrupts a login wait that it does not own.
 */

export type TaskSource = "event" | "query" | "command";

export interface TaskEvent {
  taskId: string;
  kind: string;
  state: string;
  at: number;
}

/** The slice of the shell store this flow owns. The Vue store satisfies it
 * structurally; tests may pass a plain object. */
export interface TaskFlowView {
  tasks: TaskRecord[];
  taskEvents: TaskEvent[];
  launchBusy: boolean;
  launchLast: unknown;
  microsoft: {
    pendingTaskId: string | null;
    login: unknown;
    busy: boolean;
    error: NormalizedError | null;
  };
}

export interface TaskFlowHooks {
  refreshLogs(): void;
  refreshMicrosoft(): void;
}

const STATE_RANK: Record<string, number> = {
  queued: 0,
  running: 1,
  succeeded: 2,
  failed: 2,
  cancelled: 2,
};

function rank(state: string): number {
  return STATE_RANK[state] ?? 0;
}

function isTerminal(state: string): boolean {
  return rank(state) === 2;
}

/** One launch operation. `taskId === null` means the command is still in
 * flight (unconfirmed); the response binds the authoritative taskId. */
interface LaunchOperation {
  taskId: string | null;
}

export function createTaskFlow(view: TaskFlowView, hooks: TaskFlowHooks) {
  let operation: LaunchOperation | null = null;
  // Records that arrived while the operation was unconfirmed; reconciled
  // once the response binds, or replayed as unowned history on abort.
  let bufferedLaunch: TaskRecord[] = [];
  let loginCompleting = false;
  const appliedTerminal = new Set<string>();
  // The task that produced the current launchLast; unowned terminals may
  // only replace it when they are newer (review R4).
  let launchLastSource: {
    taskId: string;
    createdEpochMs: number;
    updatedEpochMs: number;
  } | null = null;

  /** Establishes a new launch operation before the command is issued.
   * Returns false when the previous command has not been confirmed yet —
   * the caller must refuse the launch instead of interleaving operations. */
  function beginLaunchOperation(): boolean {
    if (operation !== null) return false;
    operation = { taskId: null };
    view.launchBusy = true;
    return true;
  }

  /** Closes the operation after a rejected launch command: no taskId was
   * ever returned, so nothing can be claimed — buffered records are
   * replayed as unowned history and busy is released. */
  function abortLaunchOperation() {
    if (operation === null) return;
    operation = null;
    view.launchBusy = false;
    replayBufferedLaunchRecords();
  }

  function beginLoginCompletion() {
    loginCompleting = true;
  }

  function endLoginCompletion() {
    loginCompleting = false;
  }

  function isNewestOfKind(record: TaskRecord): boolean {
    for (const task of view.tasks) {
      if (task.kind !== record.kind) continue;
      if (
        task.createdEpochMs > record.createdEpochMs ||
        (task.createdEpochMs === record.createdEpochMs &&
          task.updatedEpochMs > record.updatedEpochMs)
      ) {
        return false;
      }
    }
    return true;
  }

  /** Whether a non-owned succeeded record may fill/advance launchLast: it
   * must be strictly newer than the record that produced it. */
  function advancesRecency(record: TaskRecord): boolean {
    if (launchLastSource === null) return true;
    return (
      record.createdEpochMs > launchLastSource.createdEpochMs ||
      (record.createdEpochMs === launchLastSource.createdEpochMs &&
        record.updatedEpochMs > launchLastSource.updatedEpochMs)
    );
  }

  /** List merge with anti-regression: keeps the newest information per task
   * unless it would un-finish a task that already reached a terminal state. */
  function upsert(record: TaskRecord): boolean {
    const index = view.tasks.findIndex((task) => task.taskId === record.taskId);
    if (index === -1) {
      view.tasks = [...view.tasks, record]
        .sort((left, right) => right.updatedEpochMs - left.updatedEpochMs)
        .slice(0, 50);
      return true;
    }
    if (rank(record.state) < rank(view.tasks[index].state)) return false;
    view.tasks = view.tasks.map((task, at) => (at === index ? record : task));
    return true;
  }

  function appendEventTrail(record: TaskRecord) {
    const last = view.taskEvents[view.taskEvents.length - 1];
    if (last && last.taskId === record.taskId && last.state === record.state) return;
    view.taskEvents = [
      ...view.taskEvents,
      {
        taskId: record.taskId,
        kind: record.kind,
        state: record.state,
        at: record.updatedEpochMs,
      },
    ].slice(-50);
  }

  function replayBufferedLaunchRecords() {
    const deferred = bufferedLaunch;
    bufferedLaunch = [];
    for (const record of deferred) applyLaunchEffects(record);
  }

  function applyLaunchEffects(record: TaskRecord) {
    if (record.kind !== "launch.start") return;
    if (!isTerminal(record.state)) {
      if (operation !== null) {
        // The open operation tracks its own task only; other tasks stay
        // list-only (already upserted) and never touch busy.
        return;
      }
      // No operation in flight: recover the observed in-progress launch
      // (reload/resubscribe recovery). The newest one is the live launch.
      if (isNewestOfKind(record)) {
        operation = { taskId: record.taskId };
        view.launchBusy = true;
      }
      return;
    }
    const owned = operation !== null && record.taskId === operation.taskId;
    if (owned) {
      view.launchBusy = false;
      // The association ends with the terminal; duplicates and late records
      // for the same task are history from here on.
      operation = null;
    }
    if (appliedTerminal.has(record.taskId)) return;
    appliedTerminal.add(record.taskId);
    if (record.state === "succeeded" && record.result) {
      // Owned terminals are this operation's outcome; unowned ones may only
      // fill/advance launchLast, never move it backwards (review R4).
      if (owned || advancesRecency(record)) {
        view.launchLast = record.result;
        launchLastSource = {
          taskId: record.taskId,
          createdEpochMs: record.createdEpochMs,
          updatedEpochMs: record.updatedEpochMs,
        };
      }
      if (owned) hooks.refreshLogs();
    }
  }

  function applyLoginEffects(record: TaskRecord, wasKnown: boolean) {
    if (record.kind !== "microsoft.login") return;
    if (!isTerminal(record.state)) {
      // Adopt the newest pending login as the one we are waiting for.
      if (isNewestOfKind(record) && view.microsoft.pendingTaskId !== record.taskId) {
        view.microsoft.pendingTaskId = record.taskId;
        view.microsoft.busy = true;
      } else if (isNewestOfKind(record) && !view.microsoft.busy) {
        view.microsoft.busy = true;
      }
      return;
    }
    const owned =
      record.taskId === view.microsoft.pendingTaskId ||
      ((loginCompleting || view.microsoft.busy) &&
        !wasKnown &&
        // A first-seen historical login must not clear the current wait.
        isNewestOfKind(record));
    if (appliedTerminal.has(record.taskId)) return;
    if (!owned) return;
    appliedTerminal.add(record.taskId);
    view.microsoft.pendingTaskId = null;
    view.microsoft.login = null;
    view.microsoft.busy = false;
    if (record.state === "succeeded") {
      hooks.refreshMicrosoft();
    } else if (record.error) {
      view.microsoft.error = record.error;
    }
  }

  /**
   * Folds one record into the state from any source. The task list and the
   * event trail update immediately; launch business effects wait for an
   * authoritative binding while the operation is unconfirmed.
   */
  function ingest(record: TaskRecord, source: TaskSource): void {
    const wasKnown = view.tasks.some((task) => task.taskId === record.taskId);
    if (source === "event") appendEventTrail(record);
    const accepted = upsert(record);
    const effective = accepted
      ? record
      : view.tasks.find((task) => task.taskId === record.taskId) ?? record;

    if (record.kind === "launch.start" && operation !== null && operation.taskId === null) {
      if (source === "command") {
        // The command response carries the authoritative taskId: bind it,
        // apply the response, then reconcile what arrived early.
        operation.taskId = record.taskId;
        applyLaunchEffects(effective);
        replayBufferedLaunchRecords();
      } else {
        // Unconfirmed window: effects deferred, list/trail already live.
        bufferedLaunch.push(effective);
      }
    } else {
      applyLaunchEffects(effective);
    }
    applyLoginEffects(effective, wasKnown);
  }

  /** List snapshots: fold oldest first so the newest task's effects land last. */
  function ingestMany(records: TaskRecord[], source: TaskSource): void {
    const ordered = [...records].sort(
      (left, right) =>
        left.createdEpochMs - right.createdEpochMs ||
        left.updatedEpochMs - right.updatedEpochMs,
    );
    for (const record of ordered) ingest(record, source);
  }

  return {
    ingest,
    ingestMany,
    beginLaunchOperation,
    abortLaunchOperation,
    beginLoginCompletion,
    endLoginCompletion,
  };
}
