# NaCL UI Skill 分发包

这是可独立复制、独立运行的 NaCL Next UI Skill。它包含固定 starter、三套 JSON 页面、
固定 Git 版本的 SDK 与 IPC 壳、页面 Schema、确定性工具和按需参考。生成工程只依赖本目录
内容与公开 npm/Cargo 依赖，不读取任何原始仓库或私有目录。

复制整个 `nacl-ui/` 目录即可使用；不要只复制其中一部分。

## 快速开始

需要 PowerShell 7、Python 3、Node/npm、Rust/MSVC 和 Windows WebView2。以下从 `nacl-ui` 目录运行；目标目录须不存在或为空：

```powershell
$project = Join-Path $env:TEMP 'nacl-my-launcher'
python scripts/nacl_ui.py create --layout nacl --mode b --output $project
# 示例：只调整页面主题；也可以使用编辑器修改 src/page.json
$pagePath = Join-Path $project 'src/page.json'
$page = Get-Content -Raw -Encoding utf8 $pagePath | ConvertFrom-Json
$page.theme.accent = '#4f8cff'
$page | ConvertTo-Json -Depth 40 | Set-Content -Encoding utf8 $pagePath
python scripts/nacl_ui.py validate --project $project
python scripts/nacl_ui.py check --project $project
python scripts/nacl_ui.py build --project $project
& "$project/target/release/nacl-next-s1-shell.exe"
```

`nacl` 的原版风格导航、现有操作、定制边界和暖橙样例见 [NaCL 模板参考](references/nacl-template.md)；sidebar/studio 为其他模板。

A/D 的 Client ID 由开发者/发行者配置；B 不需要 ID。真实 Microsoft 登录和真实 Minecraft
启动不在默认验证范围。

## 工具

| 命令 | 说明 |
| --- | --- |
| `create --layout sidebar|studio|nacl --mode a|b|d --output <dir>` | 生成工程；`nacl` 为原版风格导航模板 |
| `check --project <dir>` | 兼容、元数据、SDK Git 来源与契约和页面一致性；生成文件缺失即失败 |
| `check --self` / `self-check` | 分发哈希完整性 |
| `validate --project <dir>` | 页面/项目校验，输出文件、JSON 路径、错误码和修复提示 |
| `inspect` | 注册布局、组件、绑定、动作、参数和模板 |
| `preview --project <dir> [--check] [--mock]` | mock 布局预览；需先安装 `node_modules` |
| `build --project <dir> [--frontend-only] [--fresh]` | 前端或桌面构建 |
| `verify --project <dir> --evidence <dir>` | 完整验收并写证据 |
| `matrix --base <dir> --evidence <dir>` | 指定布局 × A/B/D 生成与验收 |
| `version` | 分发包版本与 SDK Git 来源与契约 |

退出码：0 成功；1 构建/验收失败；2 参数/配置/兼容/校验错误；3 缺少环境或依赖；
4 目标/证据目录冲突。stdout 始终是一个 JSON 对象，进度在 stderr。
stdout/stderr 固定为 UTF-8，不依赖 `PYTHONUTF8` 或 Windows 代码页；调用方按 UTF-8
解码。`check` 将任何缺失的生成文件视为错误（退出 2），正常 L1/L2 修改只列入
`modifiedFiles`。

## 目录

| 路径 | 内容 |
| --- | --- |
| `SKILL.md` | Agent 工作流与边界 |
| `references/` | 注册表、错误、兼容、模式、故障参考 |
| `assets/starter/` | 固定 Vue 渲染器、组件、状态/动作协调与前端测试 |
| `assets/templates/` | `sidebar.json` / `studio.json` / `nacl.json` 页面源 |
| `assets/sdk/` | `nacl-next-sdk` 生成的 TS 契约 |
| `assets/shell/` | IPC 壳源码、契约与 `Cargo.lock` |
| `assets/compatibility.json` | 模板/SDK/npm/Cargo 兼容版本 |
| `schemas/` | `page.schema.json` / `project.schema.json` |
| `scripts/` | `nacl_ui.py` 与共享实现 |
| `tests/` | 工具边界、恢复与分发完整性测试 |
| `DISTRIBUTION.json` | 来源版本、输入哈希、逐文件哈希 |

## 定制流程

1. `create` 生成 A/B/D 工程。
2. 在 `src/page.json` 修改 L1 主题或受支持的 L2 区块、参数、动作接线；切换布局时还要同步修改 `nacl.project.json` 的 `layout` 与 `template.layout`，并按 `references/workflow.md` 处理页面归属。固定渲染器、Rust、IPC、Schema 和契约不改。
3. `validate` → `build`，必要时用 mock 工程 `preview`。
4. 真实桌面验证行为；Mock、构建成功和单元测试分别记录，不互相替代。
5. 完整验收用 `verify`，证据目录必须为空。

详细步骤见 `SKILL.md` 和 `references/workflow.md`。

## 版本与来源

`DISTRIBUTION.json` 记录分发包版本、模板/Schema 版本、SDK 版本、Git 来源与契约 SHA-256、
组装输入哈希和逐文件哈希。`self-check` 会重新计算关键文件哈希；任何漂移都会失败并
列出文件。生成工程的
`generation.json` 记录当次使用的模板、模式、SDK 与文件哈希。

## 测试

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
```

测试使用临时目录（含空格），不接触真实账号、游戏文件或外部服务；完整构建/验收测试
需要 Node、npm 与 Rust MSVC 工具链。回归同时覆盖默认 Windows 代码页和显式
`PYTHONUTF8=1`，以及 `TMP`/`TEMP` 位于被监视工作区时的目录提交瞬时拒绝场景。

## 许可与边界

自有内容采用 MIT，见 `LICENSE`；第三方说明见 `THIRD-PARTY-NOTICES.md`，生成工程保留这两个文件。

不包含游戏下载源、版本清单、游戏文件或自动修复；不操作真实 Microsoft 账号；L3
（新增 Vue 组件）和第三方 Provider 开发不属于本 Skill 默认流程。

旧版快照工程请继续使用生成它的原版工具检查；新版工具不承诺兼容旧版项目 Schema。首次构建需要访问公开 Git SDK 和 Cargo 依赖，或已有相应缓存。
