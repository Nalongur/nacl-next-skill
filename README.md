# NaCL Next Skill

使用此 Skill 生成并定制 NaCL Next 启动器界面。完整复制 `nacl-ui/` 到 Agent 的技能目录；人工使用时也可直接运行其中脚本。

## 创建和构建

在 Windows 安装 Python 3、Node/npm、Rust/MSVC 和 WebView2 后，在仓库目录执行：

```powershell
$project = Join-Path $env:TEMP 'nacl-my-launcher'
python nacl-ui/scripts/nacl_ui.py self-check
python nacl-ui/scripts/nacl_ui.py create --layout nacl --mode b --output $project
python nacl-ui/scripts/nacl_ui.py validate --project $project
python nacl-ui/scripts/nacl_ui.py check --project $project
python nacl-ui/scripts/nacl_ui.py build --project $project
```

首次构建通过 Cargo 和 npm 获取公开依赖。`b` 为本地档案模式；正版或共存模式、Client ID 配置、布局和定制方法见 [Skill 说明](nacl-ui/README.md) 和 [工作流](nacl-ui/SKILL.md)。

项目自有内容采用 [MIT 许可](LICENSE)；第三方依赖及许可材料见 [third-party](third-party/README.md)。
