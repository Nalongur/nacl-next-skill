// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { expect, it } from "vitest";
import BlockHost from "../src/renderer/BlockHost.vue";
import { ACTION_CONTROLLER } from "../src/renderer/context";

it("labels the advanced section independently from the memory section", async () => {
  const state = reactive({ section: "settings" as "settings" | "advanced" });
  const block = { id: "instance-settings", component: "InstanceSettings", slot: "aside", title: "内存与窗口", bindings: {}, actions: {} } as any;
  const root = document.createElement("div"); document.body.appendChild(root);
  const app = createApp(defineComponent({ setup: () => () => h(BlockHost, { block, instanceSection: state.section }) }));
  app.provide(ACTION_CONTROLLER, { run: async () => ({ ok: true, value: undefined }), bootstrap: async () => ({ ok: true }), dispose: () => {} });
  try {
    app.mount(root); expect(root.querySelector("h2")?.textContent).toBe("内存与窗口");
    state.section = "advanced"; await nextTick(); expect(root.querySelector("h2")?.textContent).toBe("高级参数");
    state.section = "settings"; await nextTick(); expect(root.querySelector("h2")?.textContent).toBe("内存与窗口");
  } finally { app.unmount(); root.remove(); }
});
