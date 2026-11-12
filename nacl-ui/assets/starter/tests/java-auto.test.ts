// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import JavaPanel from "../src/components/JavaPanel.vue";
import { store } from "../src/state/store";
const inst = (id:string) => ({ id, java: {mode:"custom",path:`C:\\Java\\${id}.exe`} }) as any;
let root:HTMLDivElement; let app:ReturnType<typeof createApp>;
function mount(auto?: any) {
  root=document.createElement("div");document.body.appendChild(root);store.javaError=null;
  const state=reactive({instance:inst("one")});
  app=createApp(defineComponent({setup:()=>()=>h(JavaPanel,{instance:state.instance,detected:[],params:{},actions:{auto,detect:vi.fn()}})}));
  app.mount(root);return state;
}
async function clickAuto(){ const button=[...root.querySelectorAll("button")].find(e=>e.textContent?.includes("恢复自动选择"));expect(button).toBeDefined();button!.click();await nextTick();await Promise.resolve();await nextTick(); }
afterEach(()=>{app?.unmount();root?.remove()});
it("saves auto even without detected Java and does not claim a runtime exists",async()=>{const auto=vi.fn().mockResolvedValue({ok:true});mount(auto);await nextTick();expect(root.textContent).toContain("没有发现 Java");expect(root.textContent).toContain("手动：");await clickAuto();expect(auto).toHaveBeenCalledWith({instanceId:"one"});expect(root.textContent).toContain("实际可用性以启动检查为准");expect(root.textContent).toContain("没有发现 Java");});
it("shows save errors without claiming auto succeeded",async()=>{mount(vi.fn().mockResolvedValue({ok:false,error:{message:"写入失败"}}));await nextTick();await clickAuto();expect(root.textContent).toContain("写入失败");expect(root.textContent).not.toContain("已保存自动选择");});
it("keeps delayed feedback on the initiating instance",async()=>{let done!:(v:any)=>void;const state=mount(vi.fn().mockReturnValue(new Promise(r=>{done=r})));await nextTick();const pending=clickAuto();await nextTick();state.instance=inst("two");await nextTick();done({ok:true});await pending;await nextTick();expect(root.textContent).not.toContain("已保存自动选择");state.instance=inst("one");await nextTick();expect(root.textContent).toContain("已保存自动选择");});
it("does not add auto controls for older configurations",async()=>{mount();await nextTick();expect(root.textContent).not.toContain("恢复自动选择");});
it("clears old auto feedback when the same instance returns to manual Java",async()=>{
  root=document.createElement("div");document.body.appendChild(root);store.javaError=null;
  const state=reactive({instance:inst("one")});const runtime={path:"C:\\Java\\manual.exe",home:"C:\\Java",version:"21",majorVersion:21,architecture:"x64",vendor:"test",source:"manual",managed:false};
  const actions={detect:vi.fn(),auto:vi.fn().mockResolvedValue({ok:true}),set:vi.fn().mockResolvedValue({ok:true})};
  app=createApp(defineComponent({setup:()=>()=>h(JavaPanel,{instance:state.instance,detected:[runtime],params:{},actions})}));app.mount(root);await nextTick();
  await clickAuto();state.instance={id:"one",java:{mode:"auto"}} as any;await nextTick();
  const button=[...root.querySelectorAll("button")].find(e=>e.textContent?.includes("设为该实例 Java"));expect(button).toBeDefined();button!.click();await nextTick();await Promise.resolve();await nextTick();
  expect(actions.set).toHaveBeenCalled();expect(root.textContent).not.toContain("已保存自动选择");
});
it("keeps an actual Java detection error visible after saving auto",async()=>{
  mount(vi.fn().mockResolvedValue({ok:true}));store.javaError={code:"java/not-found",message:"未发现兼容运行时",retryable:false};await nextTick();
  await clickAuto();expect(root.textContent).toContain("java/not-found");expect(root.textContent).toContain("未发现兼容运行时");store.javaError=null;
});
