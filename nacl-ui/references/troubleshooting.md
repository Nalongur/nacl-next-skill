# 工具失败与恢复

## 退出码

| 码 | 含义 | 先做什么 |
| --- | --- | --- |
| 0 | 成功 | 读结果摘要，继续下一步 |
| 1 | 构建/验收步骤失败 | 读 `error.details.log` 或证据目录中的步骤日志，修第一条错误 |
| 2 | 参数/配置/兼容/校验错误 | 读 `errors[]` 的 `file`/`path`/`code`/`hint`，只改对应字段 |
| 3 | 缺少环境/依赖 | 安装 Node/npm/Rust，或先运行 `npm ci`；看 `error.details.missing` |
| 4 | 目标/证据目录冲突 | 换新目录；不要删除或覆盖已有用户文件 |

## create

- 目标非空：生成器拒绝覆盖。换新目录；如果要在已有工程上继续定制，直接改工程 JSON，不要重新生成覆盖。
- 目标是空目录：允许，生成完成后写入。
- 之前失败留下 `.<name>.nacl-staging-*`：新生成使用新的唯一暂存目录，不受影响；确认没有其他生成在运行后可手动清理旧暂存目录。生成失败不会留下半成品目标目录。
- 输出路径包含空格：支持；不要手工加引号到 JSON 字段里。
- 生成器拒绝输出到分发目录内部或包含分发目录的路径。

## 校验

- `config/read-failed`：JSON 语法错误；先修逗号、引号、括号。`path` 指向文件。
- `page/unknown-component`：组件未注册；用 `inspect` 或 `registry.generated.md` 的组件名。
- `page/unknown-param` / `page/invalid-param`：参数不存在或值越界；删除或改回允许值。
- `page/action-mismatch` / `page/unknown-action-slot`：动作 key/id 接错；按注册表恢复。
- `page/binding-mismatch` / `page/unknown-binding-path`：数据源接错；绑定 key 只能指向规定路径。
- `page/mode-mismatch`：页面 mode 与项目 mode 不一致；改回项目配置。
- `project/layout-mismatch`：页面 `layout` 与项目 `layout` 不一致；切换布局时同时改
  `nacl.project.json` 的 `layout`/`template.layout` 和页面 `layout`。`generation.json.layout`
  是生成基线，不必跟随。
- `page/missing-core-component` / `page/missing-identity-component`：不要删核心/身份组件；恢复缺失区块。
- `compat/schema-modified`：工程 Schema 被改；恢复固定 Schema 或重新生成。
- `project/snapshot-mismatch`：SDK Git 来源与契约被改或复制不完整；重新生成，不要手改哈希。
- `dist/file-modified` / `dist/file-missing`：分发本身不完整或被修改；重新复制整个 `nacl-ui/`。

## 构建

- `env/node-modules-missing`：先 `npm ci`，或直接用 `build`（会自动安装）。
- `env/npm-ci-failed`：检查网络、registry 和 `package-lock.json`；日志在 `error.details.log`。不要在失败后把半安装目录当作成功。
- `env/missing-cargo`：安装 Rust MSVC 工具链；桌面构建必需。
- `build/step-failed`：日志在工程 `.nacl/logs/<时间>/`；修第一条错误后重跑。不要关闭类型检查或 `-D warnings`。
- `build/artifact-missing`：看 `desktop-build` 日志；确认 `src-tauri/tauri.conf.json` 的 `beforeBuildCommand`/`frontendDist` 未被改坏。
- 重复构建：已安装依赖时直接复用；需要干净依赖时加 `--fresh`。`verify` 总是执行 `npm ci`。

## 预览

- IPC 工程默认不可预览；加 `--mock` 或用 `--adapter mock` 创建预览工程。窗口徽标必须显示 MOCK。
- `env/node-modules-missing`：先安装依赖。
- `preview/exited` / `preview/timeout`：端口占用或 Vite 启动失败；看 `.nacl/logs/<时间>/preview.log`，换端口重试。
- `preview --check` 只检查服务器就绪后退出；人工查看时省略 `--check`，按 Ctrl+C 停止。

## 验收

- 证据目录必须不存在或为空；每次验收用新目录，保留旧证据。
- `verify` 顺序：`npm ci` → 配置 → 前端测试 → 类型 → 前端构建 → fmt → Rust 测试 → clippy → 桌面构建。失败会保留 `verification.json`、步骤日志和 `failedStep`。
- `verify` 会重算 SDK 契约哈希并扫描仓库/分发绝对路径；失败时不要改生成清单来掩盖。
- 首次失败和重跑结果分开保留；不要用旧版本结果替代当前失败。

## 更新分发

复制新的完整 `nacl-ui/` 目录替换旧目录，不要只覆盖部分文件。替换后先运行 `python scripts/nacl_ui.py self-check`，再生成/校验工程。
