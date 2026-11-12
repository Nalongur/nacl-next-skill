<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "loading" | "empty" | "error" | "info";
    title: string;
    detail?: string;
  }>(),
  { tone: "info", detail: "" },
);
</script>

<template>
  <div
    class="state-panel"
    :class="`tone-${tone}`"
    :role="tone === 'error' ? 'alert' : 'status'"
  >
    <span class="state-glyph" aria-hidden="true">
      {{ tone === "loading" ? "…" : tone === "empty" ? "◇" : tone === "error" ? "!" : "i" }}
    </span>
    <div class="state-copy">
      <p class="state-title">{{ title }}</p>
      <p v-if="detail" class="state-detail">{{ detail }}</p>
      <slot />
    </div>
  </div>
</template>
