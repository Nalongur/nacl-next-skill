// @vitest-environment happy-dom
import {createApp,nextTick} from "vue";
import {afterEach,expect,it,vi} from "vitest";
import HostPreferences from "../src/components/HostPreferences.vue";
let app:ReturnType<typeof createApp>;let root:HTMLDivElement;
afterEach(()=>{app?.unmount();root?.remove()});
it("loads preferences, validates and saves edited values",async()=>{
 root=document.createElement("div");document.body.appendChild(root);
 const load=vi.fn().mockResolvedValue({ok:true,value:{schemaVersion:1,defaultMemoryMb:4096,defaultWindowWidth:1280,defaultWindowHeight:720}});
 const save=vi.fn().mockResolvedValue({ok:true,value:{schemaVersion:1,defaultMemoryMb:6144,defaultWindowWidth:1280,defaultWindowHeight:720}});
 app=createApp(HostPreferences,{actions:{load,save}});app.mount(root);await Promise.resolve();await nextTick();
 const el=root.querySelector('[name="defaultMemoryMb"]') as HTMLInputElement;el.value="6144";el.dispatchEvent(new Event("input",{bubbles:true}));
 root.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await nextTick();await Promise.resolve();await nextTick();
 expect(save).toHaveBeenCalledWith({preferences:{schemaVersion:1,defaultMemoryMb:6144,defaultWindowWidth:1280,defaultWindowHeight:720}});expect(root.textContent).toContain("已保存");
});
it("does not save invalid or missing values and reports validation",async()=>{
 root=document.createElement("div");document.body.appendChild(root);const load=vi.fn().mockResolvedValue({ok:true,value:{schemaVersion:1,defaultMemoryMb:4096,defaultWindowWidth:1280,defaultWindowHeight:720}});const save=vi.fn();
 app=createApp(HostPreferences,{actions:{load,save}});app.mount(root);await Promise.resolve();await nextTick();
 const el=root.querySelector('[name="defaultWindowWidth"]') as HTMLInputElement;el.value="";el.dispatchEvent(new Event("input",{bubbles:true}));root.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await nextTick();
 expect(save).not.toHaveBeenCalled();expect(root.textContent).toContain("854");
});
it("reports load failure without showing editable defaults",async()=>{
 root=document.createElement("div");document.body.appendChild(root);app=createApp(HostPreferences,{actions:{load:vi.fn().mockResolvedValue({ok:false,error:{message:"偏好文件损坏"}})}});app.mount(root);await Promise.resolve();await nextTick();
 expect(root.textContent).toContain("偏好文件损坏");expect(root.querySelector("form")).toBeNull();
});
it("keeps the draft and shows a failed save",async()=>{
 root=document.createElement("div");document.body.appendChild(root);const load=vi.fn().mockResolvedValue({ok:true,value:{schemaVersion:1,defaultMemoryMb:4096,defaultWindowWidth:1280,defaultWindowHeight:720}});const save=vi.fn().mockResolvedValue({ok:false,error:{message:"写入失败"}});
 app=createApp(HostPreferences,{actions:{load,save}});app.mount(root);await Promise.resolve();await nextTick();const el=root.querySelector('[name="defaultMemoryMb"]') as HTMLInputElement;el.value="6144";el.dispatchEvent(new Event("input",{bubbles:true}));root.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await Promise.resolve();await nextTick();
 expect(root.textContent).toContain("写入失败");expect(el.value).toBe("6144");expect(root.textContent).not.toContain("已保存");
 const reload=root.querySelector('.ghost-button') as HTMLButtonElement;expect(reload.disabled).toBe(false);expect(reload.textContent).toContain("放弃修改并重新读取");
 load.mockResolvedValueOnce({ok:false,error:{message:"读取失败"}});reload.click();await Promise.resolve();await nextTick();expect(el.value).toBe("6144");expect(root.textContent).toContain("读取失败");
 reload.click();await Promise.resolve();await nextTick();expect(el.value).toBe("4096");expect(root.textContent).not.toContain("有未保存修改");
});
