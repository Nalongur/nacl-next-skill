<script setup lang="ts">
import { setGlobalError, store } from "../state/store";
</script>

<template>
  <div v-if="store.globalError" class="error-banner" role="alert">
    <div class="error-copy">
      <strong>{{ store.globalError.code }}</strong>
      <p>{{ store.globalError.message }}</p>
      <small v-if="store.globalError.retryable">该错误可重试；请先检查当前选择与配置。</small>
    </div>
    <button type="button" class="ghost-button" @click="setGlobalError(null)">关闭</button>
  </div>
</template>
