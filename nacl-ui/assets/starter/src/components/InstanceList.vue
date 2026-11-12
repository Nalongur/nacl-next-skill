<script setup lang="ts">
import { computed, ref } from "vue";
import type { InstanceConfig } from "../adapter/types";
import { store } from "../state/store";
import type { PageActions } from "../renderer/context";
import StatePanel from "./StatePanel.vue";

const props = defineProps<{
  items: InstanceConfig[];
  deleted: InstanceConfig[];
  selectedId: string | null;
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
const showCreate = ref(false);
const showDeleted = ref(false);
const name = ref("");
const gameVersion = ref("");
const formError = ref("");
const pendingDelete = ref<string | null>(null);
const pendingPurge = ref<string | null>(null);

const compact = computed(() => props.params.compact === true);
const allowCreate = computed(
  () => props.params.allowCreate !== false && Boolean(props.actions.create),
);
const allowDelete = computed(
  () => props.params.allowDelete !== false && Boolean(props.actions.remove),
);
const allowDuplicate = computed(
  () => props.params.allowDuplicate !== false && Boolean(props.actions.duplicate),
);
const allowRestore = computed(
  () => props.params.allowRestore !== false && Boolean(props.actions.restore),
);
const loading = computed(() => store.instancesLoading && props.items.length === 0);
const error = computed(() => store.instancesError);

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

async function select(id: string) {
  await invoke("select", { id });
}

async function create() {
  formError.value = "";
  if (!name.value.trim()) {
    formError.value = "实例名称不能为空";
    return;
  }
  if (!gameVersion.value.trim()) {
    formError.value = "请填写已有版本元数据标识（本应用不会下载游戏）";
    return;
  }
  const result = await invoke("create", {
    name: name.value.trim(),
    gameVersion: gameVersion.value.trim(),
  });
  if (result?.ok) {
    name.value = "";
    gameVersion.value = "";
    showCreate.value = false;
  }
}

async function confirmDelete(id: string) {
  const result = await invoke("remove", { id });
  if (result?.ok) pendingDelete.value = null;
}

async function confirmPurge(id: string) {
  const result = await invoke("purge", { id });
  if (result?.ok) pendingPurge.value = null;
}

function loaderLabel(instance: InstanceConfig): string {
  if (instance.loader.kind === "vanilla") return "Vanilla";
  return `${instance.loader.kind} ${instance.loader.version ?? ""}`.trim();
}
</script>

<template>
  <div class="instance-list" :class="{ compact }">
    <div class="block-toolbar">
      <span class="count-label">{{ items.length }} 个实例</span>
      <div class="toolbar-actions">
        <button
          v-if="allowCreate"
          type="button"
          class="ghost-button"
          @click="showCreate = !showCreate"
        >
          {{ showCreate ? "收起" : "新建实例" }}
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

    <form v-if="showCreate && allowCreate" class="inline-form" @submit.prevent="create">
      <label>
        实例名称
        <input v-model="name" type="text" maxlength="64" placeholder="例如：探针实例" />
      </label>
      <label>
        已有版本元数据
        <input
          v-model="gameVersion"
          type="text"
          maxlength="64"
          placeholder="例如：1.21.1-probe"
        />
      </label>
      <p class="form-note">
        仅创建配置，不会下载或修复游戏文件；缺失元数据时启动检查会说明原因。
      </p>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <div class="form-actions">
        <button type="submit" class="primary-button" :disabled="busy">
          {{ busy ? "创建中…" : "创建实例" }}
        </button>
        <button type="button" class="ghost-button" @click="showCreate = false">
          取消
        </button>
      </div>
    </form>

    <StatePanel
      v-if="loading"
      tone="loading"
      title="正在读取实例列表"
      detail="通过实例管理命令加载，不使用占位数据。"
    />
    <StatePanel
      v-else-if="error"
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
      title="还没有实例"
      detail="创建实例只会写入配置；本应用不获取游戏文件。"
    />

    <ul v-else class="instance-rows">
      <li v-for="instance in items" :key="instance.id">
        <div
          class="instance-row"
          :class="{ selected: instance.id === selectedId }"
        >
          <button
            type="button"
            class="instance-main"
            :aria-pressed="instance.id === selectedId"
            @click="select(instance.id)"
          >
            <span class="instance-name">{{ instance.name }}</span>
            <span class="instance-meta">
              {{ instance.gameVersion }} · {{ loaderLabel(instance) }}
            </span>
            <span
              class="state-chip"
              :class="instance.installation.state === 'ready' ? 'is-ready' : 'is-incomplete'"
            >
              {{ instance.installation.state === "ready" ? "已就绪" : "未就绪" }}
            </span>
          </button>
          <div v-if="instance.id === selectedId" class="row-actions">
            <button
              v-if="allowDuplicate"
              type="button"
              class="tiny-button"
              :disabled="busy"
              @click="invoke('duplicate', { id: instance.id })"
            >
              复制
            </button>
            <template v-if="allowDelete">
              <button
                v-if="pendingDelete !== instance.id"
                type="button"
                class="tiny-button danger"
                :disabled="busy"
                @click="pendingDelete = instance.id"
              >
                删除
              </button>
              <button
                v-else
                type="button"
                class="tiny-button danger"
                :disabled="busy"
                @click="confirmDelete(instance.id)"
              >
                确认删除
              </button>
            </template>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="allowRestore && deleted.length > 0" class="deleted-panel">
      <button type="button" class="link-button" @click="showDeleted = !showDeleted">
        {{ showDeleted ? "收起回收站" : `回收站（${deleted.length}）` }}
      </button>
      <ul v-if="showDeleted" class="deleted-rows">
        <li v-for="instance in deleted" :key="instance.id">
          <div class="deleted-row">
            <span>{{ instance.name }}</span>
            <span class="muted">{{ instance.gameVersion }}</span>
            <div class="row-actions">
              <button
                type="button"
                class="tiny-button"
                :disabled="busy"
                @click="invoke('restore', { id: instance.id })"
              >
                恢复
              </button>
              <button
                v-if="pendingPurge !== instance.id"
                type="button"
                class="tiny-button danger"
                :disabled="busy"
                @click="pendingPurge = instance.id"
              >
                彻底删除
              </button>
              <button
                v-else
                type="button"
                class="tiny-button danger"
                :disabled="busy"
                @click="confirmPurge(instance.id)"
              >
                确认彻底删除
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
