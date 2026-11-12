<script setup lang="ts">
import { store } from "../state/store";
import { adapterLabel, eventLabel, modeLabel } from "../renderer/labels";
</script>

<template>
  <div class="status-badges">
    <span class="badge mode-badge" :data-mode="store.mode">{{ modeLabel(store.mode) }}</span>
    <span
      class="badge adapter-badge"
      :class="store.adapterKind === 'mock' ? 'is-mock' : 'is-ipc'"
    >
      {{ adapterLabel(store.adapterKind) }}
    </span>
    <span
      class="badge event-badge"
      :class="`is-${store.eventStatus}`"
      :title="store.eventsError ?? '任务事件订阅状态'"
    >
      {{ eventLabel(store.eventStatus) }}
    </span>
    <span class="badge sdk-badge">SDK {{ store.projectInfo?.sdkVersion ?? "—" }}</span>
  </div>
</template>
