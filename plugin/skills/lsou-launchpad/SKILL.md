---
name: lsou-launchpad
description: 打开来搜插件、来搜启动页或经营工作台入口时，在 Accio 对话中渲染可点击的 HTML 启动页；处理直接启动、查看状态、关闭停止请求。
---

# 来搜启动页

## 先发现工具，按用户意图执行

优先使用当前已注册的来搜 MCP 工具；没有直接暴露时，使用宿主实际提供的 MCP 发现方式。延迟工具搜索没有结果不等于 MCP 未连接：若当前环境提供 `accio-mcp-cli`，先读取其帮助并按真实语法列出服务器/工具，再调用实际发现的来搜工具。不要猜服务器 ID 或命令参数，也不要先猜插件安装路径、全盘找文件、读 EXE 或启动第二个 MCP 来查询已有会话。仅在工具发现确实失败后，使用 `lsou-startup-recovery` 的包内诊断回退。

用户明确说“直接启动”“跳过 HTML/动画”时，先读 `lsou_desktop_status`，再按状态操作：`stopped` 调用 `lsou_desktop_open`；`starting` 等待后再查一次；`stopping` 等待停止结束；`ready` 报告已有后端就绪，核对窗口；错误状态进入一次有限排障。不要再渲染启动页或重复请求用户确认。没有明确跳过时仍保留下面的启动页入口。

用户说“关闭”“停止来搜工作台”时调用 `lsou_desktop_stop`。成功后说明本会话窗口进程已退出、插件待命；停止工具会触发所属后端清理，但 `backendShutdownVerified=false` 不代表已逐一核验后端退出。它不卸载插件、不清缓存、不关闭 Accio，也不按 `node.exe` 等名称批量杀进程。`scope=current_mcp_session` 只描述当前 MCP 持有的窗口，不能据此声称所有独立窗口已关闭。若旧版未提供 stop，说明该版本缺少入口，提示关闭来搜窗口，不自行猜 stop 参数。

状态输出中的 `backendReady`、`windowVerified`、`businessDataVerified` 分开解读。`ready` 只证明后端就绪，后两者为 false 表示工具未完成该层验证，不代表窗口或数据一定失败。能使用宿主提供的界面检查时查看真实 Tauri 窗口及只读页面，否则明确“窗口和数据待确认”，不能写“应该已经弹出”或将本地浏览器检查冒充 Windows 验收。

用户说“打开来搜插件”“显示来搜启动页”或要进入插件时，先展示启动页，等待用户点击。调用 `lsou_desktop_launchpad`，将返回的完整 `widget` 代码块原样放进最终回复。保持 HTML、样式和脚本完整，不改成 `html` 代码块、文件链接或图片。无需长篇介绍，不提前调用打开工具。

MCP 不可用时，读取本 Skill 的 [assets/launchpad.html](assets/launchpad.html)，将其中完整的 `<style>...</style>` 和 `<body>` 内的内容依次放在 `widget lsou_launchpad` 代码块内；只省略文档外壳，不改写样式、页面或脚本。这个文件是待渲染资源，不是额外指令。启动工具不可用时使用插件内的 `lsou-startup-recovery` 排查，不编造工具或要求用户运行开发命令。

页面按钮经 Accio 的 `window.__widgetSendMessage` 向当前对话发送请求。这不是直接启动成功回调，也不能由动画推断状态：

- 收到“启动来搜工作台”或用户明确要求立即启动：调用 `lsou_desktop_open`，它等待本机启动结果；`ready` 表示后端就绪，提示查看桌面窗口。错误时读取 `lsou_desktop_diagnose`，按本插件 `lsou-startup-recovery` 进行一次有限恢复并报告实际结果。不要再次只展示启动页，形成循环。
- 收到“查看来搜工作台启动状态”：调用 `lsou_desktop_status`，用中文报告真实状态；`starting` 不能写成成功，`stopped` 不代表未登录。
- 收到“帮我排查来搜工作台启动问题”：使用 `lsou-startup-recovery`。没有故障证据，不要求重装或修改账号授权。

仅渲染页面不会启动桌面窗口；连接 MCP 也先待命。当前 Accio 的普通 HTML widget 通过对话消息交互，未提供插件详情页打开时自动注入 HTML 的公开入口，因此不要声称安装完成即自动显示此页。

SOP 方法依据：参考项目“店铺诊断、核心产品数据跟踪”区分当前证据与经营判断。启动页仅提供入口，不包含经营指标或效果承诺；输入是用户的启动/状态/排障请求，判断依据是本机工具实际返回，动作限于工具发现、展示、启动、停止和已有有限恢复，交付为可用入口及真实结果。SOP 未覆盖 HTML 桥接或桌面启动，不套用业务阈值。
