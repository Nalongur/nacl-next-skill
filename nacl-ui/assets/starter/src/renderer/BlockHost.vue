<script setup lang="ts">
import { computed, inject } from "vue";
import type { Component } from "vue";
import type { PageBlock } from "../contract/page";
import { ACTION_CONTROLLER, type PageAction, type PageActions } from "./context";
import { resolveBinding } from "./bindings";
import { store } from "../state/store";
import InstanceList from "../components/InstanceList.vue";
import HostPreferences from "../components/HostPreferences.vue";
import InstanceDetails from "../components/InstanceDetails.vue";
import InstanceSettings from "../components/InstanceSettings.vue";
import JavaPanel from "../components/JavaPanel.vue";
import LocalProfiles from "../components/LocalProfiles.vue";
import MicrosoftIdentity from "../components/MicrosoftIdentity.vue";
import IdentityPicker from "../components/IdentityPicker.vue";
import LaunchPanel from "../components/LaunchPanel.vue";
import TaskMonitor from "../components/TaskMonitor.vue";
import LogViewer from "../components/LogViewer.vue";
import StatePanel from "../components/StatePanel.vue";

const props = defineProps<{ block: PageBlock; instanceSection?: "settings" | "advanced" }>();
const controller = inject(ACTION_CONTROLLER);

const componentMap: Record<string, Component> = {
  HostPreferences,
  InstanceList,
  InstanceDetails,
  InstanceSettings,
  JavaPanel,
  LocalProfiles,
  MicrosoftIdentity,
  IdentityPicker,
  LaunchPanel,
  TaskMonitor,
  LogViewer,
};

const current = computed(() => componentMap[props.block.component]);
const params = computed<Record<string, string | number | boolean>>(
  () => props.block.params ?? {},
);

function bound(key: string): any {
  const path = props.block.bindings?.[key];
  return path ? resolveBinding(path) : undefined;
}

function action(key: string): PageAction | undefined {
  const actionId = props.block.actions?.[key];
  if (!actionId || !controller) return undefined;
  return (payload = {}) => controller.run(actionId, payload);
}

function actionMap(keys: Record<string, string>): PageActions {
  const result: PageActions = {};
  for (const [propKey, actionKey] of Object.entries(keys)) {
    result[propKey] = action(actionKey);
  }
  return result;
}

const componentProps = computed<Record<string, unknown>>(() => {
  switch (props.block.component) {
    case "HostPreferences":
      return { actions: actionMap({ load: "load", save: "save" }) };
    case "InstanceList":
      return {
        items: bound("items") ?? [],
        deleted: bound("deleted") ?? [],
        selectedId: bound("selected") ?? null,
        params: params.value,
        actions: actionMap({
          select: "select",
          refresh: "refresh",
          create: "create",
          duplicate: "duplicate",
          remove: "delete",
          restore: "restore",
          purge: "purge",
        }),
      };
    case "InstanceDetails":
      return {
        instance: bound("instance") ?? null,
        params: params.value,
        actions: actionMap({ refresh: "refresh", rename: "rename" }),
      };
    case "InstanceSettings":
      return { instance: bound("instance") ?? null, section: props.instanceSection ?? "settings", actions: actionMap({ save: "save", saveAdvanced: "saveAdvanced" }) };
    case "JavaPanel":
      return {
        instance: bound("instance") ?? null,
        detected: bound("detected") ?? [],
        params: params.value,
        actions: actionMap({ detect: "detect", set: "set", inspect: "inspect", auto: "auto" }),
      };
    case "LocalProfiles":
      return {
        items: bound("items") ?? [],
        selectedId: bound("selected") ?? null,
        params: params.value,
        actions: actionMap({
          select: "select",
          refresh: "refresh",
          create: "create",
          rename: "rename",
          remove: "delete",
        }),
      };
    case "MicrosoftIdentity":
      return {
        account: bound("account") ?? null,
        params: params.value,
        actions: actionMap({
          refresh: "refresh",
          beginLogin: "beginLogin",
          completeLogin: "completeLogin",
          cancelLogin: "cancelLogin",
          logout: "logout",
        }),
      };
    case "IdentityPicker":
      return {
        account: bound("account") ?? null,
        profiles: bound("profiles") ?? [],
        selectedKind: bound("selectedKind") ?? null,
        effective: bound("effective") ?? null,
        params: params.value,
        actions: actionMap({ refresh: "refresh", select: "select" }),
      };
    case "LaunchPanel":
      return {
        naclHome: store.layout === "nacl" && props.block.page === "home",
        instance: bound("instance") ?? null,
        identity: bound("identity") ?? null,
        preview: bound("preview") ?? null,
        mode: store.mode,
        previewBusy: store.previewBusy,
        launchBusy: store.launchBusy,
        launchLast: store.launchLast,
        params: params.value,
        actions: actionMap({ resolve: "resolve", start: "start", viewLog: "viewLog" }),
      };
    case "TaskMonitor":
      return {
        tasks: bound("tasks") ?? [],
        subscription: bound("subscription") ?? {
          status: store.eventStatus,
          error: store.eventsError,
          polling: store.taskPolling,
        },
        params: params.value,
        actions: actionMap({
          refresh: "refresh",
          status: "status",
          resubscribe: "resubscribe",
        }),
      };
    case "LogViewer":
      return {
        items: bound("items") ?? [],
        selected: bound("selected") ?? null,
        content: bound("content") ?? "",
        loading: store.logsLoading,
        error: store.logError,
        params: params.value,
        actions: actionMap({ refresh: "refresh", read: "read", select: "select" }),
      };
    default:
      return {};
  }
});
</script>

<template>
  <section
    class="block"
    :class="[`block-${block.component}`, { 'block-compact': params.compact === true }]"
  >
    <header v-if="block.title" class="block-head">
      <h2>{{ block.component === "InstanceSettings" && instanceSection === "advanced" ? "高级参数" : block.title }}</h2>
      <span class="block-id">{{ block.id }}</span>
    </header>
    <component :is="current" v-if="current" v-bind="componentProps" />
    <StatePanel
      v-else
      tone="error"
      title="未知组件"
      :detail="`渲染器没有注册 ${block.component}；页面配置应在启动前被拒绝。`"
    />
  </section>
</template>
