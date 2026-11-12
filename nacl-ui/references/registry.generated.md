# 页面注册表与模板（生成文件）

> 由 `scripts/render-skill-references.mjs` 从 `src/contract/registry.mjs`、
> 页面 Schema、两套模板和兼容记录生成。不要手改；重新组装分发时覆盖。

- 页面 Schema 版本：1
- 认证模式：a / b / d
- 布局：nacl / sidebar / studio

## 布局

| 布局 | 槽位 | 必需核心组件 |
| --- | --- | --- |
| `nacl` | nav / main / aside | `InstanceList`, `LaunchPanel`, `TaskMonitor`, `LogViewer`, `InstanceDetails`, `JavaPanel` |
| `sidebar` | nav / main / aside | `InstanceList`, `LaunchPanel`, `TaskMonitor`, `LogViewer`, `InstanceDetails`, `JavaPanel` |
| `studio` | top / left / center / bottom / right | `InstanceList`, `LaunchPanel`, `TaskMonitor`, `LogViewer`, `InstanceDetails`, `JavaPanel` |

## 组件

### HostPreferences

- 允许模式：a / b / d
- 允许槽位：main / aside

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |


动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `load` | `host.preferences.get` | 必需 |
| `save` | `host.preferences.save` | 必需 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |


### InstanceList

- 允许模式：a / b / d
- 允许槽位：nav / left

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `items` | `instances.items` | 必需 |
| `selected` | `instances.selected` | 必需 |
| `deleted` | `instances.deleted` | 可选 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `select` | `instances.select` | 必需 |
| `refresh` | `instances.refresh` | 可选 |
| `create` | `instances.create` | 可选 |
| `duplicate` | `instances.duplicate` | 可选 |
| `delete` | `instances.delete` | 可选 |
| `restore` | `instances.restore` | 可选 |
| `purge` | `instances.purge` | 可选 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `compact` | boolean |
| `allowCreate` | boolean |
| `allowDelete` | boolean |
| `allowRestore` | boolean |
| `allowDuplicate` | boolean |

### InstanceDetails

- 允许模式：a / b / d
- 允许槽位：aside / right

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `instance` | `instances.selectedInstance` | 必需 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `refresh` | `instances.refresh` | 可选 |
| `rename` | `instances.rename` | 可选 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `compact` | boolean |
| `showPaths` | boolean |

### InstanceSettings

- 允许模式：a / b / d
- 允许槽位：aside / right

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `instance` | `instances.selectedInstance` | 必需 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `save` | `instances.update-settings` | 必需 |
| `saveAdvanced` | `instances.update-advanced` | 可选 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |


### JavaPanel

- 允许模式：a / b / d
- 允许槽位：aside / right

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `instance` | `instances.selectedInstance` | 必需 |
| `detected` | `java.detected` | 必需 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `detect` | `java.detect` | 必需 |
| `set` | `instances.update-java` | 必需 |
| `auto` | `instances.java-auto` | 可选 |
| `inspect` | `java.inspect` | 可选 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `compact` | boolean |
| `allowManualPath` | boolean |

### LocalProfiles

- 允许模式：b / d
- 允许槽位：nav / left

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `items` | `profiles.items` | 必需 |
| `selected` | `profiles.selected` | 必需 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `select` | `profiles.select` | 必需 |
| `refresh` | `profiles.refresh` | 可选 |
| `create` | `profiles.create` | 可选 |
| `rename` | `profiles.rename` | 可选 |
| `delete` | `profiles.delete` | 可选 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `compact` | boolean |
| `showUuid` | boolean |
| `allowRename` | boolean |
| `allowDelete` | boolean |
| `allowCreate` | boolean |

### MicrosoftIdentity

- 允许模式：a / d
- 允许槽位：nav / left

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `account` | `microsoft.account` | 必需 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `refresh` | `microsoft.refresh` | 必需 |
| `beginLogin` | `microsoft.login.begin` | 必需 |
| `completeLogin` | `microsoft.login.complete` | 必需 |
| `cancelLogin` | `microsoft.login.cancel` | 必需 |
| `logout` | `microsoft.logout` | 必需 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `compact` | boolean |
| `showConfigHint` | boolean |

### IdentityPicker

- 允许模式：d
- 允许槽位：nav / top / left

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `account` | `microsoft.account` | 必需 |
| `profiles` | `profiles.items` | 必需 |
| `selectedKind` | `identity.selectedKind` | 必需 |
| `effective` | `identity.effective` | 必需 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `refresh` | `identity.refresh` | 必需 |
| `select` | `identity.select` | 必需 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `compact` | boolean |
| `showTrust` | boolean |

### LaunchPanel

- 允许模式：a / b / d
- 允许槽位：main / top

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `instance` | `instances.selectedInstance` | 必需 |
| `identity` | `identity.effective` | 必需 |
| `preview` | `preview.current` | 必需 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `resolve` | `launch.resolve` | 必需 |
| `start` | `launch.start` | 必需 |
| `viewLog` | `logs.select` | 可选 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `emphasis` | enum: standard / hero |
| `showJava` | boolean |
| `compact` | boolean |

### TaskMonitor

- 允许模式：a / b / d
- 允许槽位：main / center

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `tasks` | `tasks.items` | 必需 |
| `subscription` | `tasks.subscription` | 可选 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `refresh` | `tasks.refresh` | 必需 |
| `status` | `tasks.status` | 可选 |
| `resubscribe` | `tasks.resubscribe` | 可选 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `compact` | boolean |
| `maxItems` | integer (1..50) |
| `showSubscription` | boolean |

### LogViewer

- 允许模式：a / b / d
- 允许槽位：main / bottom

绑定（key → 唯一允许的数据源）：

| key | 数据源 | 要求 |
| --- | --- | --- |
| `items` | `logs.items` | 必需 |
| `selected` | `logs.selected` | 必需 |
| `content` | `logs.content` | 必需 |

动作（key → 唯一允许的动作 id）：

| key | 动作 id | 要求 |
| --- | --- | --- |
| `refresh` | `logs.refresh` | 必需 |
| `read` | `logs.read` | 必需 |
| `select` | `logs.select` | 可选 |

参数（只允许以下展示参数）：

| 参数 | 类型 / 范围 |
| --- | --- |
| `compact` | boolean |
| `autoLoadFirst` | boolean |
| `visibleLines` | integer (20..500) |

## 注册动作

| 动作 id | 能力 | 限定模式 |
| --- | --- | --- |
| `host.preferences.get` | — | a / b / d |
| `host.preferences.save` | — | a / b / d |
| `instances.refresh` | instance.manage | a / b / d |
| `instances.select` | — | a / b / d |
| `instances.create` | instance.manage | a / b / d |
| `instances.duplicate` | instance.manage | a / b / d |
| `instances.delete` | instance.manage | a / b / d |
| `instances.restore` | instance.manage | a / b / d |
| `instances.purge` | instance.manage | a / b / d |
| `instances.update-java` | instance.manage | a / b / d |
| `instances.java-auto` | instance.manage | a / b / d |
| `instances.update-settings` | instance.manage | a / b / d |
| `instances.update-advanced` | instance.manage | a / b / d |
| `instances.rename` | instance.manage | a / b / d |
| `java.detect` | java.detect | a / b / d |
| `java.inspect` | java.detect | a / b / d |
| `profiles.refresh` | account.local | a / b / d |
| `profiles.select` | account.local | a / b / d |
| `profiles.create` | account.local | a / b / d |
| `profiles.rename` | account.local | a / b / d |
| `profiles.delete` | account.local | a / b / d |
| `microsoft.refresh` | account.microsoft | a / b / d |
| `microsoft.login.begin` | account.microsoft | a / b / d |
| `microsoft.login.complete` | account.microsoft | a / b / d |
| `microsoft.login.cancel` | account.microsoft | a / b / d |
| `microsoft.logout` | account.microsoft | a / b / d |
| `identity.refresh` | — | d |
| `identity.select` | — | d |
| `launch.resolve` | launch.game | a / b / d |
| `launch.start` | launch.game | a / b / d |
| `tasks.refresh` | — | a / b / d |
| `tasks.status` | — | a / b / d |
| `tasks.resubscribe` | — | a / b / d |
| `logs.refresh` | diagnostics.logs | a / b / d |
| `logs.read` | diagnostics.logs | a / b / d |
| `logs.select` | diagnostics.logs | a / b / d |

动作只能通过组件声明的入口接线；页面不能直接调用命令名。

## 注册数据源

| 数据源 | 能力 | 限定模式 |
| --- | --- | --- |
| `instances.items` | instance.manage | a / b / d |
| `instances.deleted` | instance.manage | a / b / d |
| `instances.selected` | — | a / b / d |
| `instances.selectedInstance` | instance.manage | a / b / d |
| `java.detected` | java.detect | a / b / d |
| `profiles.items` | account.local | a / b / d |
| `profiles.selected` | account.local | a / b / d |
| `microsoft.account` | account.microsoft | a / b / d |
| `tasks.items` | — | a / b / d |
| `tasks.subscription` | — | a / b / d |
| `logs.items` | diagnostics.logs | a / b / d |
| `logs.selected` | diagnostics.logs | a / b / d |
| `logs.content` | diagnostics.logs | a / b / d |
| `preview.current` | launch.game | a / b / d |
| `launch.last` | launch.game | a / b / d |
| `identity.selectedKind` | — | d |
| `identity.effective` | — | a / b / d |
| `app.mode` | — | a / b / d |
| `app.adapter` | — | a / b / d |
| `app.eventStatus` | — | a / b / d |
| `app.sdkVersion` | — | a / b / d |

## 模式身份要求

- A：`MicrosoftIdentity`
- B：`LocalProfiles`
- D：`MicrosoftIdentity`、`LocalProfiles`、`IdentityPicker`

## 两套模板 × 模式

| 布局 | 模式 | 校验 | 区块（id(组件@槽位)） |
| --- | --- | --- | --- |
| `nacl` | A | 通过 | host-preferences(HostPreferences@main)<br>identity-microsoft(MicrosoftIdentity@nav)<br>instances(InstanceList@nav)<br>launch(LaunchPanel@main)<br>tasks(TaskMonitor@main)<br>logs(LogViewer@main)<br>details(InstanceDetails@aside)<br>java(JavaPanel@aside)<br>instance-settings(InstanceSettings@aside) |
| `nacl` | B | 通过 | host-preferences(HostPreferences@main)<br>identity-local(LocalProfiles@nav)<br>instances(InstanceList@nav)<br>launch(LaunchPanel@main)<br>tasks(TaskMonitor@main)<br>logs(LogViewer@main)<br>details(InstanceDetails@aside)<br>java(JavaPanel@aside)<br>instance-settings(InstanceSettings@aside) |
| `nacl` | D | 通过 | host-preferences(HostPreferences@main)<br>identity-microsoft(MicrosoftIdentity@nav)<br>identity-local(LocalProfiles@nav)<br>identity-picker(IdentityPicker@nav)<br>instances(InstanceList@nav)<br>launch(LaunchPanel@main)<br>tasks(TaskMonitor@main)<br>logs(LogViewer@main)<br>details(InstanceDetails@aside)<br>java(JavaPanel@aside)<br>instance-settings(InstanceSettings@aside) |
| `sidebar` | A | 通过 | identity-microsoft(MicrosoftIdentity@nav)<br>instances(InstanceList@nav)<br>launch(LaunchPanel@main)<br>tasks(TaskMonitor@main)<br>logs(LogViewer@main)<br>details(InstanceDetails@aside)<br>java(JavaPanel@aside) |
| `sidebar` | B | 通过 | identity-local(LocalProfiles@nav)<br>instances(InstanceList@nav)<br>launch(LaunchPanel@main)<br>tasks(TaskMonitor@main)<br>logs(LogViewer@main)<br>details(InstanceDetails@aside)<br>java(JavaPanel@aside) |
| `sidebar` | D | 通过 | identity-microsoft(MicrosoftIdentity@nav)<br>identity-local(LocalProfiles@nav)<br>identity-picker(IdentityPicker@nav)<br>instances(InstanceList@nav)<br>launch(LaunchPanel@main)<br>tasks(TaskMonitor@main)<br>logs(LogViewer@main)<br>details(InstanceDetails@aside)<br>java(JavaPanel@aside) |
| `studio` | A | 通过 | launch-command(LaunchPanel@top)<br>instances(InstanceList@left)<br>identity-microsoft(MicrosoftIdentity@left)<br>tasks(TaskMonitor@center)<br>logs(LogViewer@bottom)<br>details(InstanceDetails@right)<br>java(JavaPanel@right) |
| `studio` | B | 通过 | launch-command(LaunchPanel@top)<br>instances(InstanceList@left)<br>identity-local(LocalProfiles@left)<br>tasks(TaskMonitor@center)<br>logs(LogViewer@bottom)<br>details(InstanceDetails@right)<br>java(JavaPanel@right) |
| `studio` | D | 通过 | launch-command(LaunchPanel@top)<br>identity-picker(IdentityPicker@left)<br>instances(InstanceList@left)<br>identity-microsoft(MicrosoftIdentity@left)<br>identity-local(LocalProfiles@left)<br>tasks(TaskMonitor@center)<br>logs(LogViewer@bottom)<br>details(InstanceDetails@right)<br>java(JavaPanel@right) |
