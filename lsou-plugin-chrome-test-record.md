# 来搜Plugin Chrome 实测记录

测试时间：2026-06-24

测试方式：按用户要求派出页面级 subagent，使用 `@chrome` 打开页面并实测。每个页面只读验证，不登录、不导出、不下载、不修改线上页面。对有输入框的页面，优先填入测试词后点击，避免空输入触发原生 alert 卡住 Chrome 自动化。

## 总体结论

- 13 个 Plugin skill 页面均已完成 Chrome 实测记录。
- 6 个页面存在真实或疑似真实业务取数行为：数据看板、店铺诊断、商品诊断、爆品培育、广告诊断、爆品追踪。
- 7 个页面更像静态模板或前端模拟：品牌广告诊断、新店运营计划、市场分析、选品经理、关键词采集、标题制作、标题+卖点制作。
- 多数页面未显示明确登录/绑定店铺阻断，但真实取数类页面依赖来搜账号、Alibaba/店铺登录态、ctoken 或扩展能力。Plugin 初始化必须提示用户先安装来搜插件、登录来搜账号并绑定店铺。
- 多个页面存在原生 alert、空数据、静态占位链接、导出按钮、CSV/Excel 名称不一致、表格为空但页面正常等情况。Plugin 不能只做点击，需要写异常分支。

## 逐页结果

### 1. 数据看板

- Skill：`lsou-business-dashboard`
- URL：`https://test.l-sou.cn/index.html`
- 页面作用：查看经营驾驶舱，展示 GMV、询盘、商品、团队表现和 AI 建议。
- 实测状态：可打开，无登录页阻断，显示店铺/公司 `蓝图合成智造科技`。
- 时间控件：默认 `按月 2026-05`，可切 `按周 2026-W25`、`按日 2026-06-22`。
- 主要按钮：`同步数据`、`导出报告`、AI 指令输入与 `发送指令`。
- 数据情况：GMV 目标 `$15W` 完成 85%，询盘目标 600 完成 76%，商品 Top 10、团队表现 9 行、AI 建议 4 条。
- 风险：点击 `同步数据` 后页面数据变化，但未观察到新增网络请求；不要直接声称实时后台同步成功。
- Plugin 处理：Ask User 询问月/周/日；同步后要区分“页面已显示数据”和“已验证后台实时同步”。

### 2. 店铺诊断

- Skill：`lsou-store-diagnosis`
- URL：`https://test.l-sou.cn/diagnosisSKILL/store-diagnosis.html`
- 页面作用：做店铺维度诊断，包含类目、产品、营销、国家和执行计划。
- 实测状态：可打开，无登录页阻断。
- 时间控件：默认 `按月 2026-05`，可切周/日。
- 数据情况：核心五项指标有值；子类目表约 24 行；部分产品/营销/品牌表为空或仅有表头；国家 Top 10 与执行计划有数据。
- 异常：页面标题写 `2026年04月`，但选择器是 `2026-05`；切换周/日只改选择器，不代表内容已刷新。
- Plugin 处理：同步前不要声称内容对应新周期；逐表判断空数据，不能把整页直接判失败。

### 3. 商品诊断

- Skill：`lsou-product-diagnosis`
- URL：`https://test.l-sou.cn/diagnosisSKILL/store-product-diagnosis.html`
- 页面作用：按商品维度诊断点击、访客、转化和零效果商品。
- 实测状态：可打开，店铺显示正常。
- 真实取数：点击 `同步数据` 后抓到 200 条商品数据，控制台显示商品 API 成功。
- 时间控件：默认月，可切周/日。
- 数据情况：商品总表 200 行；高点击高转化 0；高流量低转化 0；高访客低转化 1；无流量商品 200。
- 异常：部分 KPI 是占位或硬编码，例如 `优质产品数 -`、`主图视频覆盖率 -`；页面有标题残留 `</h2>`。
- Plugin 处理：空分类代表没有符合条件的商品，不一定是失败；缺失 KPI 要明确提示为未取到/占位。

### 4. 爆品培育

- Skill：`lsou-hero-cultivation`
- URL：`https://test.l-sou.cn/diagnosisSKILL/store-hero-cultivation.html`
- 页面作用：按爆品、优品、潜力优品、普通品、低质品分类做培育导航。
- 实测状态：可打开，点击同步后商品 API 成功。
- 主要按钮：`同步数据`、`导出报表`。
- 数据情况：总数爆品 0、优品 37、潜力优品 802、普通品 5、低质品 0；商机品与交易品也有分类统计。
- 异常：潜力优品 KPI 802，但表格只渲染约 200 行；图片列为空。
- Plugin 处理：空的爆品/低质品是有效结果，不是失败；表格行数可能是分页/截断，不等于 KPI 总量。

### 5. 广告诊断

- Skill：`lsou-ad-diagnosis`
- URL：`https://test.l-sou.cn/diagnosisSKILL/store-ad-diagnosis.html`
- 页面作用：选择广告计划和日期范围，诊断广告投放表现。
- 实测状态：可打开，读取到 38 个广告计划。
- 默认条件：计划 `营销助力方案`，日期 `2026-06-17` 至 `2026-06-23`。
- 主要按钮：`同步数据`，点击时会变为 `正在同步...`。
- 数据情况：同步后 KPI 全为 0，计划表显示 `暂无消耗数据`，地域/关键词等报告为空。
- 异常：切换部分 tab 可能残留旧内容；控制台有 `store/time.js` 和 `banUrl` 类错误。
- Plugin 处理：必须 Ask User 选择广告计划与日期范围；全 0 或暂无消耗属于有效无数据状态。

### 6. 品牌广告诊断

- Skill：`lsou-brand-ad-diagnosis`
- URL：`https://test.l-sou.cn/diagnosisSKILL/brand-ad-diagnosis.html`
- 页面作用：展示品牌广告效果、品牌词、关键词、产品报告。
- 实测状态：可打开，无登录/权限阻断。
- 数据判断：页面源码存在 `mockData` 与“模拟数据更新”，无 fetch/XHR/axios。
- 主要按钮：`同步后台数据` 只显示 toast；`导出诊断报表` 也是前端提示。
- 数据情况：展示固定样例，例如 2026-05-30 曝光 185400、点击 7600 等。
- 异常：顶部筛选问鼎/全域聚量等会报缺少 KPI DOM；产品链接为 `#`，图片为空。
- Plugin 处理：必须标为静态/演示页；不能声称已同步真实品牌广告后台。

### 7. 爆品追踪

- Skill：`lsou-hero-tracking`
- URL：`https://test.l-sou.cn/explosivePDUS/hero-tracking.html`
- 页面作用：追踪爆品列表和相关商品指标。
- 实测状态：可打开，ctoken 与商品 API 请求成功。
- 数据情况：同步后表格仍为空，页面显示 `暂无数据`；控制台显示筛选 `prodLevel3=爆品` 后 0 条。
- 主要按钮：`同步数据`、`导出报告`。
- 异常：导出按钮即使空表也可用；缺 ctoken 时会提示先登录阿里后台。
- Plugin 处理：0 爆品是有效业务结果；不要把它当请求失败。不得记录或复述 token/JWT/cookie。

### 8. 新店运营计划

- Skill：`lsou-new-store-plan`
- URL：`https://test.l-sou.cn/operationsCOTNT/new-store-plan.html`
- 页面作用：新店运营 SOP/任务计划模板。
- 实测状态：可打开，无登录/绑定 UI。
- 数据判断：静态模板，无 fetch/XHR/axios/form submit。
- 主要按钮：`导出执行报告` 仅 alert；`分享进度到微信` 为模拟二维码/弹窗。
- 表格情况：21 个任务，含负责人输入、截止日期、状态下拉。20 个待启动，1 个进行中。
- 异常：页面进度显示 4.8% 和完成 1/21，但表格没有 `已完成` 行；多个阶段链接相对路径会 404；无保存按钮。
- Plugin 处理：只能作为计划模板读取/整理；不要声称已保存任务或真实导出 PDF。

### 9. 市场分析

- Skill：`lsou-market-analysis`
- URL：`https://test.l-sou.cn/operationSKILL/ops-market.html`
- 页面作用：输入产品名后生成 8 阶段市场穿透分析。
- 实测状态：可打开，无登录/绑定/权限阻断。
- 输入与按钮：`#productInput`，按钮 `一键 L-SOU 市场穿透`。
- 点击结果：填 `Camping Chair` 后，日志从 `[START]` 到 `[SUCCESS]`，结果区展示 86/100 和 8 个阶段表格。
- 数据判断：点击后没有新增网络请求；脚本无 fetch/XHR/axios/WebSocket/EventSource。纯前端模板模拟。
- 异常：空输入会 alert；结果中出现不适配 Camping Chair 的字段，如 APP 连接、4.5L 容量、HS 8543。
- Plugin 处理：Ask User 问产品、目标市场、国家、是否需要真实数据；不能声称实时抓取 Google Trends/Amazon/1688/关税数据。

### 10. 选品经理

- Skill：`lsou-product-selection`
- URL：`https://test.l-sou.cn/operationSKILL/ops-selection.html`
- 页面作用：输入产品名后模拟全链路选品穿透，展示分组、候选品、定品、资料和 KPI。
- 实测状态：可打开，无登录/绑定/权限阻断。
- 输入与按钮：`#pName`，按钮 `一键 L-SOU 选品穿透`。
- 点击结果：填 `Camping Chair` 后，状态区追加分组、TOP RANKING、市场参谋、流量参谋、AI Agent 模拟日志，最终 `[SUCCESS]`。
- 数据判断：点击后无业务网络请求，脚本无 fetch/XHR/axios；静态模拟。
- 异常：空输入会 alert；B/C/D/E 面板本来已在 DOM 中，只是隐藏；点击不会自动切换到 B。
- Plugin 处理：Ask User 问产品、目标市场、真实数据来源、输出目标；不能声称已真实穿透榜单/市场参谋/流量参谋。

### 11. 关键词采集

- Skill：`lsou-keyword-collector`
- URL：`https://test.l-sou.cn/operationSKILL/keyword-collector.html`
- 页面作用：输入关键词后生成关键词穿透与整理结果。
- 实测状态：可打开，无登录/绑定阻断。
- 输入与按钮：关键词 textarea，按钮 `一键 L-SOU 关键词穿透`、`关键词批量导出`。
- 点击结果：填 `Smart Pet Feeder` 后，状态从 `[READY]` 到 `[SUCCESS]`，表格出现固定样例关键词，如 `Smart Pet Feeder`、`Automatic Cat Feeder`。
- 数据判断：无新增网络请求，静态模拟/预置输出。
- 异常：空输入会 alert。
- Plugin 处理：Ask User 问种子词、目标市场、语言、是否有真实词库；不能声称真实连接关键词库或平台搜索词。

### 12. 标题制作

- Skill：`lsou-title-generator`
- URL：`https://test.l-sou.cn/operationSKILL/ops-title.html`
- 页面作用：生成 Listing 标题建议。
- 实测状态：可打开，无登录/绑定阻断。
- 输入项：精选关键词库、核心产品属性、目标人群/国家；另有隐藏产品核心名称输入。
- 主要按钮：`生成 AI 标题建议`、`导出标题 (.CSV)`、`批量复制`、跳转标题+卖点/主图制作。
- 数据判断：页面初始已有 Smart Pet Feeder 固定样例；点击会 alert，偏静态/演示，不像真实 AI 后端。
- 异常：不要使用隐藏输入；CSV 不是 Excel 工作簿。
- Plugin 处理：Ask User 问产品、关键词、市场、标题长度/平台规则；不能声称真实 AI 后端生成或保存。

### 13. 标题+卖点制作

- Skill：`lsou-title-selling-points`
- URL：`https://test.l-sou.cn/operationSKILL/ops-title-selling-points.html`
- 页面作用：根据关键词、产品、市场和卖点生成标题与五点卖点草稿。
- 实测状态：可打开，无登录/绑定/权限阻断。
- 输入项：精选关键词、产品核心名称、目标客群与国家、核心功能点。
- 模式：导入词库表、AI 自动搜词。
- 主要按钮：`AI 一键生成标题与卖点`、`从“关键词大师库”导入`、`导出为 EXCEL (CSV)`、`复制到剪贴板`、`保存当前方案`、`下一步：主图制作`。
- 点击结果：填 `Smart Pet Feeder`、`US`、`WiFi Control, 4L Capacity, Anti-Clogging` 后，生成标题 `Professional Smart Pet Feeder with WiFi Control & 4L Capacity for US`，五点卖点为 WIFI CONTROL、4L CAPACITY、ANTI-CLOGGING、DURABLE MATERIAL、EASY INSTALLATION。
- 数据判断：无真实业务 API，请求；内联脚本 setTimeout 后拼接标题和卖点，前端模拟。
- 异常：无 required 校验，空值会用默认兜底；导入关键词是固定样例并 alert；保存方案无实际 onclick；导出为 CSV，不是真 `.xlsx`。
- Plugin 处理：Ask User 问产品、市场/客群、3 个核心卖点、关键词、输出语言和平台规则；不能声称真实 AI、VoC、关键词库或后台保存。

## Plugin 层建议

1. 初始化提示

- 需要安装来搜插件。
- 需要登录来搜账号。
- 需要绑定店铺。
- 真实取数类页面还需要 Alibaba/店铺后台登录态正常。

2. Ask User 建议

- 数据看板、店铺诊断、商品诊断、爆品培育：询问按月/周/日查看。
- 广告诊断：询问广告计划与日期范围。
- 市场分析、选品、关键词、标题、标题+卖点：询问产品名、目标国家/市场、关键词/卖点、是否需要真实数据。

3. 异常处理

- 未登录/未绑定：提示用户先登录并绑定店铺，不继续硬点。
- 无 ctoken/扩展 ID：提示用户检查 Alibaba 后台登录态与浏览器扩展。
- 无数据：输出“页面成功打开但当前条件无数据”，不要当失败。
- 静态/模拟页：明确告诉用户这是模板化输出，不要包装成真实后台数据。
- alert：不要通过空输入触发页面 alert；缺参数时优先 Ask User。
- 导出按钮：默认不点击，除非用户明确要求导出；CSV 不要说成 xlsx。
- 占位链接：遇到 `#`、`javascript:void(0)` 或 404，不作为稳定工作流依赖。

4. 需要回写 Plugin 的重点

- 每个 skill 的 `SKILL.md` 应补充实测 URL、tool name、页面打开步骤、等待数据策略。
- 静态模拟页面应降低表述强度，改成“生成草稿/模板化分析/检查清单”。
- 真实取数页面应写清楚同步后怎么判断成功、怎么处理空数据和部分表为空。
- 初始化/总 prompt 应加入安装来搜插件、登录来搜账号、绑定店铺的前置提醒。
