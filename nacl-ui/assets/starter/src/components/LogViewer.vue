<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { NormalizedError } from "../adapter/types";
import type { PageActions } from "../renderer/context";
import StatePanel from "./StatePanel.vue";

const props = defineProps<{
  items: string[];
  selected: string | null;
  content: string;
  loading: boolean;
  error: NormalizedError | null;
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
const compact = computed(() => props.params.compact === true);
const autoLoadFirst = computed(() => props.params.autoLoadFirst === true);
const visibleLines = computed(() =>
  typeof props.params.visibleLines === "number" ? props.params.visibleLines : 120,
);

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

async function open(name: string) {
  await invoke(props.actions.select ? "select" : "read", { name });
}

watch(
  () => [props.items, props.selected] as const,
  ([items, selected]) => {
    if (autoLoadFirst.value && !selected && items.length > 0) {
      void open(items[0]);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="log-viewer" :class="{ compact }">
    <div class="block-toolbar">
      <span class="count-label">{{ items.length }} 个日志</span>
      <div class="toolbar-actions">
        <button
          type="button"
          class="ghost-button"
          :disabled="busy || loading"
          @click="invoke('refresh')"
        >
          {{ loading ? "刷新中…" : "刷新日志" }}
        </button>
      </div>
    </div>

    <StatePanel
      v-if="error"
      tone="error"
      :title="error.code"
      :detail="error.message"
    >
      <button type="button" class="ghost-button" @click="invoke('refresh')">
        重试
      </button>
    </StatePanel>
    <StatePanel
      v-else-if="items.length === 0"
      tone="empty"
      title="还没有日志"
      detail="启动实例后会在这里列出启动与游戏日志；不会伪造样例输出。"
    />
    <div v-else class="log-split">
      <ul class="log-list" aria-label="日志文件">
        <li v-for="name in items" :key="name">
          <button
            type="button"
            class="log-item"
            :class="{ selected: name === selected }"
            :aria-pressed="name === selected"
            @click="open(name)"
          >
            <span class="log-name mono">{{ name }}</span>
          </button>
        </li>
      </ul>
      <div class="log-content">
        <div class="log-content-head">
          <span class="mono">{{ selected ?? "未选择日志" }}</span>
          <span class="muted">{{ content.length }} 字节</span>
        </div>
        <StatePanel
          v-if="loading && !content"
          tone="loading"
          title="正在读取日志"
        />
        <StatePanel
          v-else-if="selected && content.length === 0"
          tone="empty"
          title="日志为空"
          detail="文件存在但没有可显示内容。"
        />
        <StatePanel
          v-else-if="!selected"
          tone="empty"
          title="选择左侧日志查看内容"
        />
        <pre
          v-else
          class="log-text mono"
          :style="{ '--log-lines': String(visibleLines) }"
        >{{ content }}</pre>
      </div>
    </div>
  </div>
</template>
