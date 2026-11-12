<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { bootConfig } from "./boot-config";
import { decideBoot } from "./boot";
import { createAdapter } from "./adapter";
import { normalizeError, type NormalizedError } from "./adapter/types";
import type { ValidationIssue } from "./contract/page";
import { createActionController, type ActionController } from "./state/actions";
import { store } from "./state/store";
import PageRenderer from "./renderer/PageRenderer.vue";
import ConfigError from "./components/ConfigError.vue";
import ErrorBanner from "./components/ErrorBanner.vue";
import StatePanel from "./components/StatePanel.vue";

// Boot decision runs synchronously in setup, before any template or
// computed touches a page field: invalid configuration renders the stable
// error screen instead of throwing, and never builds the business adapter
// (review S3-R2). Loading and error screens rely on no page field.
const decision = decideBoot(bootConfig);

const state = ref<"loading" | "ready" | "fatal">(decision.ok ? "loading" : "fatal");
const issues = ref<ValidationIssue[]>(decision.ok ? [] : decision.issues);
const bootError = ref<NormalizedError | null>(null);
const controller = shallowRef<ActionController | null>(null);
const validatedProject = decision.ok ? decision.project : null;
const validatedPage = decision.ok ? decision.page : null;
let activeController: ActionController | null = null;

if (validatedProject) {
  activeController = createActionController(createAdapter(validatedProject));
}

// Theme variables only exist once a validated page is actually mounted.
const themeStyle = computed(() => {
  if (state.value !== "ready" || !validatedPage) return undefined;
  const theme = validatedPage.theme;
  return {
    "--accent": theme.accent,
    "--radius": `${theme.radius}px`,
    "--density": theme.density === "compact" ? "0.9" : "1",
  };
});
const themeDensity = computed(() =>
  state.value === "ready" && validatedPage ? validatedPage.theme.density : null,
);
const themeFont = computed(() =>
  state.value === "ready" && validatedPage ? validatedPage.theme.font : null,
);
const pageMode = computed(() => (validatedPage ? validatedPage.mode : null));
const adapterLabel = computed(() =>
  validatedProject?.adapter === "mock" ? "MOCK 模拟数据" : "IPC 桌面后端",
);

onMounted(async () => {
  if (!validatedProject || !validatedPage || !activeController) return;
  try {
    const boot = await activeController.bootstrap(validatedProject, validatedPage);
    if (!boot.ok) {
      bootError.value = boot.error ?? null;
      activeController.dispose();
      activeController = null;
      state.value = "fatal";
      return;
    }
    document.title = validatedProject.app.productName;
    controller.value = activeController;
    state.value = "ready";
  } catch (error) {
    bootError.value = normalizeError(error);
    activeController?.dispose();
    activeController = null;
    state.value = "fatal";
  }
});

onBeforeUnmount(() => {
  activeController?.dispose();
  activeController = null;
});
</script>

<template>
  <div
    class="app-root"
    :style="themeStyle"
    :data-density="themeDensity"
    :data-font="themeFont"
    :data-mode="pageMode"
  >
    <ErrorBanner />

    <PageRenderer
      v-if="state === 'ready' && controller && validatedPage"
      :page="validatedPage"
      :controller="controller"
    />

    <div v-else-if="state === 'loading'" class="boot-screen">
      <StatePanel
        tone="loading"
        title="正在启动固定渲染器"
        detail="校验页面配置、连接后端并订阅任务状态。"
      />
      <p class="muted">适配器：{{ adapterLabel }}</p>
    </div>

    <ConfigError v-else :issues="issues" :boot-error="bootError" />

    <p v-if="store.globalError" class="sr-only" aria-live="assertive">
      {{ store.globalError.code }}：{{ store.globalError.message }}
    </p>
  </div>
</template>
