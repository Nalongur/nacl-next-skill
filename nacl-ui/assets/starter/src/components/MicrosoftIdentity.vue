<script setup lang="ts">
import { computed, ref } from "vue";
import type { MicrosoftAccount } from "../adapter/types";
import { store } from "../state/store";
import { formatTime } from "../renderer/labels";
import type { PageActions } from "../renderer/context";
import StatePanel from "./StatePanel.vue";

const props = defineProps<{
  account: MicrosoftAccount | null;
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
const copyStatus = ref("");
const showConfigHint = computed(() => props.params.showConfigHint !== false);
const compact = computed(() => props.params.compact === true);

const pendingTask = computed(() =>
  store.tasks.find((task) => task.taskId === store.microsoft.pendingTaskId) ?? null,
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

async function copyUrl() {
  const url = store.microsoft.login?.authorizationUrl;
  if (!url) return;
  copyStatus.value = "";
  try {
    await navigator.clipboard.writeText(url);
    copyStatus.value = "链接已复制";
  } catch {
    copyStatus.value = "无法自动复制，请手动选中下方链接";
  }
}
</script>

<template>
  <div class="microsoft-identity" :class="{ compact }">
    <StatePanel
      v-if="store.microsoft.status === 'missing-config'"
      tone="error"
      title="未配置 Microsoft Client ID"
      :detail="
        showConfigHint
          ? '正版登录要求开发者或发行者配置其有权使用的应用 Client ID；本页面不会自动切换为离线身份。'
          : store.microsoft.error?.message ?? '缺少 Microsoft Client ID'
      "
    >
      <code v-if="showConfigHint" class="config-snippet">
        NACL_NEXT_MICROSOFT_CLIENT_ID
      </code>
      <button type="button" class="ghost-button" @click="invoke('refresh')">
        重新检查
      </button>
    </StatePanel>

    <StatePanel
      v-else-if="store.microsoft.status === 'error'"
      tone="error"
      :title="store.microsoft.error?.code ?? 'auth/microsoft/error'"
      :detail="store.microsoft.error?.message ?? 'Microsoft 身份状态读取失败'"
    >
      <button type="button" class="ghost-button" @click="invoke('refresh')">
        重试
      </button>
    </StatePanel>

    <template v-else-if="account">
      <div class="identity-card verified">
        <div class="identity-avatar" aria-hidden="true">
          {{ account.minecraftName.slice(0, 2).toUpperCase() }}
        </div>
        <div class="identity-copy">
          <span class="identity-name">{{ account.minecraftName }}</span>
          <span class="identity-label">Microsoft · 已验证</span>
          <span class="identity-id mono">{{ account.minecraftId }}</span>
          <span class="identity-meta">
            皮肤 {{ account.skins.length }} · 披风 {{ account.capes.length }} · 登录于
            {{ formatTime(account.signedInEpochMs) }}
          </span>
        </div>
        <button
          type="button"
          class="ghost-button danger-text"
          :disabled="busy"
          @click="invoke('logout')"
        >
          退出登录
        </button>
      </div>
      <p class="trust-note">
        已验证身份由 Microsoft/Xbox/Minecraft 服务返回；退出不会影响本地档案。
      </p>
    </template>

    <template v-else-if="store.microsoft.login">
      <div class="login-pending">
        <p class="eyebrow">等待浏览器授权</p>
        <p class="login-lede">
          在系统浏览器打开下方链接并完成登录；应用会在本机回环端口等待回调。
          本应用不会自动打开外部浏览器，也不会上传凭据。
        </p>
        <code class="auth-url">{{ store.microsoft.login.authorizationUrl }}</code>
        <div class="login-actions">
          <a
            class="ghost-button"
            :href="store.microsoft.login.authorizationUrl"
            target="_blank"
            rel="noreferrer"
          >
            尝试打开链接
          </a>
          <button type="button" class="ghost-button" @click="copyUrl">
            复制链接
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="busy || Boolean(store.microsoft.pendingTaskId)"
            @click="invoke('completeLogin')"
          >
            {{ store.microsoft.pendingTaskId ? "等待回调…" : "我已授权，继续" }}
          </button>
          <button
            type="button"
            class="ghost-button"
            :disabled="busy"
            @click="invoke('cancelLogin')"
          >
            取消登录
          </button>
        </div>
        <p v-if="copyStatus" class="muted" role="status">{{ copyStatus }}</p>
        <div v-if="pendingTask" class="task-inline">
          <span class="state-chip" :class="`is-${pendingTask.state}`">
            {{ pendingTask.state }}
          </span>
          <span class="mono">{{ pendingTask.taskId }}</span>
          <span v-if="pendingTask.error" class="form-error">
            {{ pendingTask.error.code }} · {{ pendingTask.error.message }}
          </span>
        </div>
        <p class="trust-note">
          取消只丢弃本地等待会话；真实登录结果和权益始终以服务返回为准。
        </p>
      </div>
    </template>

    <template v-else>
      <div class="identity-empty">
        <div class="identity-avatar" aria-hidden="true">MS</div>
        <div class="identity-copy">
          <span class="identity-name">尚未登录 Microsoft</span>
          <span class="identity-label">正版身份 · 需要开发者配置的 Client ID</span>
          <span class="identity-meta">
            登录会打开系统浏览器；本应用不会自动改用本地档案。
          </span>
        </div>
        <button
          type="button"
          class="primary-button"
          :disabled="busy || store.microsoft.busy"
          @click="invoke('beginLogin')"
        >
          {{ busy ? "准备中…" : "开始 Microsoft 登录" }}
        </button>
      </div>
      <p v-if="showConfigHint" class="config-hint">
        若缺少 Client ID，登录入口会显示配置提示，而不会假装已登录或回退身份。
      </p>
    </template>
  </div>
</template>
