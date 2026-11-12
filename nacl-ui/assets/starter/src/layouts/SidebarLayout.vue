<script setup lang="ts">
import type { PageDefinition } from "../contract/page";
import StatusBadges from "../components/StatusBadges.vue";

defineProps<{ page: PageDefinition }>();
</script>

<template>
  <div class="layout sidebar-layout">
    <header class="sidebar-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">Na</span>
        <div class="brand-copy">
          <p class="eyebrow">NaCL Next · S3 侧栏工作台</p>
          <h1>{{ page.title }}</h1>
        </div>
      </div>
      <StatusBadges />
    </header>

    <div class="sidebar-body">
      <nav class="sidebar-nav" aria-label="导航与身份">
        <slot name="nav" />
      </nav>
      <main class="sidebar-main" aria-label="工作区">
        <slot name="main" />
      </main>
      <aside class="sidebar-aside" aria-label="实例检查器">
        <slot name="aside" />
      </aside>
    </div>

    <footer class="sidebar-footer">
      <span>页面 schema v1 · 固定组件渲染</span>
      <span>不获取游戏 · 缺失文件只报告原因</span>
      <span>{{ page.blocks.length }} 个注册区块</span>
    </footer>
  </div>
</template>
