---
name: lsou-startup-recovery
description: 排查并恢复来搜国际站经营工作台启动失败、窗口未打开、无法连接 Accio 会话、更新后不能使用等问题。读取脱敏诊断，执行有限恢复并核验窗口与真实数据。
---

# 来搜启动排障

目标是让用户能进入来搜 Tauri 工作台。用户只需在 Accio Work 中说明无法使用，不需要自行找文件、安装开发工具或敲命令。

## 先取得实际诊断

优先调用本插件的 `lsou_desktop_diagnose`。它检查当前电脑系统、包内程序、当前活动空间、国际站生意助手、实际安装的 Workctl、会话认证与经营 schema。输出不包含账号、令牌、API Key、原始命令或日志正文。

工具未直接展示时，先按 `lsou-launchpad` 的发现顺序查找已注册 MCP；延迟搜索无结果不能直接判定断开。只有确认 MCP 不可用时，使用 Accio 已注册的 CLI `lsou-workbench --diagnose`。若 CLI 也未注册，按当前 Skill 所在目录回到插件根目录，使用包内入口：

- Mac：`/bin/sh "<插件根目录>/scripts/launch-mcp.sh" --diagnose`
- Windows：`"<插件根目录>\resources\windows-x64\runtime\node.exe" "<插件根目录>\scripts\desktop-mcp.cjs" --diagnose`

在终端工具里传真实路径并按当前 shell 正确引用；不用全局 Node。Windows PowerShell 调用带引号程序路径时需在前面加 `&`。诊断不会打开桌面窗口。包内 Node 无法运行时，根据系统实际给出的拦截/缺文件信息判断，不反复尝试业务查询。

## 根据检查结果处理

先看 `runtime.issue.code`、`package.issue` 和 `compatibility`；再看 `desktop.state`。`lastStartup` 是历史摘要，只能结合时间和 `processAlive` 使用，不能用历史 ready 证明当前成功。

通过独立 CLI `--diagnose` 运行时，`desktop.state=stopped` 只描述这次诊断进程没有创建窗口，不能据此断言全局工作台已关闭。应结合 `lastStartup.processAlive` 和实际窗口核验；若原生进程仍存活但无法观察窗口，报告“进程仍在运行，窗口显示状态待确认”。已有 MCP 状态工具时优先读取它，不为了查询状态另开诊断进程。

| 证据 | 处理 |
|---|---|
| `environmentReady=true`，窗口失败或关闭 | 调用一次 `lsou_desktop_repair`，重新发现当前会话并打开工作台。 |
| `PACKAGE_PERMISSION` | 调用一次恢复工具；它只恢复本插件随包程序的执行权限。 |
| `ACCIO_UNAVAILABLE` / `SPACE_UNAVAILABLE` / `CREDENTIALS_MISSING` | 提示用户在 Accio 完成打开、登录或进入空间；状态改变后再诊断。 |
| `PLUGIN_MISSING` / `PLUGIN_DISABLED` | 指向当前空间的国际站生意助手安装/启用入口；不要把其他空间已安装当作当前已安装。 |
| `WORKCTL_INSTALLING` | 等待当前插件安装完成，重新诊断一次。 |
| `WORKCTL_MISSING` / `WORKCTL_PERMISSION` / `WORKCTL_ENTRY_INVALID` | 检查 Accio 官方插件管理中的安装/修复状态。不得自行 npm 安装、复制其他账号 CLI、降级或伪造安装路径。 |
| `GATEWAY_AUTH_FAILED` | 需要用户在 Accio 重新登录；不读取或展示凭据内容。 |
| `WORKCTL_TIMEOUT` / `SCHEMA_UNAVAILABLE` | 重新诊断一次；持续失败保留错误码，说明接口尚未就绪，不误报账号一定没授权。 |
| `WORKCTL_OS_UNSUPPORTED` / `PLATFORM_UNSUPPORTED` / 系统兼容检查失败 | 给出实际系统和芯片及错误码，核对对应独立包；不以窗口最低系统版本推断 Workctl 也兼容。 |
| `PACKAGE_WRONG_PLATFORM` | 按诊断指明的电脑芯片选择对应独立 ZIP；不要安装 Rosetta 或强行运行错包作为修复。 |
| `PACKAGE_INCOMPLETE` | 使用来源可信且与芯片对应的完整 ZIP，通过 Accio 插件管理重新导入。 |
| `BACKEND_EXITED` / `BACKEND_TIMEOUT`，环境检查正常 | 调用一次恢复工具；失败后反馈结构化诊断，不无限重启。 |

来搜会优先使用当前空间的 Accio 安装记录，自动兼容 `generations` 和 `versions`，只使用当前声明版本。诊断通过表示路径已经解析成功，不需要修改 `plugins.json`、创建软链接或改写安装目录。

## 有限恢复与验收

`lsou_desktop_repair` 会合并重复请求，只修复本插件随包执行权限、重新发现会话，并重启由本 MCP 创建的失败窗口。已 ready 的窗口会保留；独立手工打开的窗口需用户关闭后再打开，工具不会批量杀进程。恢复不更改账号、店铺绑定、系统安全设置、Dify 配置，也不执行商品或广告写入。

用户要求停止时优先调用 `lsou_desktop_stop`，不要继续恢复；已发起的恢复会被停止请求取消。停止后不主动再次启动。

同一故障最多一次恢复；只有用户完成登录/安装等必要动作或诊断证据改变后，才再次恢复。若工具返回的 `ok=false`，如实说明卡在哪里。下载、重装或更新需有当前用户授权并使用 Accio 正式入口；现有“排查启动”请求不代表可以卸载其他插件或关闭系统保护。

恢复返回 `ready` 后，还要查看 Tauri 窗口是否显示经营总览，再打开商品运营核验只读数据。有窗口无数据时进入店铺接口/授权诊断，不能继续当作启动故障重启，也不能把 schema 通过写成店铺数据成功。不要发布商品、投放广告或发送消息作为测试。

窗口已打开但某个区域报未知命令、未知参数或版本不兼容时，使用同包 `lsou-workctl-compat` Skill。它会在当前账号的实时目录寻找等价只读入口，并核验字段与页面显示；不需要重新启动正常窗口。

向用户用简短中文说明：查到的具体原因、实际完成的动作、窗口/数据分别验证到哪一步、仍需用户做的一个动作。没有复现的部分注明未确认。

## 方法依据与边界

项目国际站运营 SOP 的“店铺诊断、核心产品数据跟踪”用于恢复后的真实数据验收，要求依据当前对象和周期的数据。SOP 未覆盖桌面启动、CLI 安装或系统故障，因此这里依据实际诊断处理，不套用经营阈值，也不把技术故障解释为店铺经营问题。
