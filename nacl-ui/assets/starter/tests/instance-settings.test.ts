// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import InstanceSettings from "../src/components/InstanceSettings.vue";

const instance = (id: string) => ({ id, name: id, memory: { minimumMb: 1024, maximumMb: 4096 }, display: { mode: "windowed", width: 1280, height: 720 }, advanced: { jvmArguments: "-Xfoo", gameArguments: "", debugLogging: false } }) as any;
let root: HTMLDivElement;
let app: ReturnType<typeof createApp>;
function mount(save = vi.fn().mockResolvedValue({ ok: true }), saveAdvanced = vi.fn().mockResolvedValue({ ok: true })) {
  root = document.createElement("div"); document.body.appendChild(root);
  const state = reactive({ instance: instance("one"), section: "settings" as "settings" | "advanced" });
  app = createApp(defineComponent({ setup: () => () => h(InstanceSettings, { instance: state.instance, section: state.section, actions: { save, saveAdvanced } }) }));
  app.mount(root);
  return { state, save, saveAdvanced };
}
function input(name: string, value: string) {
  const el = root.querySelector(`[name="${name}"]`) as HTMLInputElement;
  el.value = value; el.dispatchEvent(new Event("input", { bubbles: true }));
}
async function submit() { root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await nextTick(); await Promise.resolve(); await nextTick(); }
afterEach(() => { app?.unmount(); root?.remove(); });
it("saves valid settings for the displayed instance", async () => {
  const { save } = mount(); await nextTick(); input("minimumMb", "2048"); input("width", "1600"); await submit();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "one", minimumMb: 2048, width: 1600 }));
  expect(root.textContent).toContain("已保存");
});
it("rejects out of range and inverted values without saving", async () => {
  const { save } = mount(); await nextTick(); input("minimumMb", "511"); await submit(); expect(save).not.toHaveBeenCalled(); expect(root.textContent).toContain("512");
  input("minimumMb", "4097"); await submit(); expect(save).not.toHaveBeenCalled();
});
it("reports a save error and keeps the draft", async () => {
  mount(vi.fn().mockResolvedValue({ ok: false, error: { message: "写入失败" } })); await nextTick(); input("width", "1600"); await submit();
  expect(root.textContent).toContain("写入失败"); expect((root.querySelector('[name="width"]') as HTMLInputElement).value).toBe("1600");
});
it("keeps separate unsaved drafts when switching instances", async () => {
  const { state, save } = mount(); await nextTick(); input("width", "1600"); state.instance = instance("two"); await nextTick();
  expect((root.querySelector('[name="width"]') as HTMLInputElement).value).toBe("1280");
  state.instance = instance("one"); await nextTick(); expect((root.querySelector('[name="width"]') as HTMLInputElement).value).toBe("1600");
  await submit(); expect(save).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "one", width: 1600 }));
});

it("disables fields while a save is pending", async () => {
  let finish!: (value: any) => void;
  const save = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  mount(save); await nextTick(); input("width", "1600");
  root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await nextTick();
  expect((root.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  expect((root.querySelector('[name="mode"]') as HTMLSelectElement).disabled).toBe(true);
  finish({ ok: true }); await Promise.resolve(); await nextTick();
  expect((root.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
  expect(root.textContent).toContain("已保存");
});

it("saves advanced arguments while retaining a separate memory draft", async () => {
  const { state, saveAdvanced } = mount(); await nextTick();
  input("width", "1600"); state.section = "advanced"; await nextTick();
  input("jvmArguments", '-Dgreeting="你好"'); input("gameArguments", "--demo"); await submit();
  expect(saveAdvanced).toHaveBeenCalledWith({ instanceId: "one", jvmArguments: '-Dgreeting="你好"', gameArguments: "--demo" });
  state.section = "settings"; await nextTick();
  expect((root.querySelector('[name="width"]') as HTMLInputElement).value).toBe("1600");
  expect(root.textContent).toContain("未保存");
});

it("checks UTF-8 byte length and control characters for advanced arguments", async () => {
  const { state, saveAdvanced } = mount(); state.section = "advanced"; await nextTick();
  input("jvmArguments", "你".repeat(1365) + "a"); await submit(); expect(saveAdvanced).toHaveBeenCalledTimes(1);
  input("jvmArguments", "你".repeat(1365) + "ab"); await submit(); expect(saveAdvanced).toHaveBeenCalledTimes(1); expect(root.textContent).toContain("4096");
  input("jvmArguments", "ok\tbad"); await submit(); expect(saveAdvanced).toHaveBeenCalledTimes(1);
});
it("retains a failed advanced draft across instance switches", async () => {
  const fail = vi.fn().mockResolvedValue({ ok: false, error: { message: "写入失败" } });
  const { state } = mount(vi.fn(), fail); state.section = "advanced"; await nextTick();
  input("gameArguments", "--demo"); await submit(); expect(root.textContent).toContain("写入失败");
  state.instance = instance("two"); await nextTick(); expect((root.querySelector('[name="gameArguments"]') as HTMLTextAreaElement).value).toBe("");
  state.instance = instance("one"); await nextTick(); expect((root.querySelector('[name="gameArguments"]') as HTMLTextAreaElement).value).toBe("--demo");
});

it("keeps delayed save feedback on the section that initiated it", async () => {
  let finish!: (value: any) => void;
  const save = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { state } = mount(save); await nextTick(); input("width", "1600");
  root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await nextTick();
  state.section = "advanced"; await nextTick(); finish({ ok: true }); await Promise.resolve(); await nextTick();
  expect(root.textContent).not.toContain("已保存");
  state.section = "settings"; await nextTick(); expect(root.textContent).toContain("已保存");
});

it("explains that preflight does not validate argument quoting", async () => {
  const { state } = mount(); state.section = "advanced"; await nextTick();
  expect(root.textContent).toContain("启动检查不验证引号");
});

it("does not invent a quote parser at save time", async () => {
  const { state, saveAdvanced } = mount(); state.section = "advanced"; await nextTick();
  input("gameArguments", '"unfinished'); await submit();
  expect(saveAdvanced).toHaveBeenCalledWith(expect.objectContaining({ gameArguments: '"unfinished' }));
});
