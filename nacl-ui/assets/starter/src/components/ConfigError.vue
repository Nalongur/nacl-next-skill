<script setup lang="ts">
import type { NormalizedError } from "../adapter/types";
import type { ValidationIssue } from "../contract/page";

defineProps<{
  issues: ValidationIssue[];
  bootError?: NormalizedError | null;
}>();

function reload() {
  window.location.reload();
}
</script>

<template>
  <main class="config-error" role="alert">
    <p class="eyebrow">配置未通过校验</p>
    <h1>页面没有挂载</h1>
    <p class="config-lede">
      固定渲染器拒绝加载未注册、跨模式或版本不兼容的配置。请修正 JSON 后重新构建；
      运行时会再次执行同一组结构校验与语义校验。
    </p>

    <div v-if="bootError" class="config-boot">
      <strong>{{ bootError.code }}</strong>
      <p>{{ bootError.message }}</p>
    </div>

    <ul v-if="issues.length > 0" class="config-list">
      <li v-for="issue in issues" :key="`${issue.path}-${issue.code}`">
        <code>{{ issue.path }}</code>
        <span class="config-code">{{ issue.code }}</span>
        <span>{{ issue.message }}</span>
      </li>
    </ul>

    <button type="button" class="primary-button" @click="reload">重新加载</button>
    <p class="config-hint">
      配置错误不会静默跳过，也不会自动回退到其它身份或适配器。模拟数据仅用于布局开发，
      不代表真实账号、文件或进程结果。
    </p>
  </main>
</template>
