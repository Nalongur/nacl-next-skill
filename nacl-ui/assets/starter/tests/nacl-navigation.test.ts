// @vitest-environment happy-dom
import { createRenderer, nextTick, ssrContextKey } from "vue";
import { expect, it, vi } from "vitest";

let mounts = 0;
vi.mock("../src/renderer/BlockHost.vue", async () => {
  const vue = await import("vue");
  return { default: vue.defineComponent({
    props: ["block"],
    setup(props) {
      vue.onMounted(() => mounts++);
      return () => vue.h("div", { "data-block": props.block.id }, props.block.component);
    },
  }) };
});
import PageRenderer from "../src/renderer/PageRenderer.vue";
import { resetStore, store } from "../src/state/store";
import { MICROSOFT_ACCOUNT } from "./helpers/fake-adapter";

const node = (type: string): any => ({ type, props: {}, children: [], style: { display: "" } });
const renderer = createRenderer<any, any>({
  createElement: node,
  createText: (text) => ({ ...node("#text"), text }),
  createComment: (text) => ({ ...node("#comment"), text }),
  setText: (element, text) => { element.text = text; },
  setElementText: (element, text) => { element.text = text; element.children = []; },
  parentNode: (element) => element.parent ?? null,
  nextSibling: () => null,
  insert: (element, parent, anchor) => {
    element.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(element);
    else parent.children.splice(index, 0, element);
  },
  remove: (element) => {
    const index = element.parent?.children.indexOf(element);
    if (index >= 0) element.parent.children.splice(index, 1);
  },
  patchProp: (element, key, _old, value) => {
    element.props[key] = value;
    if (key === "style") Object.assign(element.style, value);
  },
});
const all = (element: any): any[] => [element, ...element.children.flatMap(all)];
function button(root: any, label: string) {
  const found = all(root).find((element) => element.type === "button" && element.text === label);
  if (!found) throw Error(`missing ${label}`);
  return found;
}
function render(blocks: object[]) {
  const root = node("root");
  const app = renderer.createApp(PageRenderer, { page: { layout: "nacl", title: "NaCL", blocks }, controller: {} });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);
  return root;
}

it("instance Java subpage keeps instance navigation and components mounted", async () => {
  mounts = 0;
  const root = render([
    { id: "i", page: "instances", slot: "nav", component: "InstanceList" },
    { id: "d", page: "instances", slot: "main", component: "InstanceDetails" },
    { id: "j", page: "instances", slot: "aside", component: "JavaPanel" },
  ]);
  const initial = mounts;
  button(root, "实例").props.onClick();
  await nextTick();
  expect(all(root).some((element) => element.type === "h2" && element.text === "实例")).toBe(true);
  button(root, "Java 运行时").props.onClick();
  await nextTick();
  expect(button(root, "实例").props["aria-current"]).toBe("page");
  expect(button(root, "Java 运行时").props["aria-current"]).toBe("page");
  expect(mounts).toBe(initial);
  expect(all(root).find((element) => element.props["data-block"] === "j").style.display).not.toBe("none");
});

it("does not advertise an empty Java subpage when Java is assigned elsewhere", () => {
  const root = render([{ id: "j", page: "settings", slot: "aside", component: "JavaPanel" }]);
  expect(all(root).some((element) => element.type === "button" && element.text === "Java 运行时")).toBe(false);
});

it("does not show settings without a settings block", () => {
  const root = render([]);
  expect(all(root).some((element) => element.type === "button" && element.text === "设置")).toBe(false);
});

it("opens Java directly when the instance page has no overview blocks", async () => {
  const root = render([
    { id: "i", page: "instances", slot: "nav", component: "InstanceList" },
    { id: "j", page: "instances", slot: "main", component: "JavaPanel" },
  ]);
  button(root, "实例").props.onClick();
  await nextTick();
  expect(all(root).some((element) => element.type === "button" && element.text === "概览")).toBe(false);
  expect(all(root).find((element) => element.props["data-block"] === "j").style.display).not.toBe("none");
});

it("shares one instance list between home and instances", async () => {
  const root = render([
    { id: "i", page: "instances", slot: "nav", component: "InstanceList" },
    { id: "d", page: "instances", slot: "main", component: "InstanceDetails" },
  ]);
  const list = () => all(root).filter((element) => element.props["data-block"] === "i");
  expect(list()).toHaveLength(1);
  expect(list()[0].parent.style.display).not.toBe("none");
  button(root, "实例").props.onClick();
  await nextTick();
  expect(list()).toHaveLength(1);
  expect(list()[0].parent.style.display).not.toBe("none");
});

it("identity summary follows the effective local profile without implying Microsoft login", async () => {
  resetStore();
  store.mode = "b";
  store.profiles = [{ id: "p1", username: "Steve_01" }, { id: "p2", username: "Alex_02" }] as any;
  store.selectedProfileId = "p1";
  const root = render([]);
  expect(all(root).some((element) => element.text === "Steve_01")).toBe(true);
  store.selectedProfileId = "p2";
  await nextTick();
  expect(all(root).some((element) => element.text === "Alex_02")).toBe(true);
  expect(all(root).some((element) => element.text === "本地档案 · 未官方验证")).toBe(true);
  resetStore();
});

it("identity summary respects explicit D-mode identity selection", async () => {
  resetStore();
  store.mode = "d";
  store.profiles = [{ id: "p1", username: "Steve_01" }] as any;
  store.selectedProfileId = "p1";
  store.microsoft.account = MICROSOFT_ACCOUNT;
  const root = render([]);
  expect(all(root).some((element) => element.text === "尚未选择身份")).toBe(true);
  store.selectedIdentityKind = "local";
  await nextTick();
  expect(all(root).some((element) => element.text === "Steve_01")).toBe(true);
  store.selectedIdentityKind = "microsoft";
  await nextTick();
  expect(all(root).some((element) => element.text === "ProbeGamer")).toBe(true);
  store.microsoft.account = null;
  await nextTick();
  expect(all(root).some((element) => element.text === "尚未选择身份")).toBe(true);
  resetStore();
});

it("keeps a customized home instance list outside identity controls", () => {
  const root = render([
    { id: "i", page: "home", slot: "nav", component: "InstanceList" },
    { id: "p", page: "home", slot: "nav", component: "LocalProfiles" },
  ]);
  const list = all(root).filter((element) => element.props["data-block"] === "i");
  expect(list).toHaveLength(1);
  let parent = list[0].parent;
  while (parent) {
    expect(parent.type).not.toBe("details");
    parent = parent.parent;
  }
});

it("identity summary in A mode reflects only Microsoft account state", async () => {
  resetStore();
  store.mode = "a";
  store.profiles = [{ id: "p1", username: "Steve_01" }] as any;
  store.selectedProfileId = "p1";
  const root = render([]);
  expect(all(root).some((element) => element.text === "尚未选择身份")).toBe(true);
  store.microsoft.account = MICROSOFT_ACCOUNT;
  await nextTick();
  expect(all(root).some((element) => element.text === "ProbeGamer")).toBe(true);
  resetStore();
});

it("shows advanced only when its action is configured and reuses the settings component", async () => {
  const root = render([{ id: "s", page: "instances", slot: "aside", component: "InstanceSettings", actions: { save: "instances.update-settings", saveAdvanced: "instances.update-advanced" } }]);
  button(root, "实例").props.onClick(); await nextTick();
  button(root, "高级").props.onClick(); await nextTick();
  expect(button(root, "高级").props["aria-current"]).toBe("page");
  expect(all(root).filter((element) => element.props["data-block"] === "s")).toHaveLength(1);
  expect(all(root).find((element) => element.props["data-block"] === "s").style.display).not.toBe("none");
});
