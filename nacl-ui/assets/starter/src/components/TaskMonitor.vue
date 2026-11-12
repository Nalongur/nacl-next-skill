<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { TaskRecord } from "../adapter/types";
import { store } from "../state/store";
import { formatTime, taskStateLabel } from "../renderer/labels";
import type { PageActions, SubscriptionState } from "../renderer/context";
import StatePanel from "./StatePanel.vue";

const props = defineProps<{
  tasks: TaskRecord[];
  subscription: SubscriptionState;
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const compact = computed(() => props.params.compact === true);
const maxItems = computed(() =>
  typeof props.params.maxItems === "number" ? props.params.maxItems : 8,
);
const visibleTasks = computed(() => props.tasks.slice(0, maxItems.value));
const showSubscription = computed(() => props.params.showSubscription !== false);

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer);
});

function elapsed(task: TaskRecord): string {
  const end =
    task.state === "queued" || task.state === "running"
      ? now.value
      : task.updatedEpochMs;
  const milliseconds = Math.max(0, end - task.createdEpochMs);
  return milliseconds < 1000
    ? `${milliseconds}ms`
    : `${(milliseconds / 1000).toFixed(1)}s`;
}

/** Event trail proves which task-update transitions the webview received. */
function trail(taskId: string) {
  return store.taskEvents.filter((event) => event.taskId === taskId).slice(-6);
}

function kindLabel(kind: string): string {
  return kind === "launch.start" ? "启动任务" : kind === "microsoft.login" ? "Microsoft 登录" : kind;
}

function resultInfo(task: TaskRecord): { processId?: number; logFile?: string } | null {
  if (!task.result || typeof task.result !== "object") return null;
  const result = task.result as { processId?: unknown; logFile?: unknown };
  return {
    processId: typeof result.processId === "number" ? result.processId : undefined,
    logFile: typeof result.logFile === "string" ? result.logFile : undefined,
  };
}

async function invoke(key: string, payload: Record<string, unknown> = {}) {
  const action = props.actions[key];
  if (!action) return undefined;
  busy.value = true;
  try {
    return await action(payload);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="task-monitor" :class="{ compact }">
    <div class="block-toolbar">
      <span class="count-label">{{ tasks.length }} 个任务</span>
      <div class="toolbar-actions">
        <span
          v-if="showSubscription"
          class="subscription-chip"
          :class="`is-${subscription.status}`"
        >
          {{ subscription.status === "subscribed" ? "事件已连接" : subscription.status === "failed" ? "事件失败 · 轮询" : "等待事件" }}
        </span>
        <button
          v-if="subscription.status === 'failed' && actions.resubscribe"
          type="button"
          class="ghost-button"
          :disabled="busy"
          @click="invoke('resubscribe')"
        >
          重新订阅
        </button>
        <button
          type="button"
          class="ghost-button"
          :disabled="busy"
          @click="invoke('refresh')"
        >
          刷新
        </button>
      </div>
    </div>

    <p v-if="subscription.status === 'failed'" class="form-error" role="alert">
      task-update 订阅失败：{{ subscription.error ?? "未知原因" }}。已改用状态查询恢复；
      终态与后端记录保持一致。
    </p>

    <StatePanel
      v-if="tasks.length === 0"
      tone="empty"
      title="还没有任务"
      detail="后台任务和启动进度会显示在这里。"
    />
    <ul v-else class="task-rows">
      <li v-for="task in visibleTasks" :key="task.taskId" class="task-card">
        <div class="task-head">
          <span class="state-chip" :class="`is-${task.state}`">
            {{ taskStateLabel(task.state) }}
          </span>
          <span class="task-kind">{{ kindLabel(task.kind) }}</span>
          <span class="task-time mono">{{ formatTime(task.createdEpochMs) }}</span>
          <span class="task-elapsed mono">{{ elapsed(task) }}</span>
        </div>

        <div
          v-if="task.state === 'queued' || task.state === 'running'"
          class="task-progress"
          role="progressbar"
          :aria-label="taskStateLabel(task.state)"
        >
          <span class="task-progress-bar" :class="`is-${task.state}`"></span>
        </div>

        <ol v-if="trail(task.taskId).length > 0" class="task-trail" aria-label="任务事件">
          <li
            v-for="(event, index) in trail(task.taskId)"
            :key="`${event.state}-${index}`"
            class="task-trail-item"
            :class="`is-${event.state}`"
          >
            <span class="task-trail-dot" aria-hidden="true"></span>
            <span>{{ taskStateLabel(event.state) }}</span>
            <time class="mono">{{ formatTime(event.at) }}</time>
          </li>
        </ol>
        <p v-else class="task-trail-empty muted">状态由 task.list 查询恢复</p>

        <div class="task-body">
          <p class="task-id mono">{{ task.taskId }}</p>
          <p v-if="task.summary" class="muted">{{ task.summary }}</p>
          <div v-if="task.error" class="task-error">
            <strong>{{ task.error.code }}</strong>
            <p>{{ task.error.message }}</p>
            <span v-if="task.error.retryable" class="muted">可重试</span>
          </div>
          <div v-if="resultInfo(task)" class="task-result">
            <span v-if="resultInfo(task)?.processId">
              PID <span class="mono">{{ resultInfo(task)?.processId }}</span>
            </span>
            <span v-if="resultInfo(task)?.logFile" class="mono">
              {{ resultInfo(task)?.logFile }}
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
