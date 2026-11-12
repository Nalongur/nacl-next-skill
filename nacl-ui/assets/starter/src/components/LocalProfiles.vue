<script setup lang="ts">
import { computed, ref } from "vue";
import type { LocalProfile } from "../adapter/types";
import { store } from "../state/store";
import type { PageActions } from "../renderer/context";
import StatePanel from "./StatePanel.vue";

const props = defineProps<{
  items: LocalProfile[];
  selectedId: string | null;
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
const showCreate = ref(false);
const username = ref("");
const formError = ref("");
const editingId = ref<string | null>(null);
const editingName = ref("");
const pendingDelete = ref<string | null>(null);

const compact = computed(() => props.params.compact === true);
const showUuid = computed(() => props.params.showUuid === true);
const allowCreate = computed(
  () => props.params.allowCreate !== false && Boolean(props.actions.create),
);
const allowRename = computed(
  () => props.params.allowRename !== false && Boolean(props.actions.rename),
);
const allowDelete = computed(
  () => props.params.allowDelete !== false && Boolean(props.actions.remove),
);
const loading = computed(() => store.profilesLoading && props.items.length === 0);
const error = computed(() => store.profilesError);

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

async function create() {
  formError.value = "";
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username.value.trim())) {
    formError.value = "用户名须为 3–16 位字母、数字或下划线";
    return;
  }
  const result = await invoke("create", { username: username.value.trim() });
  if (result?.ok) {
    username.value = "";
    showCreate.value = false;
  }
}

async function saveRename() {
  if (!editingId.value) return;
  const result = await invoke("rename", {
    id: editingId.value,
    username: editingName.value.trim(),
  });
  if (result?.ok) {
    editingId.value = null;
    editingName.value = "";
  }
}

async function confirmDelete(id: string) {
  const result = await invoke("remove", { id });
  if (result?.ok) pendingDelete.value = null;
}
</script>

<template>
  <div class="local-profiles" :class="{ compact }">
    <div class="block-toolbar">
      <span class="count-label">{{ items.length }} 个本地档案</span>
      <div class="toolbar-actions">
        <button
          v-if="allowCreate"
          type="button"
          class="ghost-button"
          @click="showCreate = !showCreate"
        >
          {{ showCreate ? "收起" : "新建档案" }}
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

    <p class="trust-note">
      本地档案仅用于离线启动，不产生官方令牌或权益；不会发起 Microsoft 请求。
    </p>

    <form v-if="showCreate && allowCreate" class="inline-form" @submit.prevent="create">
      <label>
        离线用户名
        <input
          v-model="username"
          type="text"
          maxlength="16"
          placeholder="3–16 位字母、数字或下划线"
        />
      </label>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <div class="form-actions">
        <button type="submit" class="primary-button" :disabled="busy">
          {{ busy ? "创建中…" : "创建档案" }}
        </button>
        <button type="button" class="ghost-button" @click="showCreate = false">
          取消
        </button>
      </div>
    </form>

    <StatePanel
      v-if="loading"
      tone="loading"
      title="正在读取本地档案"
      detail="档案存储位于宿主配置目录。"
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
      title="还没有本地档案"
      detail="创建档案后才能以离线身份启动适用实例。"
    />

    <ul v-else class="profile-rows">
      <li v-for="profile in items" :key="profile.id">
        <div class="profile-row" :class="{ selected: profile.id === selectedId }">
          <button
            type="button"
            class="profile-main"
            :aria-pressed="profile.id === selectedId"
            @click="invoke('select', { id: profile.id })"
          >
            <span class="profile-name">{{ profile.username }}</span>
            <span class="profile-trust">本地 · 未官方验证</span>
            <span v-if="showUuid" class="profile-uuid mono">{{ profile.uuid }}</span>
          </button>

          <form
            v-if="editingId === profile.id"
            class="rename-form"
            @submit.prevent="saveRename"
          >
            <input v-model="editingName" type="text" maxlength="16" />
            <button type="submit" class="tiny-button" :disabled="busy">保存</button>
            <button
              type="button"
              class="tiny-button"
              @click="editingId = null"
            >
              取消
            </button>
          </form>
          <div v-else class="row-actions">
            <button
              v-if="allowRename"
              type="button"
              class="tiny-button"
              @click="editingId = profile.id; editingName = profile.username"
            >
              改名
            </button>
            <template v-if="allowDelete">
              <button
                v-if="pendingDelete !== profile.id"
                type="button"
                class="tiny-button danger"
                @click="pendingDelete = profile.id"
              >
                删除
              </button>
              <button
                v-else
                type="button"
                class="tiny-button danger"
                :disabled="busy"
                @click="confirmDelete(profile.id)"
              >
                确认删除
              </button>
            </template>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
