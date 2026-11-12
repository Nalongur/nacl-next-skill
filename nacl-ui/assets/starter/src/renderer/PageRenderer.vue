<script setup lang="ts">
import { computed, provide, ref } from "vue";
import type { PageDefinition } from "../contract/page";
import type { ActionController } from "../state/actions";
import { ACTION_CONTROLLER, OPEN_LOG_PAGE } from "./context";
import { effectiveIdentity, selectedInstance } from "../state/store";
import BlockHost from "./BlockHost.vue";
import SidebarLayout from "../layouts/SidebarLayout.vue";
import StudioLayout from "../layouts/StudioLayout.vue";

const props = defineProps<{ page: PageDefinition; controller: ActionController }>();
provide(ACTION_CONTROLLER, props.controller);
const activePage = ref<"home" | "instances" | "logs" | "settings">("home");
const hasInstanceOverview = computed(() => props.page.blocks.some((block) =>
  block.page === "instances" && block.slot !== "nav" && block.component !== "JavaPanel" && block.component !== "InstanceSettings"));
const hasInstanceJava = computed(() => props.page.blocks.some((block) =>
  block.page === "instances" && block.slot !== "nav" && block.component === "JavaPanel"));
const hasInstanceSettings = computed(() => props.page.blocks.some((block) =>
  block.page === "instances" && block.slot !== "nav" && block.component === "InstanceSettings"));
const hasInstanceAdvanced = computed(() => props.page.blocks.some((block) =>
  block.page === "instances" && block.slot !== "nav" && block.component === "InstanceSettings" && Boolean(block.actions?.saveAdvanced)));
const instanceTab = ref<"overview" | "java" | "settings" | "advanced">(hasInstanceOverview.value ? "overview" : hasInstanceJava.value ? "java" : "settings");
const sharedInstanceList = computed(() => props.page.blocks.find((block) =>
  block.component === "InstanceList" && block.page === "instances" && block.slot === "nav"));
const identity = computed(() => effectiveIdentity());
const instance = computed(() => selectedInstance());
provide(OPEN_LOG_PAGE, () => {
  if (props.page.layout === "nacl") {
    activePage.value = props.page.blocks.find((block) => block.component === "LogViewer")?.page ?? "logs";
    if (activePage.value === "instances") instanceTab.value = "overview";
  }
});
const pages = computed(() => ([{ id: "home", label: "首页" }, { id: "instances", label: "实例" }, { id: "logs", label: "日志" }, { id: "settings", label: "设置" }] as const).filter((item) => item.id === "home" || props.page.blocks.some((block) => block.page === item.id)));

function isIdentity(component: string) {
  return ["MicrosoftIdentity", "LocalProfiles", "IdentityPicker"].includes(component);
}

function blocksFor(slot: string) {
  return props.page.blocks.filter((block) => block.slot === slot);
}
</script>

<template>
  <div v-if="page.layout === 'nacl'" class="nacl-shell">
    <nav class="nacl-rail" aria-label="主导航">
      <strong class="nacl-brand">N<span>↗</span></strong>
      <button v-for="item in pages" :key="item.id" type="button" :data-page="item.id" :aria-current="activePage === item.id ? 'page' : undefined" @click="activePage = item.id">{{ item.label }}</button>
    </nav>
    <aside class="nacl-context" aria-label="上下文侧栏">
      <div class="nacl-context-body">
        <h2>{{ activePage === 'home' ? '快速启动' : pages.find((item) => item.id === activePage)?.label }}</h2>
        <p v-if="sharedInstanceList && (activePage === 'home' || activePage === 'instances')" class="nacl-context-label">{{ activePage === 'home' ? '最近实例' : '全部实例' }}</p>
        <div v-if="sharedInstanceList" :style="{ display: activePage === 'home' || activePage === 'instances' ? 'block' : 'none' }">
          <BlockHost :block="sharedInstanceList" />
        </div>
        <section v-for="item in pages" :key="item.id" :style="{ display: activePage === item.id ? 'grid' : 'none' }">
          <template v-if="item.id === 'home'">
            <BlockHost v-for="block in page.blocks.filter((entry) => entry.page === 'home' && entry.slot === 'nav' && !isIdentity(entry.component))" :key="block.id" :block="block" />
            <details v-if="page.blocks.some((entry) => entry.page === 'home' && entry.slot === 'nav' && isIdentity(entry.component))" class="nacl-identity-controls">
              <summary>管理身份</summary>
              <BlockHost v-for="block in page.blocks.filter((entry) => entry.page === 'home' && entry.slot === 'nav' && isIdentity(entry.component))" :key="block.id" :block="block" />
            </details>
          </template>
          <template v-else>
            <BlockHost v-for="block in page.blocks.filter((entry) => entry.page === item.id && entry.slot === 'nav' && entry.id !== sharedInstanceList?.id)" :key="block.id" :block="block" />
          </template>
          <nav v-if="item.id === 'instances' && (hasInstanceOverview || hasInstanceJava || hasInstanceSettings || hasInstanceAdvanced)" class="nacl-subnav" aria-label="实例设置">
            <button v-if="hasInstanceOverview" type="button" :aria-current="instanceTab === 'overview' ? 'page' : undefined" @click="instanceTab = 'overview'">概览</button>
            <button v-if="hasInstanceJava" type="button" :aria-current="instanceTab === 'java' ? 'page' : undefined" @click="instanceTab = 'java'">Java 运行时</button>
            <button v-if="hasInstanceSettings" type="button" :aria-current="instanceTab === 'settings' ? 'page' : undefined" @click="instanceTab = 'settings'">内存与窗口</button>
            <button v-if="hasInstanceAdvanced" type="button" :aria-current="instanceTab === 'advanced' ? 'page' : undefined" @click="instanceTab = 'advanced'">高级</button>
          </nav>
        </section>
      </div>
      <div class="nacl-account" aria-label="当前启动身份" aria-live="polite">
        <span class="nacl-avatar" aria-hidden="true">●</span>
        <div><strong>{{ identity?.username ?? '尚未选择身份' }}</strong><p>{{ identity?.label ?? '请先选择启动身份' }}</p></div>
      </div>
    </aside>
    <main class="nacl-content">
      <section v-for="item in pages" v-show="activePage === item.id" :key="item.id" :aria-label="item.label">
        <template v-if="item.id === 'home'">
          <p class="nacl-eyebrow">快速启动</p>
          <h1>{{ instance?.name ?? '选择一个实例' }}</h1>
          <p class="nacl-subtitle">{{ instance ? `${instance.gameVersion} · ${instance.installation.state === 'ready' ? '已就绪' : '未就绪'}` : '选择已有实例后检查启动条件' }}</p>
        </template>
        <h1 v-else>{{ item.label }}</h1>
        <div class="nacl-columns">
          <div v-for="slot in ['main', 'aside']" :key="slot" class="nacl-column">
            <BlockHost v-for="block in page.blocks.filter((entry) => entry.page === item.id && entry.slot === slot)" v-show="item.id !== 'instances' || (block.component === 'JavaPanel' ? instanceTab === 'java' : block.component === 'InstanceSettings' ? (instanceTab === 'settings' || instanceTab === 'advanced') : instanceTab === 'overview')" :key="block.id" :block="block" :instance-section="item.id === 'instances' && instanceTab === 'advanced' ? 'advanced' : 'settings'" />
          </div>
        </div>
      </section>
    </main>
  </div>
  <SidebarLayout v-else-if="page.layout === 'sidebar'" :page="page">
    <template #nav>
      <BlockHost v-for="block in blocksFor('nav')" :key="block.id" :block="block" />
    </template>
    <template #main>
      <BlockHost v-for="block in blocksFor('main')" :key="block.id" :block="block" />
    </template>
    <template #aside>
      <BlockHost v-for="block in blocksFor('aside')" :key="block.id" :block="block" />
    </template>
  </SidebarLayout>

  <StudioLayout v-else :page="page">
    <template #top>
      <BlockHost v-for="block in blocksFor('top')" :key="block.id" :block="block" />
    </template>
    <template #left>
      <BlockHost v-for="block in blocksFor('left')" :key="block.id" :block="block" />
    </template>
    <template #center>
      <BlockHost v-for="block in blocksFor('center')" :key="block.id" :block="block" />
    </template>
    <template #bottom>
      <BlockHost v-for="block in blocksFor('bottom')" :key="block.id" :block="block" />
    </template>
    <template #right>
      <BlockHost v-for="block in blocksFor('right')" :key="block.id" :block="block" />
    </template>
  </StudioLayout>
</template>

<style scoped>
.nacl-shell {
  --bg: #1a1e1f;
  --bg-elevated: #202526;
  --panel: #202526;
  --panel-strong: #242a2b;
  --panel-soft: #191e1f;
  --text: #f2f6f6;
  --muted: #a4aeae;
  --faint: #849091;
  --border: #343c3d;
  --border-strong: #465051;
  --danger: #f07e7e;
  --success: #75d8aa;
  --shadow: none;
  --nacl-readable-accent: color-mix(in srgb, var(--accent) 40%, white);
  display: flex; height: 100vh; min-height: 0; background: var(--bg); color: var(--text);
}
.nacl-rail { width: 72px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 20px 8px; background: #111516; }
.nacl-brand { height: 48px; font-size: 23px; letter-spacing: -2px; color: #f2f6f5; }
.nacl-brand span { color: var(--accent); font-size: 13px; vertical-align: top; }
.nacl-rail button { width: 54px; min-height: 54px; display: grid; justify-items: center; align-content: center; gap: 2px; padding: 5px; border: 0; border-radius: 12px; color: #9daaa7; background: transparent; font-size: 11px; cursor: pointer; }
.nacl-rail button::before { font-size: 21px; line-height: 1; }
.nacl-rail button[data-page="home"]::before { content: "⌂"; }
.nacl-rail button[data-page="instances"]::before { content: "▣"; }
.nacl-rail button[data-page="logs"]::before { content: "☰"; }
.nacl-rail button[data-page="settings"]::before { content: "⚙"; }
.nacl-rail button[aria-current="page"] { background: #283b35; color: var(--text); }
.nacl-rail button[aria-current="page"]::before { color: var(--nacl-readable-accent); }
.nacl-context { width: 250px; min-height: 0; flex: none; display: flex; flex-direction: column; justify-content: space-between; gap: 24px; padding: 27px 16px; background: #15191a; border-right: 1px solid #2e3435; }
.nacl-context-body { display: grid; align-content: start; gap: 12px; min-width: 0; min-height: 0; overflow-y: auto; }
.nacl-context-label { margin: 0; color: #9daaa7; font-size: 12px; }
.nacl-account { display: flex; flex: none; gap: 10px; align-items: center; padding: 14px 0 0; border-top: 1px solid #303936; overflow-wrap: anywhere; }
.nacl-account p { margin: 4px 0 0; color: #9daaa7; font-size: 12px; }
.nacl-avatar { display: grid; place-items: center; width: 36px; height: 36px; flex: none; border-radius: 10px; color: var(--accent); background: #2a3935; }
.nacl-identity-controls summary { padding: 10px 0; cursor: pointer; color: var(--nacl-readable-accent); }
.nacl-identity-controls :deep(.block) { margin-top: 10px; }
.nacl-context section { display: grid; gap: 16px; }
.nacl-context :deep(.block-InstanceList) { padding: 0; border: 0; background: none; box-shadow: none; }
.nacl-context :deep(.block-InstanceList > .block-head) { display: none; }
.nacl-context :deep(.instance-row) { border: 0; background: transparent; }
.nacl-context :deep(.instance-row.selected) { background: #2a3935; box-shadow: inset 3px 0 0 var(--accent); }
.nacl-shell :deep(.block-id) { display: none; }
.nacl-context h2 { font-size: 16px; margin: 0; }
.nacl-subnav { display: grid; gap: 6px; }
.nacl-subnav button { text-align: left; padding: 10px 12px; color: inherit; background: transparent; border: 0; border-radius: var(--radius); cursor: pointer; }
.nacl-subnav button[aria-current="page"] { background: #303b3d; }
.nacl-content { flex: 1; min-width: 0; padding: 36px 40px; overflow: auto; }
.nacl-content :deep(.block) { background: var(--panel); border-color: var(--border); box-shadow: none; }
.nacl-content :deep(.block-LaunchPanel) { background: transparent; border: 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); border-radius: 0; padding: 24px 0; }
.nacl-content section[aria-label="首页"] :deep(.launch-heading) { justify-content: flex-end; }
.nacl-shell :deep(input[type="text"]), .nacl-shell :deep(input[type="number"]), .nacl-shell :deep(select), .nacl-shell :deep(textarea) {
  min-height: 38px; padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: 7px; background: var(--panel-soft); color: var(--text);
}
.nacl-shell :deep(select option) { background: var(--panel); color: var(--text); }
.nacl-shell :deep(input:disabled), .nacl-shell :deep(select:disabled) { opacity: .55; }
.nacl-shell :deep(input:focus-visible), .nacl-shell :deep(select:focus-visible), .nacl-shell :deep(textarea:focus-visible) { outline: 2px solid var(--nacl-readable-accent); outline-offset: 2px; }
.nacl-shell :deep(.ghost-button) { background: var(--panel); }
.nacl-shell :deep(.primary-button) { background: var(--nacl-readable-accent); color: #0c2425; border-color: transparent; }
.nacl-shell :deep(.eyebrow), .nacl-shell :deep(.link-button), .nacl-shell :deep(.config-snippet), .nacl-shell :deep(.auth-url), .nacl-shell :deep(.mode-badge), .nacl-shell :deep(.identity-avatar) { color: var(--nacl-readable-accent); }
.nacl-shell :deep(:focus-visible) { outline-color: var(--nacl-readable-accent); }
.nacl-shell :deep(.primary-button:disabled) { background: #34413f; color: var(--muted); }
.nacl-content section { display: grid; gap: 16px; }
.nacl-eyebrow { margin: 0 0 -10px; color: var(--nacl-readable-accent); font-size: 12px; }
.nacl-content h1 { margin: 0; font-size: clamp(28px, 3vw, 42px); line-height: 1.15; }
.nacl-subtitle { margin: -8px 0 8px; color: #9daaa7; }
.nacl-columns { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.nacl-column { flex: 1 1 260px; min-width: 0; display: grid; gap: 16px; }
.nacl-column:empty { display: none; }
@media (max-width: 1050px) { .nacl-context { width: 220px; } .nacl-content { padding: 24px; } }
</style>
