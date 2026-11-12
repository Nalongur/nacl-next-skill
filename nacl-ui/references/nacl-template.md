# NaCL 模板：能力与定制

`nacl` 是基于固定组件、Vue 渲染器、IPC 和 SDK 的原版 NaCL 风格导航模板。它提供首页、实例、日志和设置主导航；首页与实例页共享实例列表，侧栏身份摘要反映当前启动身份。实例页提供概览、Java、内存与窗口、高级参数子页；模式 B 使用本地档案，A/D 的正版能力仍需开发者提供有权使用的 Client ID。

现有操作包括实例创建、名称编辑、复制、软删除与恢复；本地档案管理；已有 Java 的检测、手动选择与恢复自动；实例内存、窗口和 JVM/游戏参数编辑；启动检查、任务状态与日志读取。设置页的默认最大内存及窗口尺寸只用于后续新建实例，不能追改已有实例。缺少游戏文件时报告错误，不自动下载或修复；日志为按需读取的快照，需要手动重新选择以读取后续输出。

在 `src/page.json` 可调整注册表允许的主题、区块归属/槽位、排序和参数；保留必需组件以及既有绑定和动作。各区块的 `page` 可为 `home`、`instances`、`logs`、`settings`，槽位与动作以 [`registry.generated.md`](registry.generated.md) 为准。固定组件、SDK、IPC、身份语义和渲染器不属于普通 UI 定制范围。日志和任务可按注册规则移页，须保留对应动作。

版本/内容获取、文件管理、缓存清理、旧数据迁移及 Java 下载未作为本模板的操作入口；其他全局偏好未接入。真实 Microsoft 登录、权益和真实 Minecraft 启动须在另行具备授权和环境时验证；自有 Java 探针不能替代真实游戏。源码许可和第三方材料见分发包的许可文件。

## 从最新模板创建暖橙定制

完整复制 `nacl-ui/` 后，在该目录使用 PowerShell 7.6.9、Python、Node/npm、Rust/MSVC 和 WebView2。目标目录须不存在或为空。以下只在**新生成的** JSON 上修改五项，其他区块与动作原样保留：

```powershell
$project = Join-Path $env:TEMP 'nacl-warm-example'
python scripts/nacl_ui.py create --layout nacl --mode b --output $project
if ($LASTEXITCODE -ne 0) { throw 'create failed' }
$pagePath = Join-Path $project 'src/page.json'
$page = Get-Content -Raw -Encoding utf8 -LiteralPath $pagePath | ConvertFrom-Json
$tasks = @($page.blocks | Where-Object { $_.component -eq 'TaskMonitor' })
$logs = @($page.blocks | Where-Object { $_.component -eq 'LogViewer' })
if ($tasks.Count -ne 1 -or $logs.Count -ne 1) { throw 'Expected one TaskMonitor and one LogViewer' }
$page.theme.accent = '#d49c5a'
$page.theme.density = 'compact'
$page.theme.radius = 8
$tasks[0].page = 'logs'
$logs[0].params.visibleLines = 60
$page | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 -LiteralPath $pagePath
python scripts/nacl_ui.py validate --project $project
if ($LASTEXITCODE -ne 0) { throw 'validate failed' }
python scripts/nacl_ui.py check --project $project
if ($LASTEXITCODE -ne 0) { throw 'check failed' }
python scripts/nacl_ui.py build --project $project
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
& "$project/target/release/nacl-next-s1-shell.exe"
```

完成后 `check` 应只列出 `src/page.json`；实际行为仍需在独立测试数据下验收。样例目录中的旧模型 `page.json` 是历史快照，不应覆盖新生成的页面，否则会丢失后续新增的接线。
