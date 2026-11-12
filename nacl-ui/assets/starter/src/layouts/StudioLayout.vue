<script setup lang="ts">
import type { PageDefinition } from "../contract/page";
import StatusBadges from "../components/StatusBadges.vue";

defineProps<{ page: PageDefinition }>();
</script>

<template>
  <div class="layout studio-layout">
    <header class="studio-command">
      <div class="studio-brand">
        <span class="studio-mark" aria-hidden="true">N</span>
        <div>
          <p class="eyebrow">NaCL Next · S3 命令工作台</p>
          <h1>{{ page.title }}</h1>
        </div>
        <StatusBadges />
      </div>
      <div class="studio-command-slot" aria-label="启动命令与身份">
        <slot name="top" />
      </div>
    </header>

    <div class="studio-grid">
      <aside class="studio-left" aria-label="实例库与身份">
        <slot name="left" />
      </aside>
      <main class="studio-center" aria-label="任务舞台">
        <slot name="center" />
      </main>
      <aside class="studio-right" aria-label="配置检查器">
        <slot name="right" />
      </aside>
    </div>

    <section class="studio-console" aria-label="日志控制台">
      <slot name="bottom" />
    </section>

    <footer class="studio-footer">
      <span>STUDIO / L2 布局 · 共享组件与动作</span>
      <span>不获取游戏 · 不伪造账号或权益</span>
      <span>{{ page.blocks.length }} 个注册区块</span>
    </footer>
  </div>
</template>
