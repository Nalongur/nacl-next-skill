<script setup lang="ts">
import { reactive, watch } from "vue";
import type { InstanceConfig } from "../adapter/types";
import type { PageActions } from "../renderer/context";
import StatePanel from "./StatePanel.vue";
import { validAdvancedArguments } from "../state/advanced-arguments";

const props = withDefaults(defineProps<{ instance: InstanceConfig | null; actions: PageActions; section?: "settings" | "advanced" }>(), { section: "settings" });
type Draft = { minimumMb: string; maximumMb: string; width: string; height: string; mode: string; jvmArguments: string; gameArguments: string; dirty: boolean; advancedDirty: boolean; busy: boolean; message: string; error: boolean; advancedMessage: string; advancedError: boolean };
const drafts = reactive<Record<string, Draft>>({});
function fromInstance(instance: InstanceConfig): Draft {
  return { minimumMb: String(instance.memory.minimumMb), maximumMb: String(instance.memory.maximumMb), width: String(instance.display.width), height: String(instance.display.height), mode: instance.display.mode, jvmArguments: instance.advanced.jvmArguments, gameArguments: instance.advanced.gameArguments, dirty: false, advancedDirty: false, busy: false, message: "", error: false, advancedMessage: "", advancedError: false };
}
watch(() => props.instance, (instance) => {
  if (instance && !drafts[instance.id]?.dirty && !drafts[instance.id]?.advancedDirty && !drafts[instance.id]?.busy) drafts[instance.id] = fromInstance(instance);
}, { immediate: true });
function changed(draft: Draft) { if (props.section === "advanced") { draft.advancedDirty = true; draft.advancedMessage = ""; } else { draft.dirty = true; draft.message = ""; } }
async function save(id: string, draft: Draft) {
  if (props.section === "advanced") {
    if (!validAdvancedArguments(draft.jvmArguments) || !validAdvancedArguments(draft.gameArguments)) {
      draft.advancedError = true; draft.advancedMessage = "每项最多 4096 个 UTF-8 字节，且不能包含控制字符。"; return;
    }
    if (!props.actions.saveAdvanced) return;
    draft.busy = true; draft.advancedMessage = "";
    try {
      const result = await props.actions.saveAdvanced({ instanceId: id, jvmArguments: draft.jvmArguments, gameArguments: draft.gameArguments });
      draft.advancedError = !result?.ok; draft.advancedMessage = result?.ok ? "已保存" : result?.error?.message ?? "保存失败";
      if (result?.ok) draft.advancedDirty = false;
    } finally { draft.busy = false; }
    return;
  }
  const minimumMb = Number(draft.minimumMb), maximumMb = Number(draft.maximumMb), width = Number(draft.width), height = Number(draft.height);
  if (![minimumMb, maximumMb, width, height].every(Number.isInteger) || minimumMb < 512 || maximumMb > 32768 || minimumMb > maximumMb || width < 854 || width > 7680 || height < 480 || height > 4320 || !["windowed", "maximized", "fullscreen"].includes(draft.mode)) {
    draft.error = true; draft.message = "内存须为 512–32768 MiB 且最小值不大于最大值；窗口宽 854–7680、高 480–4320。"; return;
  }
  if (!props.actions.save) return;
  draft.busy = true; draft.message = "";
  try {
    const result = await props.actions.save({ instanceId: id, minimumMb, maximumMb, width, height, mode: draft.mode });
    draft.error = !result?.ok;
    draft.message = result?.ok ? "已保存" : result?.error?.message ?? "保存失败";
    if (result?.ok) draft.dirty = false;
  } finally { draft.busy = false; }
}
</script>

<template>
  <div class="instance-settings">
    <StatePanel v-if="!instance" tone="empty" title="未选择实例" detail="选择实例后可编辑内存和窗口显示。" />
    <form v-else-if="drafts[instance.id]" @submit.prevent="save(instance.id, drafts[instance.id])">
      <p class="detail-note">编辑 {{ instance.name }}；切换实例时保留未保存草稿。</p>
      <fieldset v-if="section === 'settings'" class="settings-fields" :disabled="drafts[instance.id].busy">
        <label>最小内存（MiB）<input v-model="drafts[instance.id].minimumMb" name="minimumMb" type="number" :disabled="drafts[instance.id].busy" @input="changed(drafts[instance.id])" /></label>
        <label>最大内存（MiB）<input v-model="drafts[instance.id].maximumMb" name="maximumMb" type="number" :disabled="drafts[instance.id].busy" @input="changed(drafts[instance.id])" /></label>
        <label>窗口模式<select v-model="drafts[instance.id].mode" name="mode" :disabled="drafts[instance.id].busy" @change="changed(drafts[instance.id])"><option value="windowed">窗口</option><option value="maximized">最大化</option><option value="fullscreen">全屏</option></select></label>
        <label>窗口宽度<input v-model="drafts[instance.id].width" name="width" type="number" :disabled="drafts[instance.id].busy" @input="changed(drafts[instance.id])" /></label>
        <label>窗口高度<input v-model="drafts[instance.id].height" name="height" type="number" :disabled="drafts[instance.id].busy" @input="changed(drafts[instance.id])" /></label>
      </fieldset>
      <fieldset v-else class="settings-fields" :disabled="drafts[instance.id].busy">
        <label>附加 JVM 参数<textarea v-model="drafts[instance.id].jvmArguments" name="jvmArguments" rows="3" :disabled="drafts[instance.id].busy" @input="changed(drafts[instance.id])" /></label>
        <label>附加游戏参数<textarea v-model="drafts[instance.id].gameArguments" name="gameArguments" rows="3" :disabled="drafts[instance.id].busy" @input="changed(drafts[instance.id])" /></label>
      </fieldset>
      <p v-if="section === 'advanced'" class="detail-note">保存只校验长度和控制字符；参数格式在实际启动时解析，启动检查不验证引号。</p>
      <p v-if="section === 'advanced' ? drafts[instance.id].advancedDirty : drafts[instance.id].dirty" class="detail-note">有未保存修改</p>
      <p v-if="section === 'advanced' ? drafts[instance.id].advancedMessage : drafts[instance.id].message" :class="{ 'form-error': section === 'advanced' ? drafts[instance.id].advancedError : drafts[instance.id].error }" role="status">{{ section === 'advanced' ? drafts[instance.id].advancedMessage : drafts[instance.id].message }}</p>
      <button type="submit" class="primary-button" :disabled="drafts[instance.id].busy || !(section === 'advanced' ? actions.saveAdvanced : actions.save)">{{ drafts[instance.id].busy ? '保存中…' : '保存设置' }}</button>
    </form>
  </div>
</template>

<style scoped>
.settings-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; padding: 0; border: 0; }
.settings-fields label { display: grid; gap: 6px; }
.settings-fields input, .settings-fields select, .settings-fields textarea { width: 100%; min-width: 0; }
</style>
