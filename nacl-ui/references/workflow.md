# L1/L2 修改模式

页面是一个受校验的 JSON 文档；固定渲染器只认识注册表中的组件、槽位、绑定、动作和参数。下面的示例都从生成工程的 `src/page.json` 出发。

## L1：主题

只改 `theme`，不碰区块：

```json
{
  "theme": {
    "accent": "#4f8cff",
    "density": "compact",
    "radius": 8,
    "font": "system",
    "colorScheme": "dark"
  }
}
```

允许值：`accent` 为 `#rrggbb`；`density` 为 `comfortable`/`compact`；`radius` 为 0–24；`font` 为 `system`/`serif`/`mono`；`colorScheme` 固定 `dark`。改完运行 `validate` 和 `build`。

## L2：布局

页面 `layout` 决定槽位集合：

| 布局 | 槽位 |
| --- | --- |
| `nacl` | `nav` / `main` / `aside`；区块另指定 `page` |
| `sidebar` | `nav` / `main` / `aside` |
| `studio` | `top` / `left` / `center` / `bottom` / `right` |

切换布局时更新 `layout`，并检查各区块的 `slot` 是否符合目标布局和组件注册槽位；sidebar/studio 的同一槽位、nacl 的同页、同槽位、同渲染分组内按 `blocks` 数组排序；nacl 的共享实例列表优先显示，首页身份组件统一放在“管理身份”，实例页 Java 与概览分别显示。还要把 `nacl.project.json` 的 `layout` 和 `template.layout` 改成同一值，否则页面契约会报 `project/layout-mismatch`。`generation.json.layout` 只是生成时的基线记录，不要求跟随；`check` 允许布局定制，但模式/适配器变化仍需重新生成。三套布局都要求实例、启动、任务、日志、详情、Java 六个核心组件。示例（B 模式，从 sidebar 改为 studio）：

```json
{
  "layout": "studio",
  "blocks": [
    { "id": "launch",   "slot": "top",    "component": "LaunchPanel" },
    { "id": "local",    "slot": "left",   "component": "LocalProfiles" },
    { "id": "instances","slot": "left",   "component": "InstanceList" },
    { "id": "tasks",    "slot": "center", "component": "TaskMonitor" },
    { "id": "logs",     "slot": "bottom", "component": "LogViewer" },
    { "id": "details",  "slot": "right",  "component": "InstanceDetails" },
    { "id": "java",     "slot": "right",  "component": "JavaPanel" }
  ]
}
```

上例省略了绑定/动作/参数；实际修改时保留原区块的 `bindings`、`actions`、`params`，只改 `slot`（必要时改数组顺序）。组件不能放入其注册槽位之外的区域。

`nacl` 页面使用 `navigationVersion: 1`，每个区块的 `page` 选 `home`、`instances`、`logs` 或 `settings`，例如在保留原绑定和动作的前提下，将日志区块设为 `{"id":"logs","component":"LogViewer","slot":"main","page":"logs"}`。实例列表位于 `instances` 的 `nav` 时，由首页与实例页共享同一个列表；实例页的 JavaPanel 显示在 Java 子页，InstanceSettings 显示在“内存与窗口”子页；配置了 `saveAdvanced` 动作时，同一组件还提供“高级”子页，其余主/侧区块显示在概览。改变归属以实际注册槽位为准。转入 `nacl` 时添加 `navigationVersion: 1` 并给全部区块指定 `page`；转出时删除 `navigationVersion` 和各区块的 `page`，同时按目标布局重设槽位。修改后运行 `validate` 与 `check`。

## L2：组件参数

参数只影响既有组件的展示/行为开关，不能引入新能力。常见示例：

```json
{ "component": "TaskMonitor", "params": { "maxItems": 4, "showSubscription": false } }
{ "component": "LogViewer",   "params": { "autoLoadFirst": true, "visibleLines": 40 } }
{ "component": "LaunchPanel", "params": { "emphasis": "hero", "showJava": true } }
{ "component": "InstanceList","params": { "compact": true, "allowDelete": false } }
```

`maxItems` 范围 1–50；`visibleLines` 范围 20–500；`emphasis` 为 `standard`/`hero`；其余参数为布尔。完整清单见 `registry.generated.md`。

## L2：动作接线

动作 key 和动作 id 都由组件固定；页面只能把该 key 接到该 id。不要把 `launch.start` 接到别的入口，也不能写命令名。需要新增动作时先按能力缺口处理。

## 页面没有通用条件表达式

页面 Schema 没有任意条件字段，也没有运行时脚本。模板源里的 `modes` 只用于生成时裁剪，生成后的 `src/page.json` 不含 `modes`。显示差异只能用既有组件的参数（如 `allowCreate`）和模式装配表达；需要更复杂条件时报告缺口。

## 固定任务示例

### T1 主题

1. 改 `theme` 的 accent/density/radius/font。
2. 可选改 `LaunchPanel.emphasis`、`LogViewer.visibleLines` 等展示参数。
3. `validate` → `build`；确认组件集合、动作接线和模式未变。

### T2 布局

1. 选 `nacl`、`sidebar` 或 `studio`，按上表重映射所有区块槽位；转入或转出 `nacl` 时同步处理 `navigationVersion` 和区块 `page`。
2. 保证六个核心组件和模式身份组件仍存在。
3. `validate` → `build`；检查布局结构、滚动和核心路径可达。

### T3 既有组件内交互

1. 只改既有组件的 `params` 或把动作 key 接回其唯一允许的 id。
2. 不新增动作/组件；不改变启动身份语义。
3. `validate` → `build`；用真实桌面验证状态、按钮启用/禁用和错误提示。

### T4 错误 JSON 修复

1. 运行 `validate`，按 `errors[]` 的 `file`、`path`、`code`、`hint` 定位。
2. 常见修复：
   - `page/unknown-component`：改回注册组件名。
   - `page/unknown-param` / `page/invalid-param`：删除参数或改回允许值/范围。
   - `page/action-mismatch` / `page/unknown-action-slot`：把动作接回组件规定的 key/id。
   - `page/binding-mismatch`：数据源必须与注册表一致。
   - `page/mode-mismatch`：页面 mode 改回 `nacl.project.json` 的模式。
   - `config/read-failed`：修 JSON 语法（逗号、引号、括号）。
3. 修到 `validate` 退出 0，再 `build`；不删除核心组件来绕过错误。

## 完成检查

- `validate` 退出 0，`errors` 为空。
- `check --project` 退出 0；`checks.modifiedFiles` 只包含有意修改的 JSON。
- `build` 退出 0，产物哈希已记录。
- 行为验收证据与修改范围对应；未验证项写明。
