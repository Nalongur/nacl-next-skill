<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type {
  EffectiveIdentity,
} from "../state/store";
import type {
  InstanceConfig,
  LaunchPreview,
} from "../adapter/types";
import type { PageMode } from "../contract/page";
import type { LaunchedProcess } from "../../sdk/contracts/LaunchedProcess";
import { modeLabel } from "../renderer/labels";
import type { PageActions } from "../renderer/context";
import { OPEN_LOG_PAGE } from "../renderer/context";
import StatePanel from "./StatePanel.vue";

const props = defineProps<{
  instance: InstanceConfig | null;
  naclHome?: boolean;
  identity: EffectiveIdentity | null;
  preview: LaunchPreview | null;
  mode: PageMode;
  previewBusy: boolean;
  launchBusy: boolean;
  launchLast: LaunchedProcess | null;
  params: Record<string, string | number | boolean>;
  actions: PageActions;
}>();

const busy = ref(false);
const hero = computed(() => props.params.emphasis === "hero");
const showJava = computed(() => props.params.showJava !== false);
const showRecheck = computed(() => Boolean(props.actions.resolve));

const identityMissing = computed(() => {
  if (props.identity) return "";
  if (props.mode === "a") return "请先登录 Microsoft 账号；缺配置或失败时不会回退本地身份。";
  if (props.mode === "b") return "请在本地档案中选择一个档案。";
  return "请在身份选择器中选择本次启动身份；D 不会自动替你选择。";
});

const canStart = computed(
  () => Boolean(props.instance && props.identity && props.preview?.ready) && !props.launchBusy,
);

function logName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
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

const openLogPage = inject(OPEN_LOG_PAGE, undefined);
async function viewLog() {
  if (!props.launchLast) return;
  const result = await invoke("viewLog", { name: logName(props.launchLast.logFile) });
  if (result?.ok) openLogPage?.();
}
</script>

<template>
  <div class="launch-panel" :class="{ hero, compact: params.compact === true }">
    <StatePanel
      v-if="!instance"
      tone="empty"
      title="未选择实例"
      detail="选择实例后检查元数据、Java 与启动身份。"
    />
    <template v-else>
      <div class="launch-heading">
        <div v-if="!naclHome">
          <p class="eyebrow">{{ modeLabel(mode) }} · 启动检查</p>
          <h3>{{ instance.name }}</h3>
          <p class="muted">
            {{ instance.gameVersion }} · 安装状态 {{ instance.installation.state }}
          </p>
        </div>
        <span
          class="state-chip"
          :class="preview?.ready ? 'is-ready' : 'is-incomplete'"
        >
          {{ previewBusy ? "检查中" : preview?.ready ? "可启动" : "未就绪" }}
        </span>
      </div>

      <StatePanel
        v-if="previewBusy && !preview"
        tone="loading"
        title="正在检查启动条件"
        detail="读取实例、版本元数据与 Java 选择；不会下载文件。"
      />

      <div v-else-if="preview && !preview.ready" class="preview-blocked" role="alert">
        <strong>{{ preview.failureCode ?? "launch/not-ready" }}</strong>
        <p>{{ preview.failureMessage ?? "启动检查未通过" }}</p>
        <p class="muted">
          这里只报告真实原因；应用不会自动获取游戏、修复文件或更换启动身份。
        </p>
        <button
          v-if="showRecheck"
          type="button"
          class="ghost-button"
          :disabled="busy"
          @click="invoke('resolve')"
        >
          重新检查
        </button>
      </div>

      <div v-else-if="preview" class="preview-ready">
        <dl class="preview-grid">
          <dt>版本元数据</dt>
          <dd class="mono">{{ preview.metadataId ?? "—" }}</dd>
          <dt>所需 Java</dt>
          <dd>{{ preview.requiredJavaMajor ?? "—" }}</dd>
          <template v-if="showJava">
            <dt>将使用 Java</dt>
            <dd class="mono">
              {{ preview.selectedJava?.path ?? "自动检测未选中" }}
            </dd>
          </template>
        </dl>

        <div v-if="identity" class="launch-identity" role="status">
          <span class="state-chip" :class="identity.kind === 'microsoft' ? 'is-ready' : 'is-local'">
            {{ identity.kind === "microsoft" ? "正版身份" : "本地身份" }}
          </span>
          <div>
            <strong>{{ identity.username }}</strong>
            <span class="muted"> · {{ identity.label }}</span>
          </div>
        </div>
        <StatePanel
          v-else
          tone="empty"
          title="等待身份选择"
          :detail="identityMissing"
        />

        <div class="launch-actions">
          <button
            type="button"
            class="primary-button launch-button"
            :disabled="!canStart"
            @click="invoke('start')"
          >
            {{ launchBusy ? "正在启动…" : `启动 ${instance.name}` }}
          </button>
          <button
            v-if="showRecheck"
            type="button"
            class="ghost-button"
            :disabled="busy"
            @click="invoke('resolve')"
          >
            重新检查
          </button>
        </div>
        <p class="trust-note">
          启动使用本次显示的身份；本地身份不携带官方令牌/权益，缺失文件不会自动补全。
        </p>
      </div>

      <div v-if="launchLast" class="launch-result" role="status">
        <div>
          <p class="eyebrow">最近一次启动</p>
          <p>
            PID <span class="mono">{{ launchLast.processId }}</span> ·
            {{ launchLast.instanceId }}
          </p>
          <p class="mono log-path">{{ launchLast.logFile }}</p>
        </div>
        <button
          v-if="actions.viewLog"
          type="button"
          class="ghost-button"
          @click="viewLog"
        >
          查看日志
        </button>
      </div>
    </template>
  </div>
</template>
