# 稳定错误码与修复方向（生成文件）

> 由 `scripts/render-skill-references.mjs` 从错误提示表和校验器/核心源码中的
> 稳定错误码生成。工具输出会同时给出文件、JSON 路径、错误码和简短修复方向。

| 错误码 | 修复方向 |
| --- | --- |
| `build/artifact-missing` | 构建未产出预期 EXE/dist；查看 desktop-build 日志。 |
| `build/step-failed` | 构建步骤失败；查看日志中第一条错误，不要跳过类型检查或降低告警级别。 |
| `compat/cargo-version` | Cargo 依赖版本与兼容记录不一致；恢复壳清单或重新生成。 |
| `compat/invalid` | 兼容检查未通过；按 details.errors 中的具体缺项修复或重新获取匹配版本的分发。 |
| `compat/npm-version` | npm 依赖版本与兼容记录不一致；恢复 package.json/锁文件或重新生成。 |
| `compat/page-schema` | 页面 Schema 版本不受支持；固定契约为 1。 |
| `compat/schema-modified` | 工程中的 Schema 与分发固定契约不一致；恢复原 Schema 或重新生成，不要改契约。 |
| `compat/sdk-source` | 分发 Cargo 锁文件与 SDK 来源记录不一致；重新组装。 |
| `compat/sdk-version` | 工程 SDK 版本与分发兼容记录不一致；从当前分发重新生成工程。 |
| `compat/source-missing` | 分发或工程缺少必要源文件；确认复制完整，必要时重新组装分发。 |
| `compat/template-version` | 模板版本不受当前分发支持；重新生成工程。 |
| `compat/unknown-adapter` | adapter 只能是 ipc 或 mock；mock 仅用于布局预览，不是真实后端证据。 |
| `compat/validator-drift` | 预编译校验器与 Schema 不一致；重新组装分发，不要手改生成校验器。 |
| `config/import-failed` | 工程校验模块无法加载；确认工程完整，必要时从分发副本重新生成。 |
| `config/invalid-encoding` | 配置文件不是有效的 UTF-8；按原内容以 UTF-8 重新保存，工具不会猜测或替换错误字节。 |
| `config/invalid-root` | 配置文件的 JSON 根必须是对象；null、数组、字符串、数字和布尔值都不是有效根。 |
| `config/read-failed` | 配置文件无法读取或不是合法 JSON；检查 path 指向的文件和 JSON 语法（逗号、引号、括号）。 |
| `contract/missing` | 缺少生成的 TypeScript 契约；重新生成工程，不手工补契约。 |
| `dist/compatibility-mismatch` | 分发兼容记录与内置资产不一致；重新组装/获取分发。 |
| `dist/destination-incomplete` | 目标分发不完整；先恢复备份或补齐手写资料，不要用当前目录继续组装。 |
| `dist/file-missing` | 分发文件缺失；重新复制完整分发目录。 |
| `dist/file-modified` | 分发文件与清单哈希不一致；恢复原文件或重新获取分发。 |
| `dist/file-unexpected` | 分发关键目录出现清单外文件；删除多余文件，或重新获取分发。 |
| `dist/hand-authored-missing` | 分发缺少必需手写资料（README/SKILL/许可/参考）；从备份恢复或补齐后再组装，不能靠缩水清单通过。 |
| `dist/incomplete` | 组装结果缺少清单文件；检查磁盘与路径后重试，不要发布不完整分发。 |
| `dist/manifest-incomplete` | 分发表未登记必需手写资料；重新组装，不要手改清单缩小范围。 |
| `dist/manifest-invalid` | DISTRIBUTION.json 的根或 files 结构不合法；重新组装/获取分发。 |
| `dist/manifest-missing` | 分发缺少 DISTRIBUTION.json；复制了不完整的分发目录，重新复制整个 nacl-ui。 |
| `dist/recovery-ambiguous` | 存在多个完整恢复件；人工确认保留一个后再运行，工具不会擅自删除。 |
| `dist/recovery-failed` | 无法把恢复件移回目标；恢复件仍在原位置，确认路径未被占用后重试。 |
| `dist/recovery-incomplete` | 存在未完成交换残留但没有完整恢复件；人工检查残留后再组装。 |
| `dist/swap-failed` | 分发目录交换失败；备份与暂存目录已保留，先人工恢复完整分发再重试。 |
| `env/missing-cargo` | 找不到 cargo/rustc；安装 Rust MSVC 工具链后重试。 |
| `env/missing-node` | 找不到 Node.js；安装 Node 后重试，或设置 PATH。 |
| `env/missing-npm` | 找不到 npm；安装 Node.js/npm 后重试。 |
| `env/missing-rustc` | 找不到 rustc；安装/修复 Rust MSVC 工具链后重试。 |
| `env/node-modules-missing` | 工程尚未安装前端依赖；先运行 npm ci（或 build/verify 的自动安装步骤）。 |
| `env/npm-ci-failed` | npm ci 失败；检查网络、npm registry 和 lockfile，查看日志后重试。 |
| `env/test-dependency-missing` | 模板校验依赖缺失；按 README 在模板目录安装 npm 依赖。 |
| `evidence/non-empty` | 证据目录已存在且非空；换一个新目录，保留旧证据。 |
| `page/action-mismatch` | 动作入口只能绑定注册表规定的动作 id；不要改接其他动作。 |
| `page/action-unavailable` | 当前模式不提供该动作；B 无 Microsoft 动作，A 无本地档案动作。 |
| `page/binding-mismatch` | 绑定 key 只能指向注册表规定的数据源；不要改接其他路径。 |
| `page/binding-unavailable` | 当前模式不提供该数据源；A/D 才有 Microsoft，B/D 才有本地档案。 |
| `page/component-slot` | 该组件不能放入这个区域；改用组件允许的槽位。 |
| `page/component-unavailable` | 该组件不属于当前认证模式；A 仅正版、B 仅本地、D 两者共存。 |
| `page/duplicate-block` | 区块 id 重复；为每个区块使用唯一 id。 |
| `page/duplicate-component` | 同一组件只能出现一次；删除重复区块或改用其他注册组件。 |
| `page/identity-component-unavailable` | 身份组件与模式不符；B 不能出现 Microsoft 组件，A 不能出现本地档案组件。 |
| `page/invalid` | 页面组合或页面结构校验失败；按 details.errors 的 path 与错误码修正。 |
| `page/invalid-page` | nacl 区块须指定受支持页面；其他布局不得指定页面。 |
| `page/invalid-param` | 参数类型、范围或枚举不合法；按提示改成允许值。 |
| `page/invalid-params` | params 必须是 JSON 对象；不要写成数组或字符串。 |
| `page/missing-action` | 组件缺少必需动作；按注册表补齐动作接线。 |
| `page/missing-binding` | 组件缺少必需数据绑定；按注册表补齐 key/path。 |
| `page/missing-core-component` | 布局缺少核心组件；实例、启动、任务、日志、详情、Java 必须可达。 |
| `page/missing-identity-component` | 当前模式缺少身份组件；A 需 MicrosoftIdentity，B 需 LocalProfiles，D 需两者与 IdentityPicker。 |
| `page/mode-mismatch` | 页面 mode 与项目/构建模式不一致；把 page.json 的 mode 改成工程 nacl.project.json 中的模式。 |
| `page/schema-version` | 页面 schemaVersion 与当前运行时不一致；固定契约为 1，不要自行升级。 |
| `page/template-invalid` | 布局模板结构无效；确认 schemaVersion、layout、blocks 数组和区块 id。 |
| `page/unknown-action` | 动作未注册；只能使用注册表已有动作，禁止 shell/任意命令。 |
| `page/unknown-action-slot` | 组件没有这个动作入口；删除或改用组件注册的动作 key。 |
| `page/unknown-binding` | 组件没有这个绑定入口；删除或改用组件注册的绑定 key。 |
| `page/unknown-binding-path` | 数据源未注册；只能使用 references/registry.generated.md 中列出的路径。 |
| `page/unknown-component` | 组件未注册；只能使用注册表已有组件，不要写自定义 Vue/HTML。 |
| `page/unknown-layout` | layout 只能是 sidebar 或 studio；改用注册布局。 |
| `page/unknown-param` | 组件不支持该参数；删除它或改用注册表列出的参数。 |
| `page/unknown-slot` | 该布局没有这个区域；按 references/registry.generated.md 的布局槽位改写 slot。 |
| `page/unsupported-mode` | mode 只能是 a、b、d；按项目配置填写。 |
| `preview/adapter-ipc` | IPC 工程没有 mock 适配器；布局预览请加 --mock，或创建 --adapter mock 的工程。 |
| `preview/exited` | 预览服务器提前退出；查看日志中的端口占用或依赖错误。 |
| `preview/start-failed` | 预览服务器未能启动；检查端口占用和 Vite 日志。 |
| `preview/timeout` | 预览服务器未在时限内就绪；检查日志与端口。 |
| `project/app-metadata-mismatch` | Tauri productName/identifier 与项目配置不一致；重新生成或同步两者。 |
| `project/build-mode-mismatch` | Cargo 默认 mode feature 与项目模式不一致；重新生成或修正 src-tauri/Cargo.toml。 |
| `project/commit-failed` | 目录提交被瞬时占用或拒绝访问；目标未被覆盖，暂存已清理，可直接重跑。持续失败时检查目标路径是否被其他进程占用。 |
| `project/contracts-mismatch` | SDK TypeScript 契约与记录不一致；重新生成。 |
| `project/generation-invalid` | generation.json 的 files 必须是路径到 SHA-256 的对象；重新生成工程。 |
| `project/layout-mismatch` | 项目配置布局与页面 layout 不一致；两者必须相同。 |
| `project/missing-file` | 工程缺少生成文件；从分发副本重新生成，不要手工补固定文件。 |
| `project/mode-mismatch` | 项目配置模式与页面/构建不一致；以 nacl.project.json 为准重建或改回页面。 |
| `project/page-schema-version` | 项目 pageSchemaVersion 与页面/运行时不一致；固定为 1。 |
| `project/read-failed` | 工程文件无法按 UTF-8 读取；恢复原文件或重新生成，不要用错误编码覆盖。 |
| `project/sdk-source-mismatch` | Cargo 清单或锁文件的 SDK 来源与固定提交不一致；检查来源或重新生成。 |
| `project/sdk-version-mismatch` | 工程记录的 SDK 版本与内置快照不一致；重新生成工程，不手改版本号。 |
| `project/snapshot-mismatch` | 工程 SDK 快照哈希与记录不一致；快照被改动或复制不完整，重新生成。 |
| `project/staging-conflict` | 存在同目标的生成暂存目录；确认没有其他生成正在进行后再重试。 |
| `project/target-conflict` | 目标目录已存在且非空；换一个新目录,不要覆盖用户文件。 |
| `project/template-mismatch` | project.template 的 mode/layout 与顶层不一致；重新生成工程或修正配置。 |
| `project/window-invalid` | 窗口最小尺寸不能大于初始尺寸；调整 nacl.project.json 的 window。 |
| `project/window-mismatch` | Tauri 窗口尺寸与项目配置不一致；重新生成或同步两者。 |
| `project/write-failed` | 生成过程中写入或复制失败；目标未提交，暂存已清理，检查磁盘空间、路径长度和权限后重试。 |
| `schema/*` | 字段类型、枚举、格式或未知字段不符合页面 Schema；按 path 指向的字段修正，未知字段应删除。 |
| `schema/additionalProperties` | 该对象不允许此字段；删除未知字段，或改用注册表中已有字段。 |
| `schema/enum` | 值不在允许枚举内；改用 Schema/注册表列出的值。 |
| `schema/maximum` | 整数高于允许上限；按 Schema 范围调整。 |
| `schema/maxItems` | 区块数量超过上限；合并或删除非必要区块。 |
| `schema/maxLength` | 字符串过长；标题最长 80 字符，区块标题最长 60 字符。 |
| `schema/maxProperties` | 对象字段过多；删除未使用的绑定、动作或参数。 |
| `schema/minimum` | 整数低于允许下限；按 Schema 范围调整。 |
| `schema/minItems` | 区块数量少于布局要求；补齐核心组件区块。 |
| `schema/minLength` | 字符串过短；标题不能为空。 |
| `schema/pattern` | 字符串格式不匹配；检查 id、组件名、绑定/动作路径或颜色值格式。 |
| `schema/required` | 缺少必填字段；补齐 path 指向的对象中的必填项。 |
| `schema/type` | 字段类型错误；布尔、整数、字符串和对象不能互换。 |
| `tool/internal` | 工具内部错误；保留输出与日志，检查分发包完整性。 |
| `usage/invalid` | 参数不合法；运行 --help 查看允许的取值。 |
