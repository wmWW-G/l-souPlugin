# 来搜工作台插件

面向阿里巴巴国际站的经营、分析与产品发布工作台，运行于 Accio Work。采用 React + Tauri + Node.js，正式界面在桌面窗口中运行，安装包自带 Node 运行时。

仓库：[wmWW-G/l-souPlugin](https://github.com/wmWW-G/l-souPlugin)。这里保存当前源码、工程测试、运营方法和发布记录；安装包在维护者本地 `release/`，尚未上传 GitHub Releases。

## 当前交付基线

<!-- release-current:start -->
- Windows x64：1.0.11 更新辅助修订版 — `release/lsou-workbench-1.0.11-windows-x64-update-r2.zip`
- Mac M 芯片：1.0.10 — `release/lsou-workbench-1.0.10-macos-arm64.zip`
- Intel Mac：1.0.10 — `release/lsou-workbench-1.0.10-macos-x64.zip`
<!-- release-current:end -->

实际版本、构建标识、大小与 SHA256 以 [发布记录](release-manifest.json) 为准。用户确认 Windows 和 Mac 可用，Mac 反馈未说明芯片，不能据此认定两种 Mac 都完成实机验收。三个已确认的包保持原始内容；源码中的后续维护改动会在下一正式版本交付。

规范依据为本机 Accio Work **0.32.6** 和宿主内置 `plugin-create` **1.0.3**；插件版本独立递增，不表示已验证其他宿主版本。当前 Mac 使用临时签名、未公证，Windows 未做发布者签名。历次工程检查与实机反馈见 [开发日志](DEVELOPMENT_LOG.md)。

## 安装与更新

在已授权店铺的 Accio Work 空间导入对应电脑的 ZIP，安装启用后说“打开来搜插件”，点击启动页的“启动工作台”。插件连接时先待命，点击后自动启动后端与桌面窗口。普通用户无需安装 Node、Rust 或执行命令。

Windows 1.0.11 更新辅助版支持“停止来搜插件”“准备更新来搜插件”“取消来搜更新准备”。相同来源的新版 ZIP 可再次导入；Windows 如仍提示文件占用，完整退出 Accio Work（包括托盘）后重试。Mac 1.0.10 基线不因此获得这些新增指令。具体步骤见 [安装与更新说明](plugin/README.md)。

## 仓库结构

| 位置 | 内容 |
|---|---|
| `frontend/`、`public/` | React 入口、业务页面、正式界面资源 |
| `server.js`、`lib/` | 本地服务、店铺查询、报告和任务持久化 |
| `desktop/`、`src-tauri/` | 账号与进程管理、Tauri 桌面窗口 |
| `plugin/` | 插件清单、启动入口、35 份 Skill 及报告模板 |
| `scripts/`、`test/` | 构建、打包、发布管理和工程测试 |
| `docs/references/` | 国际站运营 SOP 原件与正文检索版 |
| `demo-data/` | 仅供开发使用的脱敏样本，不进入正式 ZIP |
| `dify-chatflows/` | 早期候选流程与兼容资料，不是当前分析入口 |
| `release-manifest.json` | 当前三平台包的冻结版本与校验记录 |
| [CONTEXT.md](CONTEXT.md)、[DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) | 模块约定、历史设计与验证证据 |

历史截图、设计草图及 `design-qa.md` 仅在本地留档，不再进入 Git。依赖、构建缓存、安装包、业务数据、日志和密钥同样不提交；正式界面使用的 `public/assets/` 继续版本管理。

## 本地开发与工程检查

维护者需要 Node/npm 和 Rust 工具链；桌面构建还需平台编译工具。Mac 开发环境启动：

```bash
npm ci
npm run build:frontend
./start.sh
```

`start.sh` 自动读取当前 Accio 账号、授权和命令入口，默认访问 `http://127.0.0.1:8787/react/`。先打开并登录 Accio Work；普通浏览器仅用于本地开发。

```bash
npm test
node --test test/release-management.test.js
npm run release:check
```

工程测试采用隔离数据和受控依赖，不代表 Skill 分析效果或三平台实机验收。`release:check` 需要本地当前三包，单独克隆源码不会获得安装包；恢复包后可按冻结 SHA256 校验。

运营查询使用当前账号授权；写入商品等动作保留独立确认。分析请求保存点击时的对象、日/周/月范围和输入资料，报告及任务历史按账号保存在本机；凭据不进入前端、Git 或正式交付包。

## 本地正式发布

插件身份固定为 `lsou-workbench`。后续正式版本使用高于全部冻结记录的 `x.y.z`，三平台统一版本；同名包禁止覆盖，不再用文件名修订后缀代替升级。当前基线不重新打包，下一版本示例为 `1.0.12`。

```bash
npm run release:check
npm run release:version -- 1.0.12
npm run build:desktop -- --target macos-arm64
npm run build:desktop -- --target macos-x64
npm run build:desktop -- --target windows-x64
npm run package:plugin -- --target macos-arm64
npm run package:plugin -- --target macos-x64
npm run package:plugin -- --target windows-x64
npm run release:publish -- --notes "本次实际变更与验收摘要"
npm run release:check
npm run release:prune
# 核对预览后，才执行实际清理
npm run release:prune -- --apply
```

构建与打包顺序执行，避免共享临时资源互相覆盖。Mac 需要 Xcode 命令行工具和对应 Rust target；Windows 可在原生系统构建，Mac 跨编译需要 cargo-xwin、LLVM、LLD 和 Windows Rust target。运行时固定 Node v22.22.0，下载后核对官方 SHA256。构建、打包与登记均检查源码指纹；不一致时重新构建。

每次只交付 Windows x64、Intel Mac、M 芯片 Mac 三个独立 ZIP；各附一份 `.sha256`。展开目录位于 `.build-cache/package-stage/`。`release:publish` 只登记本地记录并更新本页，不上传市场、不创建 GitHub Release，也不重装已安装插件。

## 分析功能与 Skill 清单（2026-09-18）

当前代码已绑定31个HTML报告Skill与1个执行任务Skill。各业务页顶部的“分析主题 → 开始分析”覆盖全部报告主题；定位按钮、广告专用按钮复用同一持久报告接口。选择主题、读取平台资料和查看历史都不会自动发起报告分析。启动、排障及兼容Skill不计入这32项。

机器可读目录见 [analysis-skills.json](plugin/analysis-skills.json)。[报告后端](lib/analysis-runs.js)读取该目录并验证Skill与允许入口页，[报告前端](public/analysis-reports.js)按服务端目录显示主题。广告诊断允许从数据分析与优化、运营推广两个页面进入；广告知识问答属于运营推广。每次请求记录实际入口页，历史也按该页展示。

| 页面 | 分析功能 | Skill | 当前入口状态 |
|---|---|---|---|
| 运营规划 | 新店运营规划 | [lsou-new-store-plan](plugin/skills/lsou-new-store-plan/SKILL.md) | 已绑定报告工具条 |
| 运营规划 | 老店运营诊断规划 | [lsou-established-store-plan](plugin/skills/lsou-established-store-plan/SKILL.md) | 已绑定报告工具条 |
| 运营规划 | 3月新贸节作战计划 | [lsou-march-campaign-plan](plugin/skills/lsou-march-campaign-plan/SKILL.md) | 已绑定报告工具条 |
| 运营规划 | 9月采购节作战计划 | [lsou-september-campaign-plan](plugin/skills/lsou-september-campaign-plan/SKILL.md) | 已绑定报告工具条 |
| 营销定位 | 市场与客群定位 | [lsou-market-positioning](plugin/skills/lsou-market-positioning/SKILL.md) | 已绑定报告工具条及定位开始分析按钮 |
| 营销定位 | 公司定位 | [lsou-company-positioning](plugin/skills/lsou-company-positioning/SKILL.md) | 已绑定报告工具条及定位开始分析按钮 |
| 营销定位 | 产品定位 | [lsou-product-positioning](plugin/skills/lsou-product-positioning/SKILL.md) | 已绑定报告工具条及定位开始分析按钮 |
| 营销定位 | 店铺装修文案 | [lsou-store-copy](plugin/skills/lsou-store-copy/SKILL.md) | 已绑定报告工具条及定位开始分析按钮 |
| 营销定位 | 详情页装修文案 | [lsou-product-detail-copy](plugin/skills/lsou-product-detail-copy/SKILL.md) | 已绑定报告工具条及定位开始分析按钮 |
| 运营基建 | 一键选品 | [lsou-product-selection](plugin/skills/lsou-product-selection/SKILL.md) | 已绑定报告工具条 |
| 运营基建 | 整理关键词 | [lsou-keyword-library](plugin/skills/lsou-keyword-library/SKILL.md) | 已绑定报告工具条 |
| 运营基建 | 批量标题 | [lsou-product-titles](plugin/skills/lsou-product-titles/SKILL.md) | 已绑定报告工具条 |
| 运营基建 | 批量发品规划 | [lsou-publishing-plan](plugin/skills/lsou-publishing-plan/SKILL.md) | 已绑定报告工具条 |
| 运营推广 | 广告策略 | [lsou-ad-strategy](plugin/skills/lsou-ad-strategy/SKILL.md) | 已绑定报告工具条 |
| 运营推广 | 广告诊断优化 | [lsou-ad-optimization](plugin/skills/lsou-ad-optimization/SKILL.md) | 已绑定报告工具条 |
| 运营推广 | 品广诊断优化 | [lsou-brand-ad-optimization](plugin/skills/lsou-brand-ad-optimization/SKILL.md) | 已绑定报告工具条 |
| 优爆品提升 | 优爆品提升 | [lsou-product-growth](plugin/skills/lsou-product-growth/SKILL.md) | 已绑定报告工具条 |
| 优爆品提升 | 核心品跟进 | [lsou-core-product-followup](plugin/skills/lsou-core-product-followup/SKILL.md) | 已绑定报告工具条 |
| 优爆品提升 | 单品历史数据 | [lsou-product-history](plugin/skills/lsou-product-history/SKILL.md) | 已绑定报告工具条 |
| 数据分析与优化 | 店铺诊断 | [lsou-store-diagnosis](plugin/skills/lsou-store-diagnosis/SKILL.md) | 已绑定报告工具条 |
| 数据分析与优化 | 产品诊断 | [lsou-product-diagnosis](plugin/skills/lsou-product-diagnosis/SKILL.md) | 已绑定报告工具条 |
| 数据分析与优化 | 广告诊断 | [lsou-ad-diagnosis](plugin/skills/lsou-ad-diagnosis/SKILL.md) | 已绑定报告工具条；运营推广也可进入 |
| 数据分析与优化 | 品广诊断 | [lsou-brand-ad-diagnosis](plugin/skills/lsou-brand-ad-diagnosis/SKILL.md) | 已绑定报告工具条 |
| 商机转化 | 优质RFQ信息采集 | [lsou-rfq-selection](plugin/skills/lsou-rfq-selection/SKILL.md) | 已绑定报告工具条 |
| 商机转化 | RFQ报价跟进表 | [lsou-rfq-followup](plugin/skills/lsou-rfq-followup/SKILL.md) | 已绑定报告工具条 |
| 商机转化 | 询盘明细分析 | [lsou-inquiry-diagnosis](plugin/skills/lsou-inquiry-diagnosis/SKILL.md) | 已绑定报告工具条 |
| 商机转化 | 客户列表分析 | [lsou-customer-segmentation](plugin/skills/lsou-customer-segmentation/SKILL.md) | 已绑定报告工具条 |
| 商机转化 | 询盘登记 | [lsou-inquiry-register](plugin/skills/lsou-inquiry-register/SKILL.md) | 已绑定报告工具条 |
| 商机转化 | 客户背调 | [lsou-customer-research](plugin/skills/lsou-customer-research/SKILL.md) | 已绑定报告工具条 |
| 商机转化 | 询盘分析与回复 | [lsou-inquiry-reply](plugin/skills/lsou-inquiry-reply/SKILL.md) | 已绑定报告工具条 |
| 共用入口 | 生成任务 | [lsou-planning-tasks](plugin/skills/lsou-planning-tasks/SKILL.md) | 已绑定任务卡，独立JSON回传 |
| 运营推广 | 广告知识问答 | [lsou-ad-knowledge](plugin/skills/lsou-ad-knowledge/SKILL.md) | 已绑定报告工具条及实际问题表单 |

### 显式分析入口与平台读取

所有报告主题均通过 `POST /api/advisor/reports op=generate` 生成；原生和React入口都已载入报告及任务脚本。运营基建四个步骤按钮只选择主题与资料，用户随后点击工具条“开始分析”。定位五个主题的“开始分析”保存对应页面资料，详情页文案携带用户所选商品，未选时不会默认取第一件。

| 运营推广专用入口 | 绑定Skill | 保存的范围 |
|---|---|---|
| 开始诊断分析 | `lsou-ad-diagnosis` | 当前广告资料及所选周期 |
| 开始策略分析 | `lsou-ad-strategy` | 当前投放资料 |
| 开始优化分析 | `lsou-ad-optimization` | 当前广告优化资料 |
| 计划详情 → 计划诊断 → 开始分析 | `lsou-ad-optimization` | 用户选定计划与实际问题 |
| 广告知识问答 → 开始分析 | `lsou-ad-knowledge` | 用户实际输入的问题 |

账户“读取平台诊断”“读取推荐方案”保留为平台只读资料来源，不调用本地报告Skill。知识问答和单计划分析表单只保留“开始分析”，点击或回车均走绑定Skill，携带实际问题；单计划同时保存用户选定对象。旧平台问答及单计划生成入口已撤下，不再并存两套分析路径。读取报表、筛选、分页、查看商品详情、下载、任务编辑和真实发布不计为额外分析入口。旧Dify侧栏已从 `public/advisor-services.js` 移除；原六页兼容接口不代表当前新工作台的报告入口。

### 报告与业务合同

31个报告Skill分别携带 `assets/report.html`。后端为每次请求保存资料、固定Skill及模板，要求宿主实际生成独立HTML文件；结果通过校验才进入报告历史。前端自动轮询状态，使用无额外权限的sandbox iframe展示，支持下载HTML，并保留报告原始周期。晚到结果归属原请求，不覆盖另一个主题或周期。

执行任务继续独立回传 `request_id + tasks[{work,reason}]`，最多8条；前端只展示“工作事项／为什么要做”。导入按规范化业务内容去重，保留人工编辑、完成、删除及历史状态。人工录入和编辑不触发报告分析。所有建议与实际执行分开；报告不能声称已经改品、投放或联系客户。

### 日、周、月如何影响分析

32份Skill均已定义“所选周期与分析尺度”：读取本次输入的 `period` 或 `selected_period` 中的 `mode`（兼容明确的 `grain`）、`startDate`、`endDate`，沿用用户点击时的选择。这里的“当前”指本次选定的范围，不是自动取今天或新增第四种粒度；页面之后切换周期不改变已经保存的请求。各Skill分别规定本主题的日、周、月判断重点，周期影响结论和动作，而不只是报告标题。

| 周期 | 判断与行动重点 | 证据限制 |
|---|---|---|
| 日 | 当日异常、实际询盘承接、执行阻塞和资料核查 | 不凭一天零询盘或少量点击推翻长期策略 |
| 周 | 连续变化、已有调整的复查和下一轮验证 | 需真实可比的周资料；自然周不等于任意近7天 |
| 月 | 持续趋势、经营结构、阶段成果与资源安排 | 仍需足够样本、完整数据与成熟归因；自然月不等于滚动30天 |

所选周期与每个来源的实际数据范围分别保留。平台广告诊断可能是以结束日为锚的近7天，客群是近30天，行业场景是90天，规划对标可能只有最新经营日；这些不能改名为所选月的表现。商品与培养页面当前仅支持日/月，不能靠叠加日访客制造周去重访客。周期缺失、冲突或资料未齐时交付不受影响的内容并列明缺项；纯文案、公司事实和单条询盘按实际适用时点处理，不强造业绩周期。

前端在点击时锁定周期、页面版本及所选对象，等待本页资料读取完成后保存完整副本；发生切换就停止此次发送。报告和任务后端都使用 `lib/analysis-context.js` 检查合法日期、起止顺序和日/完整周/自然月边界，不猜测缺失周期。关键词 `pv` 按搜索热度指数解释，`shopUv` 为本店访客数，两者不能直接比较来断定原因。

### 验证和交付边界

当前回归覆盖真实运行时目录的31个报告入口、广告四类按钮与单计划表单、快照等待及切换保护、历史回显与沙箱展示，以及任务持久化和人工状态保护。测试使用隔离存储和受控资料，不等于所有主题都已基于真实商家数据完成宿主分析；具体真实运行和浏览器验收结果见 DEVELOPMENT_LOG。

源码检查、正式打包和目标系统实机验收分别记录；当前包的验收边界见发布记录与开发日志。

历史上下文会核对各报告生成时的分析规则版本；规则更新前的报告继续保留供查看，但不会自动将旧结论带入新分析，以免已修正的判断再次被复制。
