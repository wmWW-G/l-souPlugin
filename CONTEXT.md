# workctl 经营数据面板项目上下文

## 项目目标

本项目是一个仅在本机运行的阿里国际站经营与产品发布工作台。浏览器访问本地 Node.js 服务：经营数据继续通过只读白名单调用 WorkCTL，用户明确确认的产品草稿/正式发布则进入独立的串行写队列。

当前项目已经取代此前同目录中的“来搜Plugin”浏览器编排包。旧的 13 个 Skill、Plugin ZIP、教程图和 Chrome 历史验收材料不再属于当前工程。

## 技术栈与入口

- 后端：零第三方依赖的 Node.js HTTP 服务，入口为 `server.js`。
- 前端：原生 HTML、CSS 和 JavaScript，入口为 `public/index.html`。
- 启动脚本：`start.sh`。它动态解析当前 Accio 账号、活动 space、runtime 凭据和 Workctl 版本，完成认证与 schema 预检后执行 `node server.js`。
- 默认地址：`http://127.0.0.1:8787`。
- 使用说明：`README.md`。

这种技术栈无需安装依赖，启动和迁移都很轻；代价是后端能力集中在单个文件中，随着端点、鉴权、数据转换和测试增多，需要及时拆分模块以避免维护成本快速上升。

## 请求与数据链路

1. 用户通过 `public/index.html` 操作日期、标签页、筛选器、排序、分页或命令控制台。
2. `public/app.js` 请求本地 `/api/q/<endpoint>`、`/api/dashboard/product-analysis`、`/api/workspaces/<module>`、`/api/demo`、`/api/endpoints`、`/api/log` 或 `/api/cache/clear`。店铺装修、素材工坊、知识库与接待、账号与权限通过 workspace 路由读取当前账号真实业务字段，联系人使用独立的 `/api/workspaces/access-contacts`，慢查询不阻塞成员首屏。产品发布页用 `GET /api/publish/account-context` 读取当前账号的类目和参考商品，此时才在后台恢复并校验全店历史图库；初始待发布列表保持为空，前端用 `GET /api/publish/image-library/status` 显示同步进度。用户选择从零创建时再用 `GET /api/publish/category-schema` 生成对应类目的属性和官方选项；选择店铺已有商品时，`POST /api/publish/account-images` 返回可勾选的历史主副图、规格图和商详图，`POST /api/publish/account-reference` 再使用同一个短期随机令牌联合读取模板与现有商品的属性、交易、履约和卖点资料；`GET /api/publish/categories` 只用于主动搜索更换类目，`GET /api/publish/upload-capability` 检查图片服务，`POST /api/publish/images` 上传新图片，`POST /api/publish/reference` 导入外部参考链接，`GET /api/publish/jobs` 读取队列，并在最终确认后用 `POST /api/publish/enqueue` 写入队列。
3. `server.js` 用 `ENDPOINTS` 校验只读端点和允许参数，把 camelCase 业务字段转换为 Workctl schema 要求的 kebab-case 参数；发布写路由不复用该白名单，而是单独执行同源 JSON、确认短语、幂等键、服务端字段复核和批量上限检查。
4. Workctl 返回 JSON 后，服务端解析并缓存 5 分钟，再由前端渲染 6 项核心 KPI、经营链路、趋势、数据驱动待办、渠道/国家/商品诊断摘要，以及各业务详情页。RFQ 数据会在服务端移除买家姓名、账号、跳转链接和报价正文后再进入浏览器。

## 关键模块与状态

- `server.js`：定义 `ENDPOINTS` 只读白名单、参数构造、Workctl 执行、JSON 解析、缓存、命令日志、REST API 和静态文件服务；产品发布部分先通过 `data-advisor-shop-product` 分页读取当前账号已有商品与其 `categoryId`，对浏览器只保留标题、缩略图、类目和不可反推商品 ID 的短期随机令牌，再通过 `list-user-category`、`list-attribute`、`list-attribute-options` 生成对应类目表单。账号商品目录返回后，服务端以最多 4 个并发逐件调用 `icbu product list-information --query-type trunk --component-list images,detailImage,sku`，把主副图、规格图和商详图归一化后保存到当前 macOS 用户缓存目录；缓存文件用活动 Accio space 的哈希隔离且权限为 0600。用户主动选择店铺已有商品后，服务端才用令牌恢复内部商品号，联合调用 `publishflow query-template-info-by-id` 与 `icbu product list-information`：前者提供模板文本，后者提供现有商品的属性、价格、交期、包装、物流和卖点。外部链接导入仍使用模板命令。本地图片使用 `icbu other upload-file`，写入侧维护进程内串行队列，通过临时 0600 JSON 文件调用 `publishflow publish-from-json`。material 使用平台 `categoryId + basicInfo / trade / fulfillment / detail` 嵌套结构；完整商品素材、上传 bucket、真实商品号和失败补全路径都不会进入浏览器响应。
- `start.sh`：从 Accio 本地 `/health` 识别活动 space，从账号 runtime 文件仅向进程环境注入 gateway 凭据，根据当前插件清单定位 Workctl，并在启动服务前完成健康与 schema 预检。
- `public/app.js`：定义页面数据请求和交互；主要状态包括经营汇总 `summaryRows`、当前 KPI `curKpi`、商品分页排序 `pState`、完整商品分析 `productAnalysisData`、流量数据 `flowRaw`、地域排行 `regionRows`、访客分页 `vState`、RFQ 商机池 `rfqState`、产品发布本地素材与真实队列快照 `publishState`、知识目录检索与阅读状态 `knowledgeLibraryState`、控制台端点 `EPS` 和标签页加载状态 `LOADED`。客户页联合读取访客行为、店铺回复质量和买家画像；商品页对商品效果记录计算曝光 × 点击率四象限；流量页合并渠道、国家、画像、搜索词和市场机会；关键词广告页区分店铺词库、可售资源和投放效果；RFQ 页联合站内、站外、详情与报价历史。订单物流与风险合规由 `public/operations.js` 覆盖对应 LOADERS，使用实时运营接口；旧静态渲染函数只保留为历史代码，不再作为导航入口。店铺装修、素材工坊、知识库与接待、账号与权限分别由 `loadStorefrontOnePage()`、`loadAssetsOnePage()`、`loadKnowledgeOnePage()`、`loadAccessOnePage()` 调用 `/api/workspaces/` 实时接口，再用对应 `render*OnePage()` 展示公司资料、真实商品和 3D 资产、知识与策略正文、成员及联系人原值；知识页会把商家问答、公共 FAQ 和辅助/自动接待策略组成统一内容目录，点击后在同页阅读完整原文及平台实际返回的元数据。真实为空或接口超时都不会由 Demo 数据填充。产品发布页初始 `products=[]`，已有商品只保存在 `accountProducts` 参考库；“发布新产品”可选择 `blank` 或 `reference`，创建成功后才加入左侧待发布列表。类目在创建时按内部 `categoryId` 实时生成右侧参数。参考商品和“复制同类”的纯数据映射集中在 `public/publish-product-utils.js`；图片排序统一维护 `gallery` 与封面。草稿和正式发布进入服务端并发 1 的真实 WorkCTL 队列。
- `public/index.html`：定义左侧业务信息架构与右侧行动优先工作区。侧边栏名称、分组和顺序是当前产品设计基线；“市场机会”内容按用户要求并入“流量分析”，不再单列入口。“运营待办”保留现状，后续只读取 Dify 的结构化输出。
- `public/style.css`：负责来搜品牌浅色工作台、220 px 桌面固定边栏、68 px 收起态、窄屏横向导航、结果数据带、行动清单、诊断摘要、表格、图表、弹窗、日志和响应式布局。六个连续业务单页共用一页式标题和 1180 / 820 / 520 px 响应式骨架，但分别采用订单状态刻度、风险双层口径、店铺首页三栏规划台、素材工具架、知识目录与正文阅读台、成员目录与权限矩阵，避免相同卡片模板重复套用。知识页在桌面端使用双栏资料台，移动端切换目录/正文；桌面端产品发布页使用固定窗口工作区：顶部状态与紧凑进度、底部批量操作保持可见，左右两张卡片独立纵向滚动。
- `demo-data/workctl-demo.json`：用于页面设计和本地演示的脱敏业务 Demo，保存真实汇总、趋势、分布、样本状态、真实空状态，以及产品发布页已核对的字段、命令链路和脱敏写入审计；不保存买家、联系人、账号、订单、商品标识或凭据。
- `demo-data/workctl-command-audit.json`：保存 124 个查询 Schema 的实跑审计汇总、受阻原因和零写操作边界。
- `design-pages/`：保存按当前固定侧边栏逐页生成的页面截图；生成模型草图放在 `imagegen-drafts/`，不得与浏览器实拍验收图混用。
- `public/assets/lsou-logo-square.png`：官网同款方形应用标识和 favicon。
- `public/assets/lsou-logo-new.png`：经营概览使用的新版透明品牌签名。
- `design-qa.md`：Product Design 对比证据、响应式与交互验收记录。
- `server.log`：历史启动日志，不是代码事实源，也不得写入 token 或其他敏感信息。

## 安全与修改边界

- `ENDPOINTS` 和每个端点的 `flags` 是安全边界；增加命令前必须先查看当前 Workctl schema，并确认命令为只读。
- 继续使用 `execFile` 的参数数组，不得拼接 shell 命令。
- 服务必须只监听 `127.0.0.1`，未经明确设计和鉴权不得暴露到局域网或公网。
- Gateway token 只能通过服务进程环境临时注入，不得进入前端代码、日志、README、Git 或对外响应。
- 商品质量诊断、TM 最近会话、广告效果和 RFQ 报价权益接口在当前网关偶发长时间不结束。主页面不让这些慢命令阻塞首屏：实时商品效果、访客画像、广告词资源、RFQ 商机与报价历史照常查询；质量诊断、最近会话汇总、广告效果核验和报价权益展示 `/api/demo` 中最近一次已实跑的脱敏快照，并明确标注快照日期与实时状态。
- 用户于 2026-09-05 授权实现五条运营能力，并确认沿用原生 JavaScript + Node.js。现开放上传发品图片、保存/发布新商品、编辑并提交已有商品内容草稿、平台诊断优化、图片与视频生成；每次实际写入仍由页面展示具体范围并确认。改价、修改广告、发送消息、删除、保存接待策略未在本轮范围内。图片上传所需 bucket、endpoint 和路径前缀只能由管理员通过 `PUBLISH_IMAGE_BUCKET`、`PUBLISH_IMAGE_ENDPOINT`、`PUBLISH_IMAGE_PATH_PREFIX` 配置，页面不提供也不返回这些内部参数。
- 产品发布写接口必须只接受同源 `application/json`，要求确认短语和长度合格的幂等键，并在服务端重新校验字段。队列通过 `publish-from-json` 获得质量分、字段修正和结构化失败结果；单品逐条执行时由服务端维持至少 1 秒提交间隔，失败不会自动重试，用户修改资料并再次确认后才生成新的写任务。队列状态区分 `queued`、`running`、`saved_draft`、`submitted` 和 `failed`；`submitted` 只表示已经提交平台流程，不等于审核通过或商品在线。同一请求内所有任务共享 `operationId`，并有从 1 开始的 `position` 与 `total`，前端据此计算总进度和结果汇总。WorkCTL 返回的 `itemJsonPath` 只保留在服务进程内用于排障，页面只显示“图片、属性、价格、包装”等业务区域。
- 产品图片分两类：已有商品的远程 HTTP(S) 图片可直接进入队列；用户新选的 JPG、PNG、WEBP 图片会先在浏览器预览，再由服务端校验图片签名和 8MB 上限并通过 `icbu other upload-file` 转成远程 URL。没有配置 `PUBLISH_IMAGE_BUCKET` 时，工作台仍可启动，但新增上传入口会禁用并明确提示。全店历史图库与普通 5 分钟接口缓存不同：用户进入产品发布页并请求账号上下文后，服务端才恢复 `~/Library/Caches/com.lsou.workctl-dashboard/publish-image-library-<活动账号哈希>.json`，再在后台补齐新增、修改或超过 24 小时的商品；服务启动本身不扫描图库，以免抢占其他实时查询。每批落盘，切换回已缓存商品不重复查询。清除缓存时会同时删除这份精确的账号缓存文件。待发布列表不再注入任何 Demo 商品：用户必须先选择从零创建、参考店铺已有商品或导入图片文件夹。创建时按内部 `categoryId` 实时取得属性与官方选项，用户只看业务名称，系统内部维护编码；固定单选会提交 WorkCTL 返回的正整数 `attrValueId`，服务端入队前再次按实时 Schema 检查类目归属、必填项和 ID/文字配对。参考商品导入带入类目、标题、用户勾选的最多 10 张旧图和可用文本，固定属性仍按当前账号的实时 Schema 重新生成。计价单位和运费方案同样不要求用户填写内部 ID：`GET /api/publish/business-options` 复用当前账号商品目录并结合少量 `product_query_information` 结果读取店铺实际使用值，前端只显示业务名称，服务端在入队前自动匹配并复核；没有可读取运费方案时省略可选字段并沿用国际站账号默认设置。2026-09-03 的首次真实草稿因旧扁平 material 结构被拒绝；改成 `categoryId + basicInfo / trade / fulfillment / detail` 嵌套结构后，用户再次确认的同一商品真实草稿已返回 `saved_draft` 并保存到国际站草稿箱。
- 真实队列当前保存在 Node 服务进程内，服务重启后不恢复；队列不保存完整素材到磁盘。若要支持跨重启续跑，需要另行设计加密持久化、任务对账和远端状态恢复。
- 标准入口必须使用 `./start.sh`，不要依赖 `server.js` 中兼容保留的历史默认路径。脚本会用当前活动 space 的真实二进制覆盖 `WORKCTL_BIN`。
- 从普通终端或 Codex 启动时，不再手工复制 gateway URL 和 token；`start.sh` 会临时注入服务进程环境。Accio 在服务运行期间重启后，需要重新运行脚本以更新凭据。

## 常见修改位置

- 增加或调整只读数据端点：修改 `server.js` 的 `ENDPOINTS`，并同步检查参数白名单和前端调用。
- 调整字段解析、筛选、分页、排序或图表：修改 `public/app.js`。
- 调整商品四象限：同时检查 `server.js` 的 `getProductAnalysis()` 和 `public/app.js` 的 `renderProductAnalysis()`；商品分页并发上限为 4，避免拖慢同一网关的其他页面。
- 调整产品发布矩阵、字段编辑或真实队列：前端修改 `public/index.html`、`public/style.css` 和 `public/app.js` 中的 `PUBLISH_CATEGORY_CONFIG` / `registerLivePublishCategory()` / `publishState` / `renderPublish*` / `startPublishQueue()`；后端修改 `server.js` 的 `loadPublishCategories()`、`loadPublishCategorySchema()`、`validatePublishProductSchema()`、`normalizePublishProduct()`、`enqueuePublishJobs()` 和 `processPublishQueue()`。不要再手工增加新类目；页面应通过实时搜索和 Schema 注册自动适配。
- 调整总览待办规则：修改 `public/app.js` 的 `renderActionItems()`；必须继续只从真实返回字段推导，不能补写无法核验的任务数量、负责人或业务影响。
- 调整店铺装修、素材工坊、知识库与接待、账号与权限：修改 `server.js` 的 `load*Workspace()` 与 `/api/workspaces/` 路由，再修改 `public/app.js` 的 `load*OnePage()` / `render*OnePage()`；必须保留真实空状态、35 秒硬超时和密钥不下发边界，不得重新接回静态 Demo。
- 调整页面结构和文案：修改 `public/index.html`。
- 调整视觉样式：修改 `public/style.css`。
- 更换品牌图时优先替换 `public/assets/` 中对应文件，并保持现有文件名、透明背景和宽高比例，避免同时修改多个消费位置。
- 不要直接修改 Accio 历史 space 中的源目录；本目录才是后续开发事实源。

## 本地验证

先做静态检查：

```bash
node --check server.js
node --check public/app.js
node --test test/*.test.js
```

先打开并登录 Accio Desktop，然后直接启动：

```bash
./start.sh
```

随后先检查 `http://127.0.0.1:8787/api/health` 返回 `ready`，再检查 `/api/endpoints` 并在浏览器中逐个核验页面。结构检查只能证明代码可解析；只有真实 Workctl 调用成功并核对返回数据后，才能声称数据链路跑通。


## 2026-09-05 五条运营扩展

- `lib/operations.js`：`READS` 与 `WRITES` 固定业务命令，按实际副作用分类，不能信任部分错误的 `mutating:false` 元数据。调用使用 0600 临时 JSON 参数文件、数组参数和硬超时；嵌套 JSON、业务失败与异步状态分别处理。
- `lib/operations-contracts.json`：当日现场读取的动态参数合同。增加命令先重新核验 schema；实际商品草稿提交命令为 `icbu product submit-draft`，并不存在先前评价里提到的 `submit-product-edit`。
- `public/operations.js` 在 `app.js` 后加载：替换 orders/risk/assets 的页面加载入口，并为 product/visitor/flow/overview 增加业务区域。原有页面查询与新区域加载互不等待。商品整改建议按钮通过 `data-ops-optimize-query` 带入商品名称搜索。
- `/api/operations/read` 的 products 查询返回30分钟随机商品引用；内部商品号和类目从当前店铺结果提取。messages/buyer-basic 必须使用 conversations 返回的引用，卖家身份从平台 sellerAliId/selfAliId 字段读取；历史消息分页支持真实返回的 nextPointTimeStamp。
- `/api/operations/jobs`：写入先占用幂等键，再异步执行，避免并发重复提交；相同键不同参数拒绝。同一商品有待核对写入时阻止继续操作。save-edit 的基础信息和详情串行保存，部分成功会报告已完成步数，提交必须引用该商品最新成功保存的任务。
- 新任务状态为 queued/running/submitted/processing/succeeded/failed/unknown/interrupted。任务记录与上游结果、生成凭据按活动账号哈希保存到用户缓存目录；不保存请求素材。重启后绝不自动重放未知写入，仅允许用已有生成凭据继续查询结果。运行日志记录开始、结束与状态，不写请求参数。
- 素材原图通过 product-info 从当前商品读取；不直接把经营接口的100像素缩略图用作生成原图。视频分镜必须有描述与有效秒数，分镜生成和视频生成分别确认。
- 订单、物流、风险、客户会话及新增行业查询不降级到 Demo；旧商品质量数量等未改动的历史快照仍由原页面明确标注。
- 单元/HTTP隔离测试见 `test/operations.integration.test.js`，覆盖实体引用、五类查询、保存/提交、确认、跨源拒绝、并发幂等、重启恢复与不确定写入。

## 客户与询盘工作台（2026-09-05）

- `public/index.html` 的客户页分为左侧默认“客户分析”和右侧“会话工作台”；`customerMetrics` 是共用紧凑指标带，原有访客分析容器归入 `customerAnalysis`，数据仍由 `public/app.js` 更新。
- `public/operations.js` 的 `customers()` 创建三栏工作台：最近会话 / 消息 / 买家背景。选择会话自动读取消息和买家画像；请求版本号阻止快速切换时旧响应覆盖新客户，历史消息按时间合并去重。列表搜索只筛选已加载的客户。
- 商品目录在展开“查看商品资料”后才加载；商家资料独立展开。这里只读取现有会话，不提供消息发送。桌面三栏独立滚动，较窄窗口将背景移到下方。
- 验证：`node --check public/operations.js`、`node --check public/app.js`、`node --test test/*.test.js`；浏览器打开 `/?tab=visitor`，检查客户选择自动读取、搜索、历史按钮、视图切换和商品资料展开。

## 商品四象限与弹窗编辑（2026-09-05）

- 商品页已移除“全部商品效果”面板和独立全店商品选择器。`loadProductPage()` 只读取完整分析，四象限切换 `productFocusMode` 并重置 `productFocusPage`，完整匹配结果每页 20 件。
- `server.js` 的完整分析为每个商品调用 `operations.registerProduct()` 发放 30 分钟引用，避免按标题搜索关联错商品。`focusProducts` 不再截断为前 8～10 件；无有效编号的记录不能编辑。
- 点击列表商品或操作按钮打开 `productEditDialog`，自动读取该商品线上内容。原有草稿保存、诊断优化及确认提交链路复用，任务记录保留在页面；弹窗只填写需要覆盖的字段。
- 商品漏斗与质量诊断收窄为六个紧凑条目；四象限保留为主筛选入口。验证商品筛选数量与分页、弹窗商品标题及线上内容一致、关闭后任务记录可见。

- 商品编辑弹窗现在自动填入线上标题、关键词、卖点、公司介绍并直接展示主图；参照发布参考商品的读取字段补齐属性、价格、MOQ、库存、交期与包装物流，交易履约目前只读。加载失败禁用保存，快速切换用请求版本号隔离。保存前与读取基线比较，仅提交改变的字段；不支持通过留空删除已有内容。

- `productEditDialog` 采用发布页相同的分区表单风格：左侧六段导航、右侧独立滚动、固定操作栏。`ops-publish-layout` 只移动现有字段节点，不更换保存协议；`ops-read-attributes/trade/fulfillment/detail` 分别承接平台读取资料。
