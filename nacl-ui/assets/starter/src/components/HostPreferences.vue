<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import type { PageActions } from "../renderer/context";
const props = defineProps<{ actions: PageActions }>();
const draft = reactive({ defaultMemoryMb: "", defaultWindowWidth: "", defaultWindowHeight: "" });
const busy = ref(false), loaded = ref(false), dirty = ref(false), message = ref(""), error = ref(false);
async function load() {
  if (!props.actions.load) { error.value = true; message.value = "偏好设置能力不可用"; return; }
  busy.value = true; message.value = "";
  try {
    const result = await props.actions.load();
    if (!result?.ok) { error.value = true; message.value = result?.error?.message ?? "读取失败"; return; }
    const value = result.value as { defaultMemoryMb: number; defaultWindowWidth: number; defaultWindowHeight: number };
    draft.defaultMemoryMb = String(value.defaultMemoryMb); draft.defaultWindowWidth = String(value.defaultWindowWidth); draft.defaultWindowHeight = String(value.defaultWindowHeight);
    loaded.value = true; dirty.value = false; error.value = false;
  } catch { error.value = true; message.value = "读取失败"; }
  finally { busy.value = false; }
}
async function save() {
  const values = [draft.defaultMemoryMb, draft.defaultWindowWidth, draft.defaultWindowHeight];
  const [memory, width, height] = values.map(Number);
  if (!values.every(v => /^\d+$/.test(v)) || ![memory,width,height].every(Number.isSafeInteger) || memory < 1024 || memory > 32768 || width < 854 || width > 7680 || height < 480 || height > 4320) {
    error.value = true; message.value = "内存须为 1024–32768 MiB，宽度 854–7680，高度 480–4320。"; return;
  }
  if (!props.actions.save) { error.value = true; message.value = "偏好设置能力不可用"; return; }
  busy.value = true; message.value = "";
  try {
    const result = await props.actions.save({ preferences: { schemaVersion: 1, defaultMemoryMb: memory, defaultWindowWidth: width, defaultWindowHeight: height } });
    error.value = !result?.ok; message.value = result?.ok ? "已保存，适用于之后创建的实例。" : result?.error?.message ?? "保存失败";
    if (result?.ok) dirty.value = false;
  } catch { error.value = true; message.value = "保存失败"; }
  finally { busy.value = false; }
}
function changed() { dirty.value = true; message.value = ""; }
onMounted(load);
</script>
<template>
  <div class="host-preferences">
    <p class="detail-note">仅用于之后新建的实例；现有实例不会改变。</p>
    <form v-if="loaded" @submit.prevent="save">
      <fieldset :disabled="busy" class="preference-fields">
        <label>默认最大内存（MiB）<input v-model="draft.defaultMemoryMb" name="defaultMemoryMb" type="number" @input="changed" /></label>
        <label>默认窗口宽度<input v-model="draft.defaultWindowWidth" name="defaultWindowWidth" type="number" @input="changed" /></label>
        <label>默认窗口高度<input v-model="draft.defaultWindowHeight" name="defaultWindowHeight" type="number" @input="changed" /></label>
      </fieldset>
      <p v-if="dirty" class="detail-note">有未保存修改</p>
      <button type="submit" class="primary-button" :disabled="busy">保存默认设置</button>
    </form>
    <p v-if="message" :class="{ 'form-error': error }" role="status">{{ message }}</p>
    <button type="button" class="ghost-button" :disabled="busy" @click="load">{{ dirty ? "放弃修改并重新读取" : "重新读取" }}</button>
  </div>
</template>
<style scoped>
.preference-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; padding: 0; border: 0; }
.preference-fields label { display: grid; gap: 6px; }
.preference-fields input { width: 100%; min-width: 0; }
</style>
