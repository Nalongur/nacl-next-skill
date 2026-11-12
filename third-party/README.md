# 第三方许可资料

`index.json` 对照 Skill 内 Cargo 和 npm 锁文件列出依赖、来源、校验值、声明许可及本机可取得的许可和 NOTICE 原文。`texts/` 按 SHA-256 去重。多数依赖由 Cargo/npm 在使用时单独下载；Skill 本身包含 Ajv 生成的校验代码。

`no local texts found` 表示该版本的原文未收集到；`upstream version license captured; package-specific notices unverified` 表示记录的是上游版本许可，未核实各平台包专有 NOTICE。声明许可缺失的条目保留为 null。使用或分发依赖时应查阅相应上游资料。
