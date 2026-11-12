<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  EffectiveIdentity,
} from "../state/store";
import type { LocalProfile, MicrosoftAccount } from "../adapter/types";
import { store } from "../state/store";
import type { PageActions } from "../renderer/context";
import StatePanel from "./StatePanel.vue";

const props = defineProps<{
  account: MicrosoftAccount | null;
  profiles: LocalProfile[];
  selectedKind: "local" | "microsoft" | null;
  effective: EffectiveIdentity | null;
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
const compact = computed(() => props.params.compact === true);
const showTrust = computed(() => props.params.showTrust !== false);
const hasAnyIdentity = computed(() => Boolean(props.account) || props.profiles.length > 0);

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

async function chooseMicrosoft() {
  await invoke("select", { kind: "microsoft" });
}

async function chooseLocal(profileId: string) {
  await invoke("select", { kind: "local", profileId });
}
</script>

<template>
  <div class="identity-picker" :class="{ compact }">
    <div class="block-toolbar">
      <span class="count-label">D · 本次启动身份</span>
      <button
        type="button"
        class="ghost-button"
        :disabled="busy"
        @click="invoke('refresh')"
      >
        刷新身份
      </button>
    </div>

    <div v-if="effective" class="effective-identity" role="status">
      <span class="state-chip" :class="effective.kind === 'microsoft' ? 'is-ready' : 'is-local'">
        {{ effective.kind === "microsoft" ? "正版" : "本地" }}
      </span>
      <div>
        <strong>{{ effective.username }}</strong>
        <span class="muted"> · {{ effective.label }}</span>
        <p class="mono identity-id">{{ effective.id }}</p>
      </div>
    </div>
    <StatePanel
      v-else
      tone="empty"
      title="尚未选择本次启动身份"
      detail="D 模式要求显式选择正版账号或本地档案；不会自动替你选一种。"
    />

    <StatePanel
      v-if="!hasAnyIdentity"
      tone="empty"
      title="没有可用身份"
      detail="登录 Microsoft 账号或创建一个本地档案后再选择。"
    />

    <div v-else class="identity-groups">
      <section class="identity-group" aria-label="Microsoft 身份">
        <h3>Microsoft</h3>
        <button
          v-if="account"
          type="button"
          class="identity-option"
          :class="{ selected: selectedKind === 'microsoft' }"
          :aria-pressed="selectedKind === 'microsoft'"
          @click="chooseMicrosoft"
        >
          <span class="identity-avatar small" aria-hidden="true">
            {{ account.minecraftName.slice(0, 2).toUpperCase() }}
          </span>
          <span class="identity-option-copy">
            <strong>{{ account.minecraftName }}</strong>
            <span v-if="showTrust" class="muted">
              已验证 · 官方服务返回权益
            </span>
          </span>
        </button>
        <p v-else class="muted identity-unavailable">
          未登录 Microsoft；此情况不会自动改用本地档案。
        </p>
      </section>

      <section class="identity-group" aria-label="本地档案">
        <h3>本地档案</h3>
        <button
          v-for="profile in profiles"
          :key="profile.id"
          type="button"
          class="identity-option"
          :class="{ selected: selectedKind === 'local' && store.selectedProfileId === profile.id }"
          :aria-pressed="selectedKind === 'local' && store.selectedProfileId === profile.id"
          @click="chooseLocal(profile.id)"
        >
          <span class="identity-avatar small local" aria-hidden="true">
            {{ profile.username.slice(0, 2).toUpperCase() }}
          </span>
          <span class="identity-option-copy">
            <strong>{{ profile.username }}</strong>
            <span v-if="showTrust" class="muted">未官方验证 · 无官方令牌/权益</span>
          </span>
        </button>
        <p v-if="profiles.length === 0" class="muted identity-unavailable">
          还没有本地档案；创建后可在这里选择。
        </p>
      </section>
    </div>
  </div>
</template>
