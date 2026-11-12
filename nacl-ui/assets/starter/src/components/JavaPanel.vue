<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { InstanceConfig, JavaRuntime } from "../adapter/types";
import { store } from "../state/store";
import type { PageActions } from "../renderer/context";
import StatePanel from "./StatePanel.vue";

const props = defineProps<{
  instance: InstanceConfig | null;
  detected: JavaRuntime[];
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
const autoFeedback = reactive<Record<string, { message: string; error: boolean }>>({});
const manualPath = ref("");
const inspectError = ref("");
const compact = computed(() => props.params.compact === true);
const allowManual = computed(
  () => props.params.allowManualPath !== false && Boolean(props.actions.inspect),
);

const currentPath = computed(() => {
  if (!props.instance) return null;
  return props.instance.java.mode === "auto" ? null : props.instance.java.path;
});

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

async function inspect() {
  inspectError.value = "";
  if (!manualPath.value.trim()) {
    inspectError.value = "请输入 Java 可执行文件路径";
    return;
  }
  const result = await invoke("inspect", { path: manualPath.value.trim() });
  if (!result?.ok) {
    inspectError.value = result?.error.message ?? "检查失败";
    return;
  }
  manualPath.value = "";
}

async function setRuntime(runtime: JavaRuntime) {
  const id = props.instance?.id;
  const result = await invoke("set", { runtime });
  if (result?.ok && id) delete autoFeedback[id];
}
async function setAuto(id: string) {
  if (!props.actions.auto) return;
  autoFeedback[id] = { message: "", error: false };
  try {
    const result = await invoke("auto", { instanceId: id });
    autoFeedback[id] = { message: result?.ok ? "已保存自动选择；实际可用性以启动检查为准。" : result?.error?.message ?? "保存失败", error: !result?.ok };
  } catch { autoFeedback[id] = { message: "保存失败", error: true }; }
}
</script>

<template>
  <div class="java-panel" :class="{ compact }">
    <StatePanel
      v-if="!instance"
      tone="empty"
      title="未选择实例"
      detail="选择实例后可查看所需 Java 与当前选择。"
    />
    <template v-else>
      <div class="java-current">
        <div>
          <p class="eyebrow">当前实例 Java</p>
          <p class="java-path mono">
            {{ currentPath ? (actions.auto ? `手动：${currentPath}` : currentPath) : "自动检测（按版本要求选择）" }}
          </p>
        </div>
        <button
          type="button"
          class="ghost-button"
          :disabled="busy"
          @click="invoke('detect')"
        >
          {{ busy ? "检测中…" : "重新检测" }}
        </button>
      </div>
      <button v-if="actions.auto && currentPath" type="button" class="ghost-button" :disabled="busy" @click="setAuto(instance.id)">恢复自动选择</button>
      <p v-if="autoFeedback[instance.id]?.message" :class="{ 'form-error': autoFeedback[instance.id].error }" role="status">{{ autoFeedback[instance.id].message }}</p>

      <StatePanel
        v-if="store.javaError"
        tone="error"
        :title="store.javaError.code"
        :detail="store.javaError.message"
      />
      <StatePanel
        v-else-if="detected.length === 0"
        tone="empty"
        title="没有发现 Java"
        detail="可检查已有 Java 路径；本应用不会隐式下载运行时。"
      />
      <ul v-else class="runtime-rows">
        <li v-for="runtime in detected" :key="runtime.path">
          <div class="runtime-row" :class="{ selected: runtime.path === currentPath }">
            <div class="runtime-copy">
              <span class="runtime-version">
                Java {{ runtime.majorVersion ?? "?" }}
                <span v-if="runtime.vendor" class="muted"> · {{ runtime.vendor }}</span>
              </span>
              <span class="runtime-path mono">{{ runtime.path }}</span>
            </div>
            <span v-if="runtime.path === currentPath" class="state-chip is-ready">当前</span>
            <button
              v-else
              type="button"
              class="tiny-button"
              :disabled="busy || !actions.set"
              @click="setRuntime(runtime)"
            >
              设为该实例 Java
            </button>
          </div>
        </li>
      </ul>

      <form v-if="allowManual" class="inline-form" @submit.prevent="inspect">
        <label>
          检查已有 Java 路径
          <input
            v-model="manualPath"
            type="text"
            placeholder="例如：C:\Java\bin\java.exe"
          />
        </label>
        <p v-if="inspectError" class="form-error" role="alert">{{ inspectError }}</p>
        <div class="form-actions">
          <button type="submit" class="primary-button" :disabled="busy">
            {{ busy ? "检查中…" : "检查路径" }}
          </button>
        </div>
      </form>
      <p class="detail-note">
        只使用本机已有 Java；版本不满足时启动检查会阻止启动并说明原因。
      </p>
    </template>
  </div>
</template>
