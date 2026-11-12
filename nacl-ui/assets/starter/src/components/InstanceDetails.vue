<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { InstanceConfig } from "../adapter/types";
import type { PageActions } from "../renderer/context";
import StatePanel from "./StatePanel.vue";
import { normalizedInstanceName } from "../state/instance-name";

const props = defineProps<{
  instance: InstanceConfig | null;
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
type NameDraft = { value: string; dirty: boolean; busy: boolean; message: string; error: boolean };
const drafts = reactive<Record<string, NameDraft>>({});
watch(() => props.instance, (instance) => {
  if (!instance) return;
  const draft = drafts[instance.id];
  if (!draft) drafts[instance.id] = { value: instance.name, dirty: false, busy: false, message: "", error: false };
  else if (!draft.dirty && !draft.busy) draft.value = instance.name;
}, { immediate: true });
async function rename(id: string, draft: NameDraft) {
  const name = normalizedInstanceName(draft.value);
  if (name === null) { draft.error = true; draft.message = "名称不能为空，最多 64 个 Unicode 字符，且不能包含控制字符。"; return; }
  if (!props.actions.rename) return;
  draft.busy = true; draft.message = "";
  try {
    const result = await props.actions.rename({ instanceId: id, name });
    draft.error = !result?.ok; draft.message = result?.ok ? "已保存" : result?.error?.message ?? "保存失败";
    if (result?.ok) { draft.value = name; draft.dirty = false; }
  } catch { draft.error = true; draft.message = "保存失败"; }
  finally { draft.busy = false; }
}
const compact = computed(() => props.params.compact === true);
const showPaths = computed(() => props.params.showPaths !== false);

const javaLabel = computed(() => {
  if (!props.instance) return "";
  return props.instance.java.mode === "auto"
    ? "自动检测"
    : props.instance.java.path;
});

async function refresh() {
  const action = props.actions.refresh;
  if (!action) return;
  busy.value = true;
  try {
    await action();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="instance-details" :class="{ compact }">
    <StatePanel
      v-if="!instance"
      tone="empty"
      title="未选择实例"
      detail="从实例列表选择一个实例后，这里显示已保存的配置。"
    />
    <template v-else>
      <div class="detail-heading">
        <div>
          <p class="eyebrow">已保存配置</p>
          <h3>{{ instance.name }}</h3>
        </div>
        <button
          v-if="actions.refresh"
          type="button"
          class="ghost-button"
          :disabled="busy"
          @click="refresh"
        >
          刷新
        </button>
      </div>
      <form v-if="actions.rename && drafts[instance.id]" @submit.prevent="rename(instance.id, drafts[instance.id])">
        <label>名称 <input v-model="drafts[instance.id].value" name="instanceName" type="text" :disabled="drafts[instance.id].busy" @input="drafts[instance.id].dirty = true; drafts[instance.id].message = ''" /></label>
        <button type="submit" class="primary-button" :disabled="drafts[instance.id].busy">{{ drafts[instance.id].busy ? '保存中…' : '保存名称' }}</button>
        <p v-if="drafts[instance.id].dirty" class="detail-note">有未保存修改</p>
        <p v-if="drafts[instance.id].message" :class="{ 'form-error': drafts[instance.id].error }" role="status">{{ drafts[instance.id].message }}</p>
      </form>
      <dl class="detail-grid">
        <template v-if="showPaths">
          <dt>实例标识</dt>
          <dd class="mono">{{ instance.id }}</dd>
          <dt>游戏目录</dt>
          <dd class="mono">{{ instance.gameDirectory }}</dd>
        </template>
        <dt>游戏版本</dt>
        <dd>{{ instance.gameVersion }}</dd>
        <dt>加载器</dt>
        <dd>
          {{ instance.loader.kind }}
          <span v-if="instance.loader.version"> · {{ instance.loader.version }}</span>
        </dd>
        <dt>安装状态</dt>
        <dd>
          <span
            class="state-chip"
            :class="instance.installation.state === 'ready' ? 'is-ready' : 'is-incomplete'"
          >
            {{ instance.installation.state === "ready" ? "已就绪" : "未就绪" }}
          </span>
        </dd>
        <dt>Java</dt>
        <dd class="mono">{{ javaLabel }}</dd>
        <dt>内存</dt>
        <dd>{{ instance.memory.minimumMb }} – {{ instance.memory.maximumMb }} MiB</dd>
        <dt>窗口</dt>
        <dd>
          {{ instance.display.width }}×{{ instance.display.height }} ·
          {{ instance.display.mode }}
        </dd>
        <dt>调试日志</dt>
        <dd>{{ instance.advanced.debugLogging ? "开启" : "关闭" }}</dd>
      </dl>
      <p class="detail-note">
        这些字段来自实例配置。缺失的元数据或客户端文件只会被报告，不会自动下载。
      </p>
    </template>
  </div>
</template>
