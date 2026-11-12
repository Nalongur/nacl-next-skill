---
name: nacl-ui
description: Build or customize a NaCL Next launcher UI by editing validated JSON pages on a fixed starter: L1 themes, L2 layout/interaction, generation, validation, preview, build and acceptance. Not for SDK/Provider development.
---

# NaCL UI Skill

用固定 starter、固定 Vue 渲染器和已注册组件，按 A/B/D 模式生成并定制 NaCL Next 启动器界面。普通 UI 工作只改主题、页面 JSON、布局、既有组件参数与动作接线；不重写 Rust、认证、Tauri IPC 或固定组件。

## 开始前

- 整个 `nacl-ui/` 目录是可搬移的分发单元。命令都在其根目录执行；生成工程只依赖固定 Git SDK、工程内契约和锁文件，不读取任何原始仓库或私有目录。
- 先确认认证模式和需求。A 仅正版、B 仅本地、D 共存；需求未明确且会影响设计时才询问，能独立推进的部分先继续。模式语义见 [`references/modes.md`](references/modes.md)。
- 不提供游戏文件、版本清单、下载源或自动修复；不操作真实 Microsoft 账号；L3（新增 Vue 组件）未开放。边界见 [`references/boundaries.md`](references/boundaries.md)。

## 按需读取

| 需要什么 | 读取 |
| --- | --- |
| 组件、槽位、绑定、动作、参数、模板 | [`references/registry.generated.md`](references/registry.generated.md) |
| 错误码与修复方向 | [`references/errors.generated.md`](references/errors.generated.md) |
| 版本、SDK Git 来源与契约、锁定的依赖 | [`references/compatibility.generated.md`](references/compatibility.generated.md) |
| L1/L2 修改模式与固定任务示例 | [`references/workflow.md`](references/workflow.md) |
| NaCL 原版风格模板、能力边界与暖橙定制 | [`references/nacl-template.md`](references/nacl-template.md) |
| A/B/D 身份、配置与能力边界 | [`references/modes.md`](references/modes.md) |
| 工具失败、恢复、预览/构建环境 | [`references/troubleshooting.md`](references/troubleshooting.md) |

先运行 `inspect` 获取机器可读的注册表；不要凭猜测使用组件、绑定、动作或参数。不要为了普通 UI 修改读取 SDK Rust 源码或固定渲染器实现。

## 工作流

1. **理解需求与模式。** 写出目标、不能改变的行为、期望身份分支。模式会影响可用组件/动作，先确定 A/B/D。
   完成标准：需求能映射到主题、页面区块、参数或既有动作之一；映射不到时先进入能力缺口流程。

2. **检查兼容与能力。** 运行 `python scripts/nacl_ui.py inspect`，并按需读注册表参考；确认目标组件、槽位、绑定和动作存在。
   完成标准：每个拟用组件、绑定、动作、参数都在注册表中；不存在的能力已明确列出。

3. **创建工程。** 从同一 starter 生成，不手工复制或重写固定文件：
   ```powershell
   python scripts/nacl_ui.py create --layout nacl --mode b --output "<新目录>"
   ```
   `--layout` 为 `sidebar`/`studio`/`nacl`，`--mode` 为 `a`/`b`/`d`，`--adapter` 默认 `ipc`；`mock` 只用于布局预览。`nacl` 当前为原版导航增量，尚未完成原版界面还原；完整主线见 [README](README.md)。
   完成标准：命令退出 0，输出目录含 `nacl.project.json`、`src/page.json`、`sdk/`、`src-tauri/`，且创建器已校验 9 组合 + 10 个拒绝用例。

4. **局部修改 JSON。** 只改生成工程的 `src/page.json`（必要时改 `nacl.project.json` 的标题/窗口），保持固定契约：
   - L1：`theme` 的 `accent`/`density`/`radius`/`font`/`colorScheme`。
   - L2：`layout`、区块 `slot`/顺序、既有组件 `params`、既有绑定/动作接线。切换布局时同时把
     `nacl.project.json` 的 `layout` 与 `template.layout` 改成同一值；`generation.json.layout`
     只是生成基线，不要求跟随（`check` 允许布局定制）。
   - 不写 JavaScript/表达式/HTML/命令名，不改 Schema、注册表、固定组件、Rust/IPC。
     如需改应用标题或窗口尺寸，必须同时同步 `nacl.project.json` 与 `src-tauri/tauri.conf.json`，
     否则 `validate` 会报 `project/app-metadata-mismatch`/`project/window-mismatch`。
   完成标准：变更只落在一个或少数 JSON 字段，未删除布局必需核心组件和模式身份组件。

5. **校验。** 运行：
   ```powershell
   python scripts/nacl_ui.py validate --project "<工程>"
   ```
   失败时读取输出中的 `file`、`path`、`code`、`hint`，只修对应字段。不要通过删除核心组件、降低检查或改 Schema 让校验通过。
   完成标准：退出码 0、`errors` 为空。

6. **预览。** 布局预览必须使用 mock，且 mock 在窗口内显著标注；mock 不是后端证据。
   ```powershell
   python scripts/nacl_ui.py create --layout sidebar --mode b --adapter mock --output "<预览工程>"
   # 把定制后的 src/page.json 复制到预览工程，再：
   python scripts/nacl_ui.py preview --project "<预览工程>" --check
   ```
   对 IPC 工程可显式加 `--mock`，但这只用于视觉检查。预览需要已安装 `node_modules`。
   完成标准：服务器就绪且页面可打开；页面徽标显示 MOCK。

7. **独立构建。** 运行：
   ```powershell
   python scripts/nacl_ui.py build --project "<工程>"
   ```
   默认执行前端构建与 Tauri 桌面构建，产出 `target/release/nacl-next-s1-shell.exe`；`--frontend-only` 只构建前端。构建前会再次校验配置。
   完成标准：退出 0，EXE 与 `dist/index.html` 存在，输出摘要含产物 SHA-256。

8. **行为验收。** 用真实桌面 EXE 验证任务要求的行为（实例、Java、任务、日志、错误、身份分支）。B/D 的本地分支与 A/D 的正版分支分开记录；Mock、单元测试和构建成功都不能替代真实 IPC/GUI 证据。真实账号与真实 Minecraft 启动不在本 Skill 默认授权内。
   完成标准：每个被修改的行为都有对应证据；未验证项明确写出。

9. **报告。** 列出修改文件、实际命令与退出码、校验/构建/行为结果、未验证项、剩余能力缺口。不要宣称未执行的真实账号或游戏结果。

## 工具与退出码

所有命令向 stdout 输出一个 JSON 对象，进度写 stderr。stdout/stderr 固定为 UTF-8（不依赖
`PYTHONUTF8` 或系统代码页）；调用方必须按 UTF-8 解码，不要用忽略错误的宽松解码。

| 命令 | 用途 |
| --- | --- |
| `create` | 从固定 starter 生成工程；拒绝非空目标；目录提交遇到瞬时占用时有界重试 |
| `check --project` | 兼容/元数据/快照/页面一致性检查；任何生成文件缺失都退出 2；L1/L2 正常修改只列在 `modifiedFiles`；`--self` 检查分发完整性 |
| `validate` | 页面与工程配置校验，返回文件/路径/错误码/修复提示；非对象 JSON 根报 `config/invalid-root` |
| `inspect` | 注册布局、组件、绑定、动作、参数与模板 |
| `preview` | mock 布局预览；`--check` 就绪后退出 |
| `build` | 前端或桌面构建 |
| `verify` | 完整验收（依赖、配置、前端测试、类型、构建、Rust、桌面）并写证据 |
| `matrix` | 指定布局 × A/B/D 生成与验收矩阵 |
| `self-check` / `version` | 分发完整性与版本 |

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 构建/验收步骤失败 |
| 2 | 参数、配置、兼容或校验错误 |
| 3 | 缺少环境或依赖（Node/npm/cargo、node_modules） |
| 4 | 目标或证据目录冲突，拒绝覆盖 |

失败后先读 `error.code`、`errors[]`、日志路径；修好同一命令再重跑。不要用删除文件或换目录来掩盖失败。

## 能力缺口

现有组件/动作表达不了需求时：说明缺口、影响和可选替代（调整需求、用已有组件近似、另开显式扩展任务），让用户决定。不要自行新增 Vue 组件、隐藏需求、伪造能力或启用 L3。Provider 开发是显式扩展任务，不属于本 Skill 默认流程。
