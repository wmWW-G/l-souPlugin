# workctl 经营数据面板项目上下文

## 项目目标

本项目是一个仅在本机运行的阿里国际站经营与产品发布工作台。正式交付采用 React + Tauri + Node.js，本地测试仍可用浏览器访问 Node.js 服务：经营数据继续通过只读白名单调用 WorkCTL，用户明确确认的产品草稿/正式发布则进入独立的串行写队列。

当前项目已经取代此前同目录中的“来搜Plugin”浏览器编排包。旧的 13 个 Skill、Plugin ZIP、教程图和 Chrome 历史验收材料不再属于当前工程。

## 技术栈与入口

### 正式交付约定（2026-09-08）

本地开发和内部测试允许继续通过浏览器访问普通前后端服务；放入 Accio Work 的正式插件必须是 Tauri 版本。用户于2026-09-10改为先在Accio对话中展示HTML启动页，点击按钮后自动启动配套Node.js后端和Tauri窗口，待后端就绪后提供业务界面；MCP连接本身待命，不要求用户手动脚本或浏览器。用户已确认保留 Node.js 业务后端，正式前端采用 React。打包后的自动启动和窗口内真实业务链路必须独立验收。

下述普通入口用于本地开发；桌面封装的实现和验收状态见文末 React + Tauri 交付章节。

- 后端：零第三方依赖的 Node.js HTTP 服务，入口为 `server.js`。
- 正式前端：React，入口为 `frontend/main.jsx`；本地原生兼容入口保留 `public/index.html`。
- 启动脚本：`start.sh`。它动态解析当前 Accio 账号、活动 space、runtime 凭据和 Workctl 版本，完成认证与 schema 预检后执行 `node server.js`。
- 默认地址：`http://127.0.0.1:8787`。
- 使用说明：`README.md`。

本地 Node.js 业务服务无需第三方运行依赖；桌面构建需要 npm 和 Rust 工具链，交付包自带 Node.js。代价是后端能力集中在单个文件中，随着端点、鉴权、数据转换和测试增多，需要及时拆分模块以避免维护成本快速上升。

## 请求与数据链路

1. 用户通过 `public/index.html` 操作日期、标签页、筛选器、排序、分页或命令控制台。
2. `public/app.js` 请求本地 `/api/q/<endpoint>`、`/api/dashboard/product-analysis`、`/api/workspaces/<module>`、`/api/demo`、`/api/endpoints`、`/api/log` 或 `/api/cache/clear`。店铺装修、素材工坊、知识库与接待、账号与权限通过 workspace 路由读取当前账号真实业务字段，联系人使用独立的 `/api/workspaces/access-contacts`，慢查询不阻塞成员首屏。产品发布页用 `GET /api/publish/account-context` 读取当前账号的类目和参考商品，此时才在后台恢复并校验全店历史图库；初始待发布列表保持为空，前端用 `GET /api/publish/image-library/status` 显示同步进度。用户选择从零创建时再用 `GET /api/publish/category-schema` 生成对应类目的属性和官方选项；选择店铺已有商品时，`POST /api/publish/account-images` 返回可勾选的历史主副图、规格图和商详图，`POST /api/publish/account-reference` 再使用同一个短期随机令牌联合读取模板与现有商品的属性、交易、履约和卖点资料；`GET /api/publish/categories` 只用于主动搜索更换类目，`GET /api/publish/upload-capability` 检查图片服务，`POST /api/publish/images` 上传新图片，`POST /api/publish/reference` 导入外部参考链接，`GET /api/publish/jobs` 读取队列，并在最终确认后用 `POST /api/publish/enqueue` 写入队列。
3. `server.js` 用 `ENDPOINTS` 校验只读端点和允许参数，把 camelCase 业务字段转换为 Workctl schema 要求的 kebab-case 参数；发布写路由不复用该白名单，而是单独执行同源 JSON、确认短语、幂等键、服务端字段复核和批量上限检查。
4. Workctl 返回 JSON 后，服务端解析并缓存 5 分钟，再由前端渲染 6 项核心 KPI、经营链路、趋势、数据驱动待办、渠道/国家/商品诊断摘要，以及各业务详情页。RFQ 数据会在服务端移除买家姓名、账号、跳转链接和报价正文后再进入浏览器。

## 关键模块与状态

- `server.js`：定义 `ENDPOINTS` 只读白名单、参数构造、Workctl 执行、JSON 解析、缓存、命令日志、REST API 和静态文件服务；产品发布部分先通过 `data-advisor-shop-product` 分页读取当前账号已有商品与其 `categoryId`，对浏览器只保留标题、缩略图、类目和不可反推商品 ID 的短期随机令牌，再通过 `list-user-category`、`list-attribute`、`list-attribute-options` 生成对应类目表单。账号商品目录返回后，服务端以最多 4 个并发逐件调用 `icbu product list-information --query-type trunk --component-list images,detailImage,sku`，把主副图、规格图和商详图归一化后保存到当前 macOS 用户缓存目录；缓存文件用活动 Accio space 的哈希隔离且权限为 0600。用户主动选择店铺已有商品后，服务端才用令牌恢复内部商品号，联合调用 `publishflow query-template-info-by-id` 与 `icbu product list-information`：前者提供模板文本，后者提供现有商品的属性、价格、交期、包装、物流和卖点。外部链接导入仍使用模板命令。本地图片通过当前 Accio 本机网关的 `POST /api/image/cdn/upload` 上传到 CDN，写入侧维护进程内串行队列，通过临时 0600 JSON 文件调用 `publishflow publish-from-json`。material 使用平台 `categoryId + basicInfo / trade / fulfillment / detail` 嵌套结构；完整商品素材、网关凭据、真实商品号和失败补全路径都不会进入浏览器响应。
- `start.sh`：从 Accio 本地 `/health` 识别活动 space，从账号 runtime 文件仅向进程环境注入 gateway 凭据，根据当前插件清单定位 Workctl，并在启动服务前完成健康与 schema 预检。
- `public/app.js`：定义页面数据请求和交互；主要状态包括经营汇总 `summaryRows`、当前 KPI `curKpi`、商品分页排序 `pState`、完整商品分析 `productAnalysisData`、流量数据 `flowRaw`、地域排行 `regionRows`、访客分页 `vState`、RFQ 商机池 `rfqState`、产品发布本地素材与真实队列快照 `publishState`、知识目录检索与阅读状态 `knowledgeLibraryState`、控制台端点 `EPS` 和标签页加载状态 `LOADED`。客户页联合读取访客行为、店铺回复质量和买家画像；商品页对商品效果记录计算曝光 × 点击率四象限；流量页合并渠道、国家、画像、搜索词和市场机会；关键词广告页区分店铺词库、可售资源和投放效果；RFQ 页联合站内、站外、详情与报价历史。订单物流与风险合规由 `public/operations.js` 覆盖对应 LOADERS，使用实时运营接口；旧静态渲染函数只保留为历史代码，不再作为导航入口。店铺装修、素材工坊、知识库与接待、账号与权限分别由 `loadStorefrontOnePage()`、`loadAssetsOnePage()`、`loadKnowledgeOnePage()`、`loadAccessOnePage()` 调用 `/api/workspaces/` 实时接口，再用对应 `render*OnePage()` 展示公司资料、真实商品和 3D 资产、知识与策略正文、成员及联系人原值；知识页会把商家问答、公共 FAQ 和辅助/自动接待策略组成统一内容目录，点击后在同页阅读完整原文及平台实际返回的元数据。真实为空或接口超时都不会由 Demo 数据填充。产品发布页初始 `products=[]`，已有商品只保存在 `accountProducts` 参考库；“发布新产品”可选择 `blank` 或 `reference`，创建成功后才加入左侧待发布列表。类目在创建时按内部 `categoryId` 实时生成右侧参数。参考商品和“复制同类”的纯数据映射集中在 `public/publish-product-utils.js`；图片排序统一维护 `gallery` 与封面。草稿和正式发布进入服务端并发 1 的真实 WorkCTL 队列。
- `public/index.html`：定义左侧业务信息架构与右侧行动优先工作区。侧边栏名称、分组和顺序是当前产品设计基线；“市场机会”内容按用户要求并入“流量分析”，不再单列入口。“运营待办”读取经服务端校验的 Dify 结果，采用摘要与同页执行方案。
- `public/style.css`：负责来搜品牌浅色工作台、220 px 桌面固定边栏、68 px 收起态、窄屏横向导航、结果数据带、行动清单、诊断摘要、表格、图表、弹窗、日志和响应式布局。六个连续业务单页共用一页式标题和 1180 / 820 / 520 px 响应式骨架，但分别采用订单状态刻度、风险双层口径、店铺首页三栏规划台、素材工具架、知识目录与正文阅读台、成员目录与权限矩阵，避免相同卡片模板重复套用。知识页在桌面端使用双栏资料台，移动端切换目录/正文；桌面端产品发布页使用固定窗口工作区：顶部状态与紧凑进度、底部批量操作保持可见，左右两张卡片独立纵向滚动。
- `demo-data/workctl-demo.json`：用于页面设计和本地演示的脱敏业务 Demo，保存真实汇总、趋势、分布、样本状态、真实空状态，以及产品发布页已核对的字段、命令链路和脱敏写入审计；不保存买家、联系人、账号、订单、商品标识或凭据。
- `demo-data/workctl-command-audit.json`：保存 124 个查询 Schema 的实跑审计汇总、受阻原因和零写操作边界。
- `design-pages/`：仅本地留档的历史页面截图；生成模型草图放在 `imagegen-drafts/`。2026-09-18 起与根目录设计截图、旧设计验收目录一起排除出 Git；不影响正式界面资源。
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
- 用户于 2026-09-05 授权实现五条运营能力，并确认沿用原生 JavaScript + Node.js。现开放上传发品图片、保存/发布新商品、编辑并提交已有商品内容草稿、平台诊断优化、图片与视频生成；每次实际写入仍由页面展示具体范围并确认。改价、修改广告、发送消息、删除、保存接待策略未在本轮范围内。图片上传复用启动器提供的 `ACCIO_LOCAL_GATEWAY_URL` 与 `ACCIO_GATEWAY_TOKEN`，服务端仅允许回环 HTTP 网关且禁止重定向。凭据不进入页面或日志，不再使用旧 PUBLISH_IMAGE 存储配置。
- 产品发布写接口必须只接受同源 `application/json`，要求确认短语和长度合格的幂等键，并在服务端重新校验字段。队列通过 `publish-from-json` 获得质量分、字段修正和结构化失败结果；单品逐条执行时由服务端维持至少 1 秒提交间隔，失败不会自动重试，用户修改资料并再次确认后才生成新的写任务。队列状态区分 `queued`、`running`、`saved_draft`、`submitted` 和 `failed`；`submitted` 只表示已经提交平台流程，不等于审核通过或商品在线。同一请求内所有任务共享 `operationId`，并有从 1 开始的 `position` 与 `total`，前端据此计算总进度和结果汇总。WorkCTL 返回的 `itemJsonPath` 只保留在服务进程内用于排障，页面只显示“图片、属性、价格、包装”等业务区域。
- 产品图片分两类：已有商品的远程 HTTP(S) 图片可直接进入队列；用户新选的 JPG、PNG、WEBP 图片会先在浏览器预览，再由服务端校验图片签名和 8MB 上限并通过 Accio 的 `/api/image/cdn/upload` 转成 HTTPS URL。未取得 Accio 本机会话时新增上传入口会提示重新登录并打开工作台；有会话不等于远端上传成功，接口拒绝或超时需明确报错，保留本地图片供手动重试。全店历史图库与普通 5 分钟接口缓存不同：用户进入产品发布页并请求账号上下文后，服务端才恢复 `~/Library/Caches/com.lsou.workctl-dashboard/publish-image-library-<活动账号哈希>.json`，再在后台补齐新增、修改或超过 24 小时的商品；服务启动本身不扫描图库，以免抢占其他实时查询。每批落盘，切换回已缓存商品不重复查询。清除缓存时会同时删除这份精确的账号缓存文件。待发布列表不再注入任何 Demo 商品：用户必须先选择从零创建、参考店铺已有商品或导入图片文件夹。创建时按内部 `categoryId` 实时取得属性与官方选项，用户只看业务名称，系统内部维护编码；固定单选会提交 WorkCTL 返回的正整数 `attrValueId`，服务端入队前再次按实时 Schema 检查类目归属、必填项和 ID/文字配对。参考商品导入带入类目、标题、用户勾选的最多 6 张旧图和可用文本，固定属性仍按当前账号的实时 Schema 重新生成。计价单位和运费方案同样不要求用户填写内部 ID：`GET /api/publish/business-options` 复用当前账号商品目录并结合少量 `product_query_information` 结果读取店铺实际使用值，前端只显示业务名称，服务端在入队前自动匹配并复核；没有可读取运费方案时省略可选字段并沿用国际站账号默认设置。2026-09-03 的首次真实草稿因旧扁平 material 结构被拒绝；改成 `categoryId + basicInfo / trade / fulfillment / detail` 嵌套结构后，用户再次确认的同一商品真实草稿已返回 `saved_draft` 并保存到国际站草稿箱。
- 待执行的真实队列和完整素材仍只在 Node 进程内，重启不会续跑。已完成的回执现在按活动账号隔离保存到系统缓存的 `com.lsou.workctl-dashboard-history/publish-history-<账号哈希>.json`（0600）；恢复后可查看历史并按回执原商品号读取编辑，失败记录不恢复重试资格，不保存完整素材或自动重放写操作。
- 普通开发入口使用 `./start.sh`；Tauri 使用 `desktop/bootstrap.cjs`。两种入口都发现当前活动 space 并设置 `WORKCTL_BIN`，服务端已移除历史账号默认路径。
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

## 2026-09-07 固定界面改进第一轮

- 修改前初始化本地 Git，基线提交 `1e19e2b`；尚未配置远端。
- 总览六项指标按成交优先并列展示，移除跨口径相邻比率。待办尚无对象级任务源，显示空状态及查询入口，不再将汇总建议和规划能力计为任务。
- 团队绩效由 `renderStaff(rows, period)` 将成交结果、客户响应、商品操作同时渲染为三栏15指标图表；单次选定真实周期，平台总计与成员分开，`staffMetric` 兼容 avgReplyTime/replyAvgTime 并保留缺项。金额币种未返回时仅显示原值不绘比较条；点击成员查看中文指标明细。国家代码由 `businessCountry()` 只在展示层翻译。
- 订单状态和日期在 `public/operations.js` 格式化，状态数量仅汇总当前页，平台总数独立标注。未知状态保留原值。
- 尚未实施：RFQ后续分页、发布空状态重排、商品图片选择和装修/知识等深层内容调整；本轮没有新增LLM建议。
- 验证：语法检查、现有13项隔离测试；浏览器核验总览及绩效视图切换。测试启动本地HTTP服务须允许本机监听，受限环境下Node出现内部断言。

## 2026-09-07 流量分析重排

- `flowShopView` / `flowMarketView` 在流量页内部切换。行业API由 `loadFlowMarket()` 按需读取，不阻塞本店数据；`ops-market` 移到行业容器，商品目录展开后才读取。
- `renderTrafficMetrics()` 固定使用经营汇总的pvCnt/fbCnt/fbTmUv，明确日累计与跨日未去重，不再兜底混用访问字段或计算询盘+TM转化率。
- `flowChannelData` 保存shop-channel日记录；`renderChannelTable()` 支持访客/询盘/TM排序，`renderLinkedFlowTrend()` 使用同一数据绘制选中渠道日趋势及明细。缺失日期不补零，画像周期独立提示。2026-09-11 起点击左侧渠道同时把右侧洞察卡切到日趋势。
- 2026-09-11 来源展开表并入右侧 `flow-insight-card`；`flowInsightView` 管理每日趋势/访客规模/商机率对比，`flowSelectedSource` 管理具体入口下钻。`flowRaw` 仍只用 `TimePolicy.latestFlow()` 的同日期、同周期快照；`flowSourceRows()` 保留平台总值、实际入口名与缺失字段，不累加重叠访客或平均商机率。`renderFlow()` 绘制共用零起点刻度的横条/本店与类目TOP双条，直接显示百分点差；切视图、下钻和返回不触发业务查询。国家图仍说明前12名内部占比，显示中文但下钻保留原始国家名称。
- 渠道排与上下 `flow-compare-grid` 共用等宽双列、16px间隙及1000px单列断点；桌面每排卡片由网格拉伸等高。渠道表前两列各19%，表格内容填充左卡，避免末行被旧460px高度裁切；窄屏横向滚动限制在表格内部。
- 搜索词完整返回列表按本店访客排序，拆分本店访客、平台热度与热度变化。高级趋势查询保留在展开区。
- 验证：语法和diff检查，13项现有测试；浏览器真实数据核验渠道排序、选中渠道与询盘趋势联动、行业视图中文国家表及本店切回。

## 2026-09-07 流量页连续展示

用户要求本店与行业在同页直接看完：去掉页内切换和行业隐藏状态，进入流量页即独立加载行业数据。本店在前、行业在后，保留各自统计口径、渠道联动及按需展开的商品选择器。此记录取代此前双视图切换说明。

## 2026-09-07 本店与行业主题对照

按用户纠正，将国家表现/行业国家供需、进店搜索词/行业需求场景分别并排放到主分析区，渠道与趋势随后展示。保留所有原容器ID和查询逻辑，行业不再独立堆在底部。两侧独立标注周期，不按行匹配或计算跨口径差距；窄屏才按主题依次排列。本记录取代此前上下两大区域说明。

## 2026-09-07 移除重复渠道查询

按用户标注移除自定义渠道趋势查询的界面、事件绑定和空容器；保留主区渠道联动趋势及底部行业查询。insights安装判重改用ops-market，避免重复创建行业区域。

- 2026-09-07：按用户标注移除渠道趋势下方“查看每日数值”入口及明细表；保留折线图、数据说明和悬停数值。

## 2026-09-07 星级自动加载与紧凑呈现

进入经营总览由stars()自动只读加载最新星级，保留刷新按钮与失败重试。renderStars()优先展示平台标记最优赛道：展示/评定星级与统计日期摘要、赛道分数和平台升星差距、商机/交易指标及平台建议两列卡片、基础门槛标签；币种与百分比保留平台displayText。赛道切换复用当前结果。已现场核验自动返回1星、63分及距2星7分，交易赛道可切换到复购率指标；语法、差异检查及13项现有测试通过。

## 2026-09-07 运营待办Dify Chatflow

按用户指定dify-workflow Skill创建 `dify-chatflows/lsou-operations-todo.chatflow.yaml`，7节点DAG，接收业务对象事实快照，LLM生成建议，代码绑定原始证据和安全页面入口，支持6轮窗口追问。模型由用户导入后自行配置，不再为模型选型阻塞。演示输入为明确虚构数据；8个代码节点测试及CLI严格validate/checklist通过，已自动布局。模型未实跑、DSL未导入或发布、网页仍未接入Dify。输入输出及后续接入约定在README。
# Prompt 编写的项目级依据（2026-09-07）

用户提供的运营方法原件在 `docs/references/国际站运营SOP.docx`，正文检索版在同目录 `国际站运营SOP.md`。本插件所有新增或修改的 Prompt 必须参考其相关方法，具体执行规则见根目录 `AGENTS.md`。覆盖全部模块及 Dify/Agent/Skill/代码提示词；方法参考不替代真实数据，也不把原文阈值、时效或收益表述直接视为当前平台承诺。本次归档及规则新增未修改既有 Chatflow 或远端 Dify。

## 2026-09-07 SOP 待办 Prompt 落地

`dify-chatflows/operations-todo.system-prompt.txt` 为可复制的 System Prompt，已同步到 YAML 的 llm_node。后续编辑必须同步两处。将 SOP 的高质量发品、选品定品、广告复盘、优爆品排查、询盘质量跟进转成所需事实、判断步骤、动作及复查标准；输出和代码节点保持原契约。全店市场/装修/关键词库没有对应对象时只说明缺项；订单与风险不杜撰 SOP 依据。未调用或更新远端 Dify。

## 2026-09-07 简化为单次运营待办 Workflow

当前交付 `dify-chatflows/lsou-operations-todo.workflow.yaml`，三节点、单个business_context输入、无记忆及sys.query，End返回result对象。使用全页经营总览事实，支持店铺级待办；输出tasks含title/priority/basis/steps/acceptance_criteria。SOP方法和输出Schema均内嵌。旧Chatflow和独立旧Prompt保留作为历史版本，不用于新版。未导入或运行远端。

## 2026-09-07 运营待办接入页面

server.js 的 generateOverviewTasks 负责 Dify 单次调用及字段校验，getOrGenerateOverviewTasks 控制每日复用和本地持久化；GET /api/overview-tasks 只读取，POST 默认每天最多自动尝试一次，?refresh=1 为用户手动更新。同一账号按北京时间自然日判断；切换周期和刷新数据不改变当日结果，次日首次访问才更新，页面闲置不会定时调用模型。并发请求复用同一生成过程，失败或进程中断后当天须手动重试，旧结果保留。文件位于 ~/Library/Application Support/com.lsou.workctl-dashboard/overview-todo-<活动账号哈希>.json（权限 0600，原子替换），包含待办、生成时间、依据周期和尝试状态，不保存输入快照或凭据；清除查询缓存不删除待办。测试可用 OVERVIEW_TODO_STATE_DIR 指定隔离目录。public/app.js 的 generateOverviewTodo 优先恢复已保存结果，只有需要更新时才等待总览与 overviewStarsReady 并组装快照；renderSavedOverviewTodo 按 design-action-workspace-implementation-cropped.png 显示小图标、标题旁优先级、单行依据摘要、橙色查看方案入口、生成时间与原始周期；点击后由 renderOverviewTodoDetail 在总览下方同页展开依据、执行步骤和验收标准，纯本地阅读不调用模型。enrichOverviewTaskSnapshot 仅在确实生成时补充 shop-product 曝光排序前20样本及 shop-flow 最多120条原始明细，使用字段白名单保留缺项和统计口径；不传内部ID/图片地址，不引用 Demo 诊断。渠道 statisticsType=30d 为滚动30天，不累加为区间值。凭据仅本地 .env.dify 或环境变量，不返回前端、不入 Git。待办仍只是 AI 建议，不执行业务动作。

- 2026-09-07：按用户要求将经营总览运营待办改为原生编号列表，每条仅展示任务标题，移除折叠卡片、优先级标签及长篇详情展示；Dify调用和输出校验保持不变。JS语法与diff检查通过。

- 2026-09-08 输出链路修复：Dify LLM 启用 reasoning_format=separated，End 保留 result 结构化输出并追加 raw_result 最终文本。服务端以 streaming 接收 workflow_finished，最长等待6分钟；有 raw_result 时剥离可能残留的闭合 think 前缀并严格校验最终 JSON，防止结构化提取误报零条。流中断、非法 JSON 或字段错误保留旧结果，不自动再发付费请求。SSE 单事件缓冲上限2MiB，推理与中间节点正文不落盘、不返回页面。

- 2026-09-08 运营待办视觉以根目录 design-action-workspace-implementation-cropped.png 为准：沿用总览白底卡片、13px标题、紧凑行动行及品牌橙；执行方案也复用灰色边线与既有字号。总览六列指标/底部三栏在1180px以上保持，窄屏按原有断点换行。

## 2026-09-08 从运营待办改为运营诊断

用户目标改为先解释各指标为什么不如均值/优秀及如何定向优化。导航与总览卡片改为运营诊断，保持既定白底设计。`buildOverviewBenchmarks(snapshot)` 从同一批 trend 计算六项双基准与差距，不调用模型；序列缺项不补零、不用不完整同行合计比较，最新回复指标缺项不沿用历史值。比较结果作为 `benchmark_comparisons` 入模，并随生成结果保存为 `benchmarks`；前端 `renderDiagnosisBenchmarks` 直接显示保存的对标与期间。模型解释明确区分事实、可能原因、优化方向和待验证证据。

为兼容每日缓存、现有Dify Schema和历史记录，API、内部函数名、文件名与tasks字段保留。新结果 `diagnosisVersion:2`；title是诊断主题，basis是差距/原因，steps是定向优化，acceptance_criteria是验证复查。旧缓存显示“历史待办”提示，只有次日首次访问或手动更新生成新诊断。本地 Workflow 模板已更新诊断Prompt，线上同一应用同步修改；上线以Dify发布与真实调用为准。

- 诊断卡片用 renderDiagnosisView 在指标对标/优化诊断之间本地切换，避免撑高总览；不触发模型。validateOverviewDiagnosisClaims只拦截实跑发现的总量折算点击率、简单前后变化证明因果等已知错误，不能代替完整语义审核。2026-09-08首版已人工校核后保存reviewedAt/reviewNote；未来生成可能仍须业务核验。

- 诊断详情不重复展示编号与主题标题栏；主题保留为区域无障碍名称，收起按钮放在内容右上角。

- 查看诊断改用原生dialog模态弹窗，完整内容内部滚动，不插入同页卡片或滚动背景；支持关闭按钮、Esc与遮罩关闭，关闭后焦点返回原列表位置。

- 2026-09-08 侧栏精简：移除独立运营诊断入口与增长运营分组标题。经营中心顺序为经营总览、客户与询盘、商品运营、产品发布、流量分析、关键词与广告、RFQ商机；诊断仅在经营总览内访问。移除todoCount侧栏计数绑定，保留总览actionCount。

## 总览十二项指标栏（2026-09-08）
顶部使用独立的 OVERVIEW_KPIS 展示两排各六项：成交订单数、广告花费、商机数、询盘数、曝光量、点击量；店铺访客数、店铺浏览量、有效商品数、优爆品数、首次回复率、平均回复时长。原 KPIS 六项继续用于诊断输入，避免此次视觉变更扩大模型输入。overviewMetricValue 对累计序列缺失返回 null；商品数量取最新快照，访客为每日 UV 累加，回复指标标注近30天滚动值。广告花费尚未接入完整店铺消耗数据，明确显示未接入，不从品牌广告空记录推断为零。桌面六列，1100px 以下三列、560px 以下两列。

## 关键词与广告对照（2026-09-08）
- 首屏顺序：行业需求场景与热门词 → 关键词搜索 → 左侧店铺信号矩阵与右侧APP/PC同词双条 → 店铺表现详情 → 来源口径。移除重复page-intro，更新按钮在主卡标题栏；可售关键词资源、广告核验记录及相关渲染已移除。
- `renderKeywordScenes` 前置场景需求指数、环比与热门词；词按钮统一中性色。移除绿色/橙色匹配分组、重合/待核查/特色筛选及无作用的全部按钮，也移除场景/列表的匹配标签与连线图标。点击场景词清空搜索，联动同词数据；历史样本仍标注日期和非当前账号核验。
- `renderKeywordVisuals` 左侧显示高询盘/高引流/高P4P标签矩阵，右侧年度指数默认点击，可切换曝光。APP/PC双条共用0–1000刻度，终端按钮只控制排序和参考详情；缺失不补零。店铺行28px，图表区364px，当前13词可完整展示。窄屏堆叠。
- `keywordShopEvidence` 只从高引流/高询盘标签判定定性正向信号；高P4P仅是消耗标签。选词详情分开展示店铺曝光、点击、引流、询盘：逐词曝光/点击数值尚未接入，明确缺项；不从行业指数推断店铺收益或增量。行业数值置于折叠参考区，明确不是店铺表现。
- `buildKeywordComparison` 按NFKC、空格、大小写规范后的词匹配，APP/PC分行，不合并同义词、单复数。未知渠道仅词级匹配。`groupKeywordVisualRows` 按词合并标签并保持独立渠道数值，避免跨端重复计数；主区只显示有店铺或热门依据的词，支持关键词搜索。
- 行业场景只取countryId=all；场景需求指数不挪作词指数。年度词指数仍只读使用平台推荐池来源，源信息保留在折叠说明中，不展示售卖入口。已传当前cateIdList后仍可能跨类目，提示核查相关性。来源各取首批最多100条，不宣称完整行业词库；日期独立，不随顶部总览周期统一变化。
- `/api/q/ads-shop-profile` 最长等待25秒，三个列表结构完整才成功（真实空数组有效）。成功按ACCIO_ACTIVE_SPACE哈希保存Application Support目录keyword-profile-<hash>.json，权限0600；失败恢复同账号快照及原fetchedAt。无成功快照时展示原9月1日脱敏历史样本，不当作当前店铺事实。KEYWORD_PROFILE_STATE_DIR用于测试隔离。
- 本页不使用模型；点击、筛选和搜索不发请求，更新按钮仅重读三个来源。不更改广告投放或商品配置。

- 流量分析、商品运营均已移除顶部page-intro，直接从指标开始。流量查询固定TOTAL全端并保留全局刷新，国家图仍保留独立终端控件；移除flowTerm/flowApply引用及productPopulationBadge写入。

## RFQ、风险与团队可视化（2026-09-08）
- RFQ移除page-intro/rfqPageState和底部能力边界说明。桌面1121px以上主区760px，两张卡等高、列表和详情独立滚动；底部报价历史/权益按较高内容拉齐。窄屏保持自然高度。
- 风险合规移除重复ops-heading。`riskOverview` 展示10个可点击指标（含原先遗漏的高频投诉和扣分）及6类风险条形图；`showRiskDetail` 对0值显示空状态，对非零查询商品/店铺违规接口。当前诊断只返回汇总，没有对象编号，独立违规查询返回的记录不得绑定成该统计项的对象；弹窗明确提示未关联，并保留平台诊断/违规查询入口。
- `riskRecords` 提取明确违规记录按violationId去重；`riskRecordsView` 直接显示商品图、标题、编号、管控国家、原因和整改正文；`riskText` 用惰性DOMParser转纯文本，不执行平台HTML或装载其中的图片/脚本。风险和违规查询不再渲染完整字段树。默认违规记录仍应用页面日期，指标明细查询不传日期并标为平台近期记录。
- 团队三类绩效同屏，选择周期不重新请求。缺失成员分项、全员为零分别说明；总计使用全部账号原行，回复率不平均，在架数不跨期相加，不混币种加总。

## 订单与物流可视化（2026-09-08）
- 移除重复ops-heading。operations.js的orderOverview/orderChart将合同与物流展示为本页状态环形图和明细表，分母为实际返回行数；平台匹配总数单独标注，翻页重新统计，状态颜色固定。
- showOrderDetail使用独立原生dialog，居中、内部滚动，支持关闭/Esc/遮罩及焦点返回。合同显示金额及原币种、买家、时间、商品；物流显示方案、仓库、单号与运费等语义字段，不再输出原始字段树。
- tariffView按实际classifiedHsCode、classifiedHsCodePathList、tariffRate、tariffCalculateType、tariffFormula展示路线、税率、HS编码、计税方式和归类依据，不自行计算税率/税额。商品选择后收起列表，可更换；商品/路线变更清除旧结果，异步响应通过revision拒绝过期展示。
- 本次保持原生前端与既有只读接口；新增订单分布和金额缺失/零值/币种的验证。页面重新安装清空关税商品选择、替换详情事件委托，避免隐藏旧选择及重复弹窗。

- 2026-09-08 团队绩效布局调整为成交结果、客户响应、商品操作三条横向区域；每个指标列内整合平台总计与成员条形图，保留周期选择和成员弹窗。桌面成交3列、响应/操作各6列，1150px以下3列、600px以下2列。数据计算与缺项口径保持原约定。
- 团队绩效视觉精修：桌面每条区域共用左侧成员姓名列，右侧只呈现数值和条形图；成员行统一28px，悬停/键盘聚焦同步高亮同一成员。1150px以下隐藏共用姓名列，恢复每张图内姓名，保证换行后仍可辨认。保留原15指标与真实缺项。
- 经营总览诊断视图默认值改为insights（优化诊断），首次进入/整页刷新直接展示缓存诊断清单；指标对标保留手动切换，不改变每日缓存或模型调用逻辑。

## 总览四榜单（2026-09-08）
- overview-rankings固定一排四卡：流量渠道、国家地区、商品表现、商品询盘。桌面四等分，1100px以下区域内横向滚动，不改成2×2。
- loadOverviewRankings按20件分页、每批最多4请求获取shop-product商品集合，两榜共用；后续切换排序不发请求，旧请求版本不覆盖新加载。两榜按完整分页商品集合重排。2026-09-08曾因漏传日期落到9月6日单日，现已补齐自然月参数。
- 商品榜支持搜索曝光、搜索点击、点击率、访客、询盘、TM咨询、起草订单；rankedOverviewProducts排除缺项、保留真实0，不修改输入数组。点击率旁显示点击/曝光样本量。固定询盘榜只显示正询盘商品，全0时显示真实空状态，不用TM或店铺询盘补齐。
- 两个商品榜共用独立月份选择，默认顶部开始日期所在自然月；显式传statDate=YYYY-MM-01和statisticsType=month，不冒充顶部自定义日期范围。展示已读商品数，分页失败/数量不一致标为已读取样本。8月实查846件商品，询盘TOP5为20/9/5/4/3；旧364件全0仅属于9月6日单日。保留原商品页面跳转。

## 全页面时间合同与约束（2026-09-08，本节覆盖旧版自由日期约定）

`public/time-policy.js` 是前后端共用的时间校验模块（浏览器 TimePolicy / Node require）。`public/app.js` 的 timePages/timeStates 保存每页已应用的时间，编辑日期后点击“应用时间”才发请求；切页恢复各自周期。统一按北京时间取今天，以UTC日历运算避免时区偏移。默认上一个完整自然月，客户默认上一完整周；日查询默认前天。日/周/月快捷选择只开放已经结束的周期，自定义区间最多到昨天。订单/违规记录允许查到今天。

| 页面 / 模块 | 工具真实时间合同 | 当前页面限制与作用范围 |
| --- | --- | --- |
| 经营总览 | shop-summary：startDate/endDate；statisticsType=day/7d/30d，不能传week/month | 日/周/月转起止日，固定day取日数据；默认上月，自定义最多90天（产品侧限制） |
| 总览商品双榜 | shop-product：statDate近90天，day/week/month；week明确忽略statDate；month必须月初 | 独立自然月，月初须在近90天；总览选择月时同步月份，其他粒度下保留独立月份并标注 |
| 商品运营 | 同shop-product；质量诊断接口无业务时间参数 | 仅自然日/自然月，近90天；product-analysis把时间传给全部分页，不再退到默认单日；质量审计快照独立 |
| 总览渠道、流量页主渠道 | shop-channel：startDate/endDate + day/week/month | 固定day逐日累计，访客跨日不去重；日期范围跟随当前页 |
| 国家地区 | shop-region：startDate/endDate，单次最多3个月；day/week/month | 固定day按所选范围汇总；总览/流量自定义上限90天，后端同时校验3个月合同 |
| 流量页来源分类（折叠参考） | shop-flow：只有startDate/endDate；实际行statisticsType=30d | 只取返回的最新同粒度快照，显示截至日期/滚动周期，不将多天重叠30d窗口相加 |
| 流量画像 | flow-profile：startDate/endDate | 控制台独立起止日期，不把画像值当成渠道日统计 |
| 客户与询盘 / 访客 | visitor-detail：必传startDate/endDate，最长1个月 | 日/周/月或自定义，严格校验最长1个月；31天完整自然月可查；超限提示而非裁切，改周期重置分页 |
| 客户画像 / 流量页画像 | customer-profile：nd仅7d/30d，无起止日期 | 明确固定近30天，不能查询某个历史月；与访客日期分开标注 |
| 团队绩效 | account-summary：startDate/endDate + day/week/month | 仅日/周/月；一次查询一个周期，各报告不相加；周报按平台报告日期展示，不声称该标识是周一或证明周一至周日边界 |
| 客服账号诊断 / 店铺接待诊断 / 质检 | TM queryDate均为YYYY-MM-DD，T+2；账号dateType=0日/1月，店铺dateType=0日/1周，质检为指定日 | 控制台日期最大前天，粒度枚举分别显示；不可用未来日期探测空数据 |
| 关键词与广告 | 店铺关键词画像、推荐词无日期；场景statCycle=30d/90d | 隐藏顶部日期；店铺为最新/已标日期快照，行业需求固定90d；年度词指数仍按平台口径 |
| 行业国家/细分类目 | market-country/market-categories无时间参数 | 使用平台排行周期，不随顶部时间改变 |
| 行业买家画像/渠道 | industry-buyer-profile/channel：nd=7d/30d/90d | 控制台枚举，无历史起止日 |
| 行业买家偏好 | operations crowd-insight：nd=30d/1m，statDate为截止日或月初，默认T-2 | 后端校验枚举/月初；未开放全局筛选，不假装跟随经营区间 |
| 广告效果查询（仅控制台） | 公司/关键词/搜索词：startStatDate/endStatDate；商品：startDate/endDate，均YYYYMMDD；granularity=day/all；达标率statDate=YYYYMMDD | 控制台用日期控件并转换紧凑格式，粒度下拉；不在业务页恢复用户移除的广告卡片 |
| RFQ | 站内openTime枚举或北京时间gmtOpenFrom/To或毫秒gmtOpenStart/End，有优先级；站外发布时间/过期时间为毫秒上下界 | 商机页保持当前池，不展示无效全局日期；控制台成对校验区间，站内三种方式不能混填；过期时间允许未来 |
| RFQ报价历史/权益/详情 | 无业务时间筛选参数 | 平台历史与当前/已标日期权益快照；顶部日期隐藏 |
| 订单与物流 | 合同createDateFrom/To为YYYY-MM-DD HH:mm:ss；物流无时间参数 | 合同独立创建日期，起止完整且不倒置/不未来；物流是当前状态，关税是本次测算；独立日期保留 |
| 合同返回核验 | 实查8月查询仍返回9月1日合同，不能仅凭请求参数认定已生效 | 服务端按北京时间核验createDate；超范围/日期不明行不进入本页列表及饼图，显示排除数；平台totalCount仅供原始分页，不能宣称核验后全量总数 |
| 风险合规 | risk无日期；商品/店铺违规startDate/endDate，另有timeZone | 风险当前快照，违规记录独立日期；后端校验有效性与顺序，不臆造平台未声明的最长窗口 |
| 星等级 | stars可选statDate，留空取最新分区 | 总览与装修保持最新快照并显示平台日期，不暗中应用顶部时间 |
| 会话 / 消息 | limitTimeStamp是分页游标，可用当前/未来游标，非经营日期 | 保持实时/历史翻页；不施加“不得未来”的业务日期限制 |
| 产品发布、素材、知识、权限、关税、商品内容/质量 | 当前对象、任务或实时计算，无统一经营日期 | 隐藏顶部时间，说明当前内容；不改变写操作与确认流程 |

- 查询前在 `server.js callEndpoint` 校验时间白名单、格式、周期枚举和窗口，错误返回HTTP400并记录日志；`lib/operations.js` 的只读入口共用校验。拒绝不支持的时间参数，不能静默忽略。
- 数据控制台不继承其他页面日期：时间字段变成日期/月份/时间戳控件，固定周期用select；广告日期转换YYYYMMDD，RFQ本地日期时间转换北京时间字符串。商品week清空并禁用日期，防止显示了选择但工具忽略。
- 概览/流量/国家/商品/客户/团队异步请求捕获各自周期，迟到结果不覆盖新周期。局部运营查询按区域版本丢弃迟到响应。诊断沿用每日缓存；旧诊断日期不同会提示手动更新，此次不修改Prompt也不主动生成诊断。
- 合同依据：2026-09-08从当前活动Workctl 0.1.55读取45个工具schema的params字段，并与operations本地合同对照。不要使用schema通用time.profile机械替换业务params：例如商品通用模板宣称映射startDate/endDate，真实商品params却是statDate且按周忽略它。
- 实查：8月shop-summary返回31个日记录；shop-region按day返回8月31个日期块；商品8月846件、9月6日364件；团队8/31—9/6按week返回报告标识9/5（未声明周起止边界）；行业90d正确返回9/6分区；shop-flow实际为30d滚动行，已避免累计。未对每个可选日期和所有账号做穷举，平台数据产出/权限仍以真实响应为准。
- 验证：`node --test test/time-policy.test.js test/dashboard-visualization.test.js test/keyword-comparison.test.js test/operations.integration.test.js test/server.integration.test.js`；32项通过。覆盖跨年周、闰日、窗口边界、近90天、T+2、紧凑广告日期、RFQ互斥、HTTP400、合同越界排除、渠道滚动窗口及既有业务回归。

## 2026-09-08 关键词与广告：HATEOAS 广告工作台

- 真实入口是 `workctl icbu ads list --params-file <JSON文件> --format json`，不止旧帮助列表里的问鼎/顶展接口。先查询 `company(include=all)`，按其可用 links 取得 searchCampaigns、wholeSiteCampaigns、campaigns、campaignGroups、accountFinance、diagnose、query_industry、recommend_campaign_package。当前 Workctl 0.1.55 已真实调用确认。
- `lib/advertising.js` 集中广告只读查询、嵌套 MCP 成败解包、参数验证、缓存、报表串行锁与 TSV 处理；`server.js` 的 `/api/advertising/{plans,finance,history,industry,recommendation,diagnosis,report}` 路由仅接受 GET 和对应业务参数。浏览器不能指定 entityType、SQL、任意上游链接或写操作。调用参数使用 0600 临时文件，完成清除；运行日志只记录实体、成败和耗时。
- `public/advertising.js` 在关键词对照下追加效果双栏、同单位对比图、计划状态与可搜索排序分页表、计划详情弹窗、当前资金与分类流水弹窗、账户诊断、行业比例图和推荐方案。主关键词模块保持独立；不恢复可售广告资源或旧广告核验记录。
- 广告日期恢复到顶部独立时间控件：自然日/周/月及最多100天的自定义区间，默认上一个完整月，最晚昨天。只有效果和资金流水使用该范围；诊断为结束日前7天，计划/余额为当前快照，行业大促样本独立标注。日期变更只在点击应用后生效，迟到的报表响应不覆盖新周期。
- 账户效果以 `company_search`、`company_whole_site` 两份独立报告读取；filters 为 datasource、beginDateTime、endDateTime（YYYY-MM-DD HH:mm:ss）。每份必须连续完成 report → 返回的 report_sql，再查询下一份。跟随真实 sessionId/tableName/sql1，仅按平台声明的 LIMIT 规则扩至1000，避免默认10条漏掉月内记录；验证日期、总行数，缺少金额/明细时不补0。不开放浏览器SQL。
- 查询缓存5分钟、并发同请求合并；平台诊断/推荐在当前服务进程中缓存24小时，普通刷新不强制重算，专用更新按钮才强制查询。服务重启会丢弃这些缓存。清除缓存覆盖此模块。原经营总览每日持久化诊断继续使用自己的逻辑，不受影响。
- 普通计划接口 onlineStatus 原始枚举与直通车/全站推列表不同，按相同计划ID匹配产品线接口已核验状态；不能匹配的展示“未提供状态说明”。计划与计划组是不同视角，不相加。预算设置不是效果花费；推荐预算和目标成本只是建议，不执行任何投放。
- 总览广告花费复用相同双报表来源；只有两个来源均有完整金额才能相加，空表显示暂无记录、失败显示读取失败。点击进入广告区并同步日期。这个金额口径为直通车+全站推，不包含未查询的品牌广告消耗。
- 验证入口：`node --test test/*.test.js`；`./start.sh` 后打开 `http://127.0.0.1:8787/?tab=ads`。真实报表能返回花费字段，但2026年8月及9月1—6日仅有表头，无数据行；不能作为区间0元。资金查询则确实返回当前现金余额2269.93元、今日花费0元；两者属于不同口径。

## 2026-09-08 React + Tauri 插件交付

- 已确认技术栈为 React + Tauri + Node.js。React 在 `frontend/main.jsx` 挂载现有完整工作区、管理导航与启动错误；现有业务渲染和表单模块暂以兼容模块复用，不是所有业务组件都已重写为 React。稳定的 memo 工作区防止导航重绘覆盖未保存表单。`public/app.js` 通过 `lsou:navigation` 同步状态，并在扩展加载后调用 `initializeWorkbench()`。
- `vite.config.mjs` / `package.json` / `package-lock.json`：React 构建工具链。`npm run build:desktop` 构建前端、准备资源并生成 Tauri 应用；`npm run package:plugin` 校验并输出 ZIP。首版目标为 macOS Apple Silicon，尚不包含 Intel / Windows 二进制。
- `src-tauri/src/main.rs`：Tauri 窗口、单实例及后端生命周期。启动随包 Node.js，后端就绪后导航到本地 React 页面；退出时结束自己创建的后端进程组。监控插件 MCP 父进程，防止插件卸载/会话结束后残留窗口。
- `desktop/runtime.cjs`：通过 Accio `/health` 发现当前活动 space、runtime 凭据及已安装 Workctl；读取健康与经营 schema 验证。`desktop/bootstrap.cjs`：加载本机私有配置，以 IPC 启动 `server.js`，发现系统分配的端口并通知 Tauri。
- 桌面后端只监听 `127.0.0.1`，动态端口与本地开发 8787 分开；随机会话令牌只在进程内存在，首次 Tauri 导航交换 HttpOnly/SameSite cookie 后重定向去除 URL 令牌，后续接口须通过会话和同源检查。没有对远程网页开放 Tauri shell/文件权限。
- `plugin/plugin.json` / `plugin/connectors/connectors.json`：插件格式遵循用户指定的 `plugin-create` 规范；实际 Accio 0.31.1 loader 还支持 `connectors/connectors.json` 的本地 stdio MCP。`plugin/scripts/desktop-mcp.cjs` 在连接时启动 Tauri，提供 `lsou_desktop_status` 与 `lsou_desktop_open` 两个工具；`launch-mcp.sh` 使用随包 Node，不依赖外部终端环境。自动启动是否生效以最终 Accio 导入和加载实测为准。
- `scripts/prepare-desktop.mjs`：从 Node 官方分发源下载固定版本 arm64 运行时并核对官方 SHA256，按清单复制业务文件和 React 产物。`scripts/package-plugin.mjs`：执行用户提供的验证器、排除敏感文件、验证应用签名、输出 ZIP 和 SHA256。仅使用本地 ad-hoc 签名，不等于 Apple Developer ID 签名/公证。
- 本机配置为 `~/Library/Application Support/com.lsou.workbench/desktop.env`，仅支持 Dify 与图片服务配置，权限 0600；不会进入插件。生命周期日志在同目录 `desktop.log` 和 `plugin.log`。已有 `.env.dify` 本次仅迁入此本机配置供当前使用。
- 新增验证 `test/desktop-runtime.test.js` 覆盖活动空间解析、动态端口、cookie 与跨源限制、MCP 握手和输出不泄露凭据；完成桌面安装后再记录实际验收结果。


### 首版安装状态（2026-09-08 已验收）

`release/lsou-workbench-1.0.0-macos-arm64.zip` 已经由 computer use 导入当前 Accio Work。插件详情为“已连接 / stdio / Tools (2)”，加载自动拉起 Tauri 与 Node 后端；关闭窗口后对应子进程清理已实测。36个安装文件与交付目录逐文件校验一致，最终53项回归通过。详细证据与ZIP SHA256见 DEVELOPMENT_LOG.md。

包内应用目录统一为ASCII `resources/LSOUWorkbench.app`，避免Accio对中文ZIP条目的解码问题；窗口仍显示“来搜 · 国际站经营工作台”。桌面cookie采用SameSite=Lax以支持WKWebView首次跳转，同时API拒绝跨源Origin和cross-site请求。桌面关闭tab淡入，避免后台窗口停在透明动画首帧。Tauri页未开放本机shell/文件IPC。

## 2026-09-08 三平台交付扩展（1.0.1）

- 用户要求同时覆盖 Windows x64、Intel Mac、M 系列 Mac；同事无技术背景，安装步骤限定为导入 ZIP → 安装启用 → 查看经营总览/商品运营。
- `desktop/platform.cjs` 统一平台选择与私有配置目录；Windows 使用 `%LOCALAPPDATA%/com.lsou.workbench`。`desktop/runtime.cjs` 在 Windows 从当前账号安装的 npm 包读取 Workctl JS 入口，用随包 Node + 参数数组运行，避开 `.cmd` 与 shell 转义问题。
- Rust 后端生命周期按平台分开：Mac 进程组，Windows Job Object（关闭句柄时清理后代）；Windows 不弹额外控制台。前端仍必须在 Tauri 原生窗口内使用。
- `scripts/build-desktop.mjs --target macos-arm64|macos-x64|windows-x64` 分别构建；共享临时 payload/runtime，因此三个本机构建须顺序执行。Windows 原生构建可在 Windows 直接运行；Mac 跨编译需 cargo-xwin、LLVM、Windows Rust target。
- `npm run package:universal` 只有三个构建都存在且版本相同时才输出通用 ZIP。`npm run package:plugin -- --target <平台>` 输出单平台 ZIP；单平台直接使用随包 Node，通用 MCP 入口使用 Accio 管理的 Node（当前国际站 CLI 的运行依赖）并按平台启动 Tauri，业务后端仍使用包内固定 Node。
- 已将用户指定 plugin-create 官方验证器原文保留为 `scripts/validate-plugin.cjs`，不再依赖开发机账号路径。每次打包仍先执行官方验证，再生成保留可执行权限的 ZIP。
- `plugin/README.md` 提供非技术同事的三步测试与可复制安装 Prompt；构建/实机结果见 DEVELOPMENT_LOG.md，不能仅按源代码中的平台分支宣称 Windows 已验收。

### 1.0.1 当前交付状态

三平台原生程序与 `release/lsou-workbench-1.0.1-universal.zip` 已完成构建/官方校验；通用包通过 computer use 安装到当前 Accio，显示1.0.1已连接。已修复Mac解压后Node可执行权限丢失，并完成56项回归、本机自动启动/真实数据/退出清理/重新加载验证。Intel及Windows仍需目标实机验收；同事按 `plugin/README.md` 三步测试。SHA256与验收证据见 DEVELOPMENT_LOG.md。不要把构建成功写成Windows/Intel已实机通过。

## 2026-09-08 全量扩展业务功能

- 用户授权先将上次审计中105项未直接使用的工具加入现有侧栏，后续按使用情况删减。新增范围包含广告预订、接待策略修改/删除、会话分配、商品完整编辑等；每次实际写入仍需页面核对后确认，不在开发验收时自动执行。
- `lib/capability-catalog.json` 为105项固定目录：53查询、47需确认操作、2后台凭据能力、2待核验接口、1专属Skill能力。来源是当前活动WorkCTL 0.1.55逐项schema，registry仍为stale；空参数的send-msg及用途不明的trade list-product-page不允许执行。凭据与专属Skill命令也不通过此UI执行。
- 各页面通用扩展功能卡片已全部移除（含总览、团队绩效、控制台）；`public/capabilities.js` 退出前端加载链并删除自动创建入口和读取目录逻辑，历史抽屉实现仅保留供后续整合参考。已融入业务页面的功能不受影响。
- React与浏览器入口均不再加载通用扩展脚本。`lib/capabilities.js` 实现 `/api/capabilities/{catalog,context,preview,run,jobs}`；只运行目录内固定命令，参数用0600临时文件传入。内部标识使用服务端短期引用，来源包括商品目录、3D库、知识策略、店铺页面、联系人、旧优化任务及本模块查询结果；无法取得引用时明确要求先查询，不能手填猜测编号。
- 写操作必须先由服务端保存5分钟预览票据，再确认执行；票据绑定工具和参数，同票据重复点击返回同任务。进程内串行队列、同源保护、嵌套业务错误识别、结果凭据脱敏、3D资格及模型关联前置检查。任务存于桌面私有配置目录的账号哈希子目录；仅保存脱敏结果与状态，不保存请求素材。重启时将未完成任务转为unknown，不自动重放。submitted只代表调用已接收，不推定审核/生成完成。
- 现有打包脚本会复制整个lib/public目录，因此扩展可进入后续构建；本轮只验证React构建和本地浏览器，未重新打包三平台ZIP。新增功能需要随新包验收后才能称正式插件已交付。


## 风险合规主页面（2026-09-09）

- `public/risk-workspace.js` 由 React 与本地兼容入口在 operations.js 前加载；`risk()` 挂载页面内工作区，原有诊断与日期查询继续保留。风险页不再显示通用“打开业务功能”弹窗入口。
- 主区整合8项新增能力：违规列表→商品图片属性/处罚/整改指引，按真实商品类目检查标题候选品牌词，选择商品和国家提交/查询禁限售规则，以及企业搜索→核验报告。品牌词命中不是侵权判定；平台规则匹配有噪声，标记为候选参考。
- 后端 `lib/capabilities.js` 的 POST `/api/capabilities/risk` 仅接受固定 action；商品、企业、分析任务采用30分钟引用令牌，不要求用户填写内部编号。平台查询超时与部分成功独立显示；不自动重放生成分析。正式ZIP尚未同步此次页面变更。


### 风险页交互调整（2026-09-09）

风险页改为5个任务面板：违规处理、商品自查、企业核验、店铺诊断、历史记录。同一时间仅显示一个面板；违规处理左侧列表、右侧详情，移动端上下排列；商品自查首次进入自动读取商品，选择后启用标题检查/规则查询。原有诊断与日期查询节点移入对应面板，接口及数据口径保持原有实现。旧risk锚点进入时清理，避免新版页面在中间位置打开。


## RFQ详情与批量对比（2026-09-09）

- `public/app.js` 在原商机池添加站内商机勾选与采购需求对比，在报价历史添加单条详情与多选报价对比；结果在原页面内显示，不使用通用能力抽屉。`public/index.html`提供对应工具条与结果区域；React继续解析同一模板。
- POST `/api/capabilities/rfq`支持opportunities/quote/quotes固定动作，后台核对当前搜索或报价历史中的ID，最多20/1/10条。WorkCTL读取命令按CLI要求带--yes，不表示发送报价。商机沿用shapeInternalRfq，报价采用业务字段白名单，不返回联系人、账号、消息正文；批量结果保留每项失败。
- 文档待融入工具剩余94项；RFQ原编号091—093改为已接入位置与验收说明。正式插件包未更新。

## 流量分析行业选品（2026-09-09）

- `public/index.html`、`public/app.js` 在搜索需求对照下方加入页内“热门商品 / 供应商”区，类目由当前商品目录样本提供；独立周期、排序、店铺网址查询。商品可联动读取对应供应商，不再显示流量页通用工具弹窗。
- POST `/api/capabilities/flow`固定支持categories/products/suppliers；类目采用短期引用，店铺网址仅解析Alibaba店铺域名。返回业务字段白名单与原始每日指数，不把指数加总成真实业绩。供应商按网址查询为全店口径；类目查询为空与失败分别呈现。
- 文档待融入工具剩余92项。浏览器已验证热门商品10条、关联供应商1条；三平台正式ZIP未同步。


## 市场洞察独立侧栏（2026-09-09）

- 新导航 `market` 位于流量分析下方，`tab-market` 承接行业供需与竞争情况、热门商品与供应商两块工作区。React导航从同一HTML模板生成；支持 `?tab=market` 直达。
- `public/operations.js` 的 insights 安装器改挂 market；`public/app.js` 的 loadMarketInsights 初始化/刷新选品区，统计周期各区独立。保留现有DOM标识与后端接口以保持业务查询兼容。
- 流量页保留本店与国家供需、需求场景、细分类目小表对照。工具说明文档入口更新为市场洞察，待融入总数仍为92；正式插件ZIP未重打包。

### 市场研究结果展示（2026-09-09）

`public/operations.js` 的 marketOverview 专门渲染五类市场查询：供需指标、序号趋势、同行占比、买家偏好空状态和关联商品图片列表。选商品后收起选择器并更新类目摘要，结果版本失效以避免旧查询覆盖新对象。趋势接口实测无日期，仅显示返回序号；同比/占比乘100展示，币种与统计周期缺失不推断。公共facts渲染仍供其他模块使用。

### 商品驱动的市场研究入口（2026-09-09）

市场研究改为默认读取目录并展示前6件商品，自动选择首件读取行业供需。选中商品的图片、标题、类目与三个“查看…”入口放在同一区域；更换商品自动重查当前类目视图。保留搜索、分页、展开本页20件；独立买家研究收纳全行业买家偏好/本店关联浏览，避免误认为绑定商品。替代上一版折叠商品选择器。

### 商品与行业全景（2026-09-09）

市场研究现为左侧商品目录、右侧五个常驻结果区。目录每页20件，可滚动、搜索、翻页，默认选择首件。选择商品并行读取供需、趋势、卖家画像，各自版本保护和错误提示；买家偏好及关联浏览首次进入即独立加载，不因更换商品重复调用。每区可单独重新读取。替代六件商品加查询按钮的交互。

市场全景容器 `#ops-market` 保持 `overflow:visible`，避免sticky商品栏相对卡片裁切区域产生顶部空白；列表自身保留滚动。供需区域使用紧凑间距，仅隐藏重复的内部标题。

桌面市场趋势以四列横排呈现，SVG坐标系260×160；小于1000px两列，小于500px单列。市场宿主和卡片首部取消额外margin，摘要与供需指标保持紧凑布局。

## 关键词与广告辅助资料（2026-09-09）

- 主页面新增广告选品与行业资料：主营二级类目、行业路径、站内行为状态。POST `/api/capabilities/ads`固定支持main/categories/behaviors/products/product；主营公司身份由advertising.accountContext在服务端取得，商品使用短期引用。未知行为结构不暴露个人信息。
- 现有通用广告弹窗入口移除；品牌预订因未取得可售资源且资源列表参数结构未明确，已移除主页面说明占位，原因保留在未接入工具清单090条目。3项查询已融入，文档剩余89项，090品牌预订仍待接入完整流程。
- 真实结果：10条类目路径、主营智能电子、行为空、广告商品仅标题；类目没有数量，不画比例。正式ZIP未重打包。

关键词与广告顶部提供keywords/advertising两个视图，容器adsKeywordView/adsAdvertisingView由public/advertising.js的selectAdsView切换；默认关键词，数据保留。总览广告花费跳转同时选中广告视图。

广告辅助区更名店铺基础资料，保持原位置；摘要行、双列类目标签提高密度。

已按用户要求移除商品标题核对区域及自动加载、搜索和选择逻辑。后台商品查询能力保留，088广告商品详情不再计入主界面已融入工具；类目标签颜色仅辅助分组识别。

## 2026-09-09 经营查询缓存与主动刷新

- `/api/q/*`普通经营查询和广告查询保留当前服务进程内的成功结果，不再按五分钟自动过期；按完整工具参数（含日期、分页和排序）区分缓存。四个账号工作台快照同样只在主动刷新后重读。服务重启后首次查询重新加载，缓存未落盘。发布Schema、短期引用和任务轮询继续沿用原有时效规则。
- `lib/query-cache.js`合并相同参数的在途查询，商品查询最多两路并发，刷新隔离旧响应；`public/app.js`总览分页并发降为2，分页失败只提示一次，技术错误保留在后台日志。
- 顶部“刷新数据”先POST `/api/cache/refresh`使经营查询/广告/账号工作台缓存失效，再加载当前页。切日期仅按新参数查缓存，不清全部查询；该刷新不清图片库、发布引用或任务。运营扩展与能力适配层也缓存成功的底层只读结果，刷新时统一失效；限时引用在每次返回时重新登记，任务状态、生成分析和写前校验不缓存。

2026-09-09 全页面补齐：`lib/operations.js`按实际业务参数缓存行业、买家、客户等READS查询；`lib/capabilities.js`缓存风险/RFQ/广告辅助/热门商品等成功原始结果，恢复引用后再返回。工作台底层只读查询由workspaceQueries统一缓存。顶部刷新清所有经营查询缓存；市场“重新读取”和广告“更新资料”主动刷新对应服务缓存。页面时间标签区分本次加载与平台数据统计时间。发布Schema/执行前校验和运行任务进度维持有效性规则，不做永久快照。

## 2026-09-09 macOS 11兼容修订（1.0.2）

- 同事反馈M芯片macOS 11.5.2无窗口；旧1.0.1包Info.plist最低12.0。Tauri最低目标与MACOSX_DEPLOYMENT_TARGET改为11.0，Node保持22.22.0（arm64二进制最低11.0）。必须重编译，不能直接篡改旧包plist。
- desktop/platform.cjs提供系统版本检查（Darwin20对应macOS11），MCP不支持时明确返回unsupported_os；ready仅表示后端就绪，不等于用户已看到窗口。前端Array.at(-1)改为兼容旧WebKit的slice(-1)[0]。
- 新发布release/lsou-workbench-1.0.2-macos-arm64.zip仅包含M芯片Mac版本，旧1.0.1三平台包保留；不要将1.0.2单平台包称为通用包。编译产物Info.plist与主程序、Node的Mach-O最低版本均已核对为11.0，72项测试与官方插件结构/签名校验通过。macOS11.5.2尚待同事实机导入、窗口及业务验收。

2026-09-09 最新内容重新封装：用户要求仅M芯片，已从当前工作区重建1.0.2并覆盖同名M芯片ZIP。包内30个业务/前端文件与当前源码及dist逐一SHA256一致，包含全部近期界面和缓存调整。当前包SHA256为3e2c4e6cee5b9962835698d2a4673967e58d9ba1750baed19efbbd48b72d3ac5，旧校验值已被本次构建替代；其他平台未重建。

## 2026-09-09 1.0.2其他平台与通用包

当前1.0.2已补齐macos-x64和windows-x64原生构建，release包含对应单平台ZIP及universal ZIP（真实包含三平台）。各平台30个业务/前端文件与当前源码/dist逐字节一致，72项测试和官方包结构校验通过；Intel Mach-O/随包Node x64及Windows PE32+ x64确认。Intel/Windows仍未目标实机验收。插件README明确WorkCTL0.1.55在macOS11.5.2缺失系统符号，不能以应用minos11.0声称整套支持macOS11。

## 2026-09-10 交付形式变更（覆盖此前通用包约定）

仅交付Mac（M芯片）、Intel Mac、Windows（x64）三个独立ZIP。已删除release中1.0.1/1.0.2通用包、对应校验文件及stage-universal，移除package:universal命令并拒绝--universal参数。此前通用包构建/验收记录仅为历史，不是当前可交付文件。三个1.0.2独立包重新封装以更新包内安装说明，业务二进制不变。

## 2026-09-10 六页 AI 接入进行中，等待用户最终 Flow 与 App API Key

用户已确认首批经营总览、客户与询盘、商品运营、流量分析、市场洞察、关键词与广告，排除 RFQ 与风险合规。架构为 Workflow 生成 JSON 页面解读、Chatflow 页面内连续问答。六页 UI 与后端接口已有本地改动；不是云端启用或正式交付完成。

最新用户指示：两个 Flow 由用户继续单独优化、选择可用模型；等用户提供对应 App API Key 后再按最终输入输出接入。不继续替用户选择模型、导入或发布 Dify 应用，不因本地联调通过宣称真实模型可用。

当前代码入口：lib/ai-advisor.js；public/ai-advisor.js 与 ai-advisor.css；server.js 的 /api/advisor/config、context、analysis、chat；public/app.js、advertising.js、operations.js 记录当前页已有只读响应；frontend/main.jsx 加载共用顾问。当前暂定 schema_version=2.0，包含 module、snapshot_id、period、facts、entities；需与用户最终 Flow 对齐。新配置名为 DIFY_ANALYSIS_API_KEY 和 DIFY_CHATFLOW_API_KEY，尚未配置；旧 DIFY_API_KEY 不自动套用。

两份既有 DSL 已改成本地候选版本，模型暂沿用浏览器导出的已有 Workflow 配置 deepseek-v4-flash，未核验可用；不要据此认为用户已确认选型。difyctl 列表、导出和一次 Workflow 导入均返回 HTTP 500；没有发布。模拟联调使用临时 8797/8798 服务，已按用户最新指示停止。8787 为真实数据开发预览，无新 App 接通；当前空间 Workctl 路径缺失，临时预览使用已安装的全局 CLI 与当前账号会话。

## 2026-09-10 1.0.3 启动兼容与内置排障

- 本机 Accio 0.32.2 将 Workctl 0.1.58 成功安装到 `generations/<版本>/<批次>/prefix`；旧代码仅拼 `versions/<版本>/prefix`，导致 ENOENT 被错误显示为会话连接失败。实时网关认证与经营 schema 使用新路径均通过。上文“当前空间 Workctl 路径缺失”指旧路径解析失败，不代表工具未安装。
- `desktop/runtime.cjs` 优先读取当前空间 `plugins/plugins.json` 中国际站生意助手的 `cliToolStates.workctl.resolvedPath`，再检查 Accio 注入路径、当前版本 generations、旧 versions。仅接受当前空间管理目录及声明版本，检查真实路径与 Windows JS 入口边界；不回退全局 CLI、其他账号或旧版本。禁用插件、安装中、缺工具、权限、系统兼容、认证和 schema 失败分开报告。
- `start.sh` 通过同一解析器启动本地服务，保留原产品发布 schema/publishflow 预检。`desktop/bootstrap.cjs` 记录各阶段，临时未就绪最多重试三次；后端未就绪有超时。`startup-status.json` 只保存时间、原生 PID、状态、固定错误码，日志不保存凭据或原始 CLI 错误。
- `desktop/diagnostics.cjs` 生成脱敏依赖和历史启动摘要。`plugin/scripts/desktop-mcp.cjs` 提供 status/open/diagnose/repair 四个 MCP 工具；`--diagnose` 独立运行，不打开窗口。repair 合并重复调用，只恢复本包可执行位、重新发现会话、重启本 MCP 创建的失败窗口；ready 窗口保留，独立手工打开的窗口不被强杀。
- `plugin/skills/lsou-startup-recovery/SKILL.md` 在启动失败时供 Accio 调用，含 MCP 不可用时的随包 Node 入口、错误分流、一次恢复上限及真实验收要求。Skill 本身不等于后台自治进程；程序的自动恢复限于路径发现与临时就绪重试，模型排障由 Accio 加载此 Skill 后执行。
- 打包复制同一套 runtime/diagnostics/platform；对照 Tauri 内部启动源码，防止诊断与窗口版本不一致。版本升至1.0.3，继续输出三个独立 ZIP。构建、插件导入与实机验证结果见 DEVELOPMENT_LOG.md。

1.0.3验证补充：89项回归通过，三个独立ZIP均已生成并通过结构/CRC核对；随包M芯片Node的真实诊断通过。用户接手导入后本机装入Intel包，已说明应换M芯片包；当前插件自动启动/真实窗口数据仍待该导入步骤完成后验收。最外层Mac启动脚本已能在Node运行前报告PACKAGE_WRONG_PLATFORM/PACKAGE_INCOMPLETE，具体校验值见开发日志。

1.0.3本机验收已完成（覆盖上文待导入状态）：用户导入正确M芯片包后，Accio详情为已连接/Tools(4)/Skill1/版本1.0.3，自动启动Tauri与随包Node。53个安装文件与最终ZIP一致；Tauri经营总览和846件商品分析真实显示。广告报表/星等级仍有独立接口问题，未在本次启动修复中处理。Intel/Windows仍待实机验收。独立--diagnose的desktop状态仅属于独立诊断进程，整体窗口须结合MCP、lastStartup时间与UI判断。

## 2026-09-10 两个本地 Flow 补入运营顾问方法与知识检索

用户在暂停接入后明确要求“先填补进去”，并参考 `/Users/garden/YD/l-sou` 的 Flow 和 knowledge base。本轮仅恢复本地 DSL / Prompt 编辑；不恢复前后端联调、模型选型、云端导入发布或 App API Key 接通。此前本任务的临时预览已按用户要求退出；不据此前预览描述推断当前运行状态。

- 文件仍为 `dify-chatflows/lsou-operations-todo.workflow.yaml` 与 `.chatflow.yaml`。Workflow 返回 JSON 页面解读，Chatflow 返回自然语言并按需生成完整草稿；原六页 `schema_version=2.0`、输入输出、证据校验和导航约定保持不变。
- 两份 Flow 的 `prepare` 节点内嵌用户八份 Prompt 的相关职责、输入、判断方法与交付要点，`PROFILE_MAP` 按页面选择：总览 01/07/02，客户 08（移除 RFQ 专属步骤），商品 06/04，流量 07/03/05，市场 03/04，广告 05/04。Chatflow 在规划类追问时补入 02；默认不生成所有顾问报告。所有方法仍服从当前页面事实及国际站运营 SOP 的适用条件。
- 新链路为 `retrieval_input → query_rewrite → query_guard → knowledge → llm_node`。检索材料只保留本轮问题、相关主题、最多六条事实摘要、有效选中对象与同快照的已有分析摘要。改写失败或格式错误走本轮保底查询；Workflow 无事实分支先退出，Chatflow 可在有效页面内解释概念。
- `knowledge` 沿用参考项目的多库语义检索、Top K 6、关闭重排；待绑定包含《阿里巴巴国际站经营方法论第二版_Dify入库版》和《国际站运营SOP_Dify入库版》的现有知识库。参考文件没有真实知识库 ID，本地 `dataset_ids` 保持空，未伪造标识、上传资料或建立远端库。
- 主模型接收原生检索上下文，仅将知识用于运营方法；文档版本、原 SOP 经验参数、待核/缺口标记保留。知识片段 ID 不能充当本轮事实引用。无命中与检索服务失败分开，后者直接报错。
- 每份 Flow 有问题改写和顾问分析两个 LLM 节点，均沿用原有 `deepseek-v4-flash` 配置，尚未在用户环境验证。没有增加其他供应商或重排模型。用户后续需检查每个模型节点并绑定知识库。
- `operations-todo.system-prompt.txt` 同步 Chatflow 主节点；页面方法仍在 `prepare`，该文本不能代替完整 Flow。README 已替换旧 1.0 / Chatflow 输出 JSON / 三节点 Workflow 的过时说明。

本轮验证：19 项 Python DSL 代码测试与 8 项隔离 AI 服务测试通过；主模型/依赖/输入/结构化输出/结果校验保持与本轮前一致。两份本地 DSL 的严格校验仅剩知识库未绑定的错误与对应警告，因此尚不能称为可直接发布或实际检索成功。没有调用真实模型、操作远端 Dify、修改页面接入或重打正式插件包。

用户随后确认 Workflow 两个结束节点需使用不同输出名：正常分支为 `result / raw_result`，数据不足分支为 `error_result / error_raw_result`。本地 YAML 已同步此约定，内部仍引用 `prepare.empty_result / empty_json`，内容保持 `status=needs_data` 与空任务。后续接入必须区分两组输出；当前候选后端还只读取正常字段，本次未恢复前后端接入。19 项代码测试与结束字段唯一性、真实引用及对象/JSON一致性检查通过；本地知识库未绑定仍是 DSL 严格校验的阻塞项。

### 六页固定输出标准与恢复 Workflow 接入（覆盖上述暂停状态）

用户随后授权用现有 Key 自行接入/测试，并要求先确定可直接给 Dify 配置的 Output Schema。App API 实时核验现有 Key 对应“来搜六页运营分析”，输入 `business_context`（必填、最大50000字符）；真实空数据运行只经过准备/判断/结束，0模型Token，返回用户确认的 `error_result / error_raw_result`。

统一模型 Schema 继续维护在 `dify-chatflows/overview-todo.output-schema.json`，文件名沿用历史但适用六页。补齐所有字段的业务说明与空值/引用/版本规则，保持现有 V2.0 字段、类型、必填项和限制，已同步本地 Workflow 模型节点。模型仅生成 `summary / tasks / suggested_questions`；系统版本、模块、快照、时间、状态、可信证据/入口和建议状态由代码绑定，最终两组结束参数不嵌入模型 Schema。完整字段表与版本维护规则见 README 的“六页统一 Output Schema V2.0”。

`lib/ai-advisor.js` 已按用户授权允许 `DIFY_ANALYSIS_API_KEY` 未配置时复用现有 `DIFY_API_KEY`；Chatflow仍只接受独立Key。`readAnalysisOutput` 区分两组结束字段，支持未执行分支为空，拒绝冲突分支、损坏JSON和对象/文本不一致。`analysisActions` 与 DSL 按相同规则重建可信入口，保留模型选择的合法 `action_ids`，空列表不强制生成按钮。前端展示优先级，未配置Chatflow时隐藏问答入口与追问按钮。

本地100项Node回归、20项DSL代码测试通过，标准JSON Schema校验和六页“Node输入→Python准备/结果校验→Node输出适配”合成数据往返通过；真实空数据回包通过当前后端解析。总览一次真实运行实际成功（361.5秒、5条诊断），原页面360秒上限先超时；只读取回同一次运行结果后通过完整字段校验。据此将分析等待上限改为600秒，重启8787生效，不自动重复调用；补跑14项AI服务测试通过。新等待上限下的完整页面成功显示及其余五页真实模型分析尚未复跑，不以合成数据代替模型验证。本轮未替用户更换模型、绑定云端知识库、导入发布或重打正式插件包。

### Workflow重新发布后的验收补充

用户重新发布后，现有App Key实时对应“来搜AW Workflow”，输入契约保持不变。发布后两次真实总览记录均succeeded，分别31.9秒/27.4秒，各4条诊断；空数据分支约1秒、0模型Token，正常返回error_result/error_raw_result。三份回包通过当前后端及公开V2.0 Schema；8787已实际显示诊断摘要、优先级、展开项、证据弹窗和数据范围，覆盖此前尚未复验的总览成功显示链路。其余五页与Chatflow仍未做本轮真实验收。

字段可用不等于业务推断已全部正确：当前摘要/依据仍会从独立的商机数和订单数推断转化效率偏低，后续应收紧Prompt，要求同批商机及成交归因后才判断转化。此次仅记录发现，没有改云端模型、知识库或Prompt。

### 六页AI建议的紧凑列表与左侧气泡

按用户浏览器批注与旧版彩色行动列表参考图，`public/ai-advisor.js / ai-advisor.css`统一六页建议样式：摘要只预览两行（宽屏非总览为四行），完整摘要和具体建议通过`advisor-detail-popover`查看；2026-09-11已移除数据范围弹层，列表不再内联展开。建议行保留标题/依据预览、文字优先级与橙绿紫黄蓝主题图标；主题匹配只用于装饰，不参与业务判断或修改返回字段。

共用非模态气泡挂在body，优先放入口左侧；空间不足时换侧，窄屏改为视口内底部浮层。正文独立滚动，Esc/关闭按钮恢复入口焦点，点击外部或同一入口可关闭；页面切换、范围重绘与锚点离屏关闭旧详情。2026-09-11已移除原始证据弹窗及聊天引用按钮，内部证据仍校验；Chatflow未配置时仍隐藏追问，已校验导航入口继续可用。Schema、Prompt、Dify配置与付费分析触发方式没有改变。

验收：103项Node回归与前端构建通过；浏览器使用已保存的真实总览结果，验证彩色列表、完整摘要、详情、证据、Esc/外部/同入口关闭和页面切换。1375px视口内展开前后卡片均为518.89px；390px视口气泡为366px宽、左右各12px，无横向溢出。本轮没有新增Dify模型运行或重打原生插件包。

## 2026-09-10 1.0.4 对话内 HTML 启动页

- 最新入口：用户在Accio对话说“打开来搜插件”→ `lsou-launchpad` Skill调用 `lsou_desktop_launchpad` → 原样渲染 `widget lsou_launchpad` → 点击按钮发送“启动来搜工作台” → `lsou_desktop_open`等待真实启动结果。此约定覆盖历史加载即启动说明。
- 页面唯一源码：`plugin/skills/lsou-launchpad/assets/launchpad.html`，单文件CSS/SVG/JS，无外部资源或本机凭据；普通浏览器无桥接时仅提示返回Accio。改视觉就在此文件，工具读取同一文件，不维护重复模板。
- Accio0.32.2已读源码：普通widget iframe只允许脚本；`window.__widgetSendMessage`经宿主向当前对话发送消息，无直接MCP成功回调。页面只显示请求已发送，结果由Accio工具回复；禁止计时器伪造ready。未确认插件详情页自动注入HTML入口，实际入口为对话。
- `desktop-mcp.cjs`连接待命，增加启动页工具，总计5个工具、2个Skill；显式open等待最终状态，其余诊断和有限恢复继续复用1.0.3机制。测试见`test/launchpad.test.js`与`test/desktop-runtime.test.js`。验收结果见开发日志。

## 2026-09-10 1.0.5 Windows 启动诊断复测

- Windows 1.0.3 原始证据显示客户端 `tools/call` 在约30秒超时，而 MCP 内部等待90秒；唯一后端 ready 记录的 `nativePid=0`，没有关联到 Tauri。后续窗口启动没有对应 bootstrap 日志，原生失败原因尚未由目标机确认。
- `src-tauri/src/main.rs` 从原生入口起向既有私有目录写 `native.log`，以时间、nativePid、固定阶段、系统码/退出码区分 Tauri 初始化、随包文件、Node 创建、Windows Job、输出结束与导航；stderr 仅记录固定类别。原始 stderr、URL、ticket、环境值不写入日志。Node 输出提前关闭会显示失败并通知 MCP，不继续静默显示连接中。
- `desktop/diagnostics.cjs` 的 `nativeStartup.events` 返回最多24条脱敏原生阶段记录；`lastStartup.source=standalone` 且 `processAlive=null` 表示摘要未关联原生进程，不能推导整体窗口已关闭或成功。
- `open`/`repair` 的单次工具响应预算20秒；内部90秒启动判断继续由同一 MCP 管理。预算耗尽返回 `pending=true`，不是成功；稍后读 `lsou_desktop_status`。恢复合并并发请求，状态返回 `recoveryState` 与完成后的 `lastRecovery` 摘要，不循环重启。必须保持插件会话存活。
- 本轮只生成 Windows x64 独立复测 ZIP；其用途是修正已复现的超时反馈问题并收集缺失的原生证据。Mac 两种现有1.0.4包仍为各自版本。本机测试/交叉编译不能替代 Windows 导入、点击启动和真实数据验收；结果见开发日志。


## 2026-09-11 AI范围缓存、建议气泡与工具兼容

- 六页分析由 `lib/ai-advisor.js` 按活动账号/空间、模块、时间粒度、起止日期、业务筛选与选中对象建立独立范围键。数据值、读取时间不改变同范围索引；快照内容ID仍独立用于验证引用。缓存文件升级为version 3，保存每个范围的最新结果和已脱敏原分析快照，取消最近30份截断，不设自动过期。文件0600原子保存，原始业务响应、凭据与会话不落盘。
- `POST /api/advisor/cache` 在业务查询完成前读本地持久缓存；`public/ai-advisor.js` 的会话内范围Map在切回时同步恢复。普通导航、日周月切换、查询刷新和新数据到达不会付费生成或清掉同周期解读。只有点击“生成解读/更新解读”调用分析，更新失败保留旧结果；同范围的不同快照并发合并。
- 新数据快照与缓存的 `cached_snapshot` 分开返回。追问使用原分析快照，不把旧结论重新绑定新数据。旧V2总览无业务筛选的记录按原周期迁移；其他旧记录只在内容指纹完全匹配时迁移，避免猜测旧筛选范围。业务筛选扩展时维护 `getAdvisorPageContext().cache_scope`，勿加入随机令牌、指标值或读取时间。
- AI气泡使用彩色标题、重点发现、编号步骤与绿色复查卡，仍优先在左侧悬浮，不改变图表卡片高度。移除数据范围/数据依据入口、原始JSON弹窗以及聊天内部引用按钮。证据引用继续用于后端校验，未修改Dify模型、知识库或Structured Output Schema。
- 星等级默认路径修正为 `icbu advisor icbu-starrating-cgs-pc-page-data-open`，输入字段仍为locale/statDate/terminal。真实WorkCTL 0.1.58返回1星、2026-09-09、两条赛道；页面已恢复指标、门槛与平台建议。
- `desktop/command-compat.cjs` 被运营READS与扩展能力只读查询共用。仅CLI明确在业务执行前拒绝命令/参数时，发现同名、身份可核验、mutating=false的唯一候选，核对输入schema，并适配json-file/params-file或明确声明的参数旗标；最多一次替代调用。认证、网络超时、业务拒绝与写操作不自动重放。当前支持同名命令迁移/参数入口变化，不宣称能自动适配任意改名或字段语义变化。
- 新增插件Skill `plugin/skills/lsou-workctl-compat/SKILL.md`，配套只读 `scripts/diagnose-command.cjs`；与原启动排障Skill分工。脚本使用当前账号运行环境与随包Node，schema通过与真实业务成功分开报告。prepare/package脚本同步兼容模块，并拒绝把旧原生载荷与新兼容脚本混打包。
- 验证：114项Node回归通过，前端构建和插件结构校验通过。真实旧星等级命令触发目录发现，切至新入口后读取成功；浏览器已验证日→周→月和跨页恢复昨晚8月解读，未新增Dify模型运行。正式三平台原生ZIP本轮尚未重建，浏览器验收不等于插件实机验收。

补充：商品列表提供账号内稳定 `analysisRef`，AI以object.cache_ref缓存；编辑继续使用限时productRef。历史建议只在稳定标识匹配时打开当前有效商品引用，不重绑历史证据。390px窄屏气泡实测366px宽、左右各12px，正文独立滚动且页面无横向溢出。

## 2026-09-11 AI 解读术语与业务中文

- 两份本地 DSL 的主 `llm_node`（Workflow「生成页面解读JSON」、Chatflow「回答当前页面问题」）加入「面向用户的业务中文与指标口径」规则。覆盖摘要、诊断、步骤、复查、缺项和追问，按数据来源解释字段；JSON键名、枚举及对象/证据/动作引用保留原值。真实搜索词、品牌、型号和用户需要的外语草稿不误译。
- 术语对照随主 System Prompt 维护，并同步 `dify-chatflows/operations-todo.system-prompt.txt` 与 README 的可复制增补段。客户画像 `shop_keyword.pv` 使用「平台搜索热度（指数）」，不能误作店铺曝光或与本店访客组成转化率；已确认广告来源中的 `qzt/p4p` 对应全站推广/标准推广，`camp` 等未明确字段不猜译、不用于确定性判断。字段说明冲突时保留业务缺项。
- 云端模型和知识库继续由用户维护；本轮只修改本地 Prompt，不自动同步/发布、重跑分析或清缓存。用户将 README 增补段粘贴到云端主回答节点并发布后，主动更新指定月份才使用新规则；其他历史解读继续复用。
- 20项既有 DSL 代码测试通过，主 Prompt 以外的节点、模型、Structured Output及代码保持相同。两份 CLI 严格检查/清单仍只报本地知识库未绑定，不代表云端知识库状态；新措辞尚未经真实模型生成验收。

同日补充覆盖审查：用户追问是否覆盖所有界面参数，明确前一版仅为通用规则与常见词表，不能当作全字段已核实。本次沿实际AI采集入口检查首批六页，补齐经营/星级、访客/会话、商品四象限/资料、渠道/国家、市场榜单/分布以及广告计划/费用/状态。9组源码固定定义的104个去重字段都有明确中文解释或内部禁显规则；动态平台字段仍可能新增，未知camp、冲突单位/枚举/公式不能声称已翻译。完整覆盖范围、待核项和复制段见README。两份本地Flow和独立Chatflow Prompt同步，仍未操作云端或改变历史缓存。


## 2026-09-11 Windows 1.0.6 增强诊断包

- 用户回传1.0.5报告：8次原生启动失败，手动同文件bootstrap可ready，原生日志nodeOptionsSet/nodeChannelSet为false。证据只把问题收敛到Tauri启动条件下首条bootstrap日志之前；不能据120ms断言未执行JS、不能据二进制字符串归因tao或Rust管道。
- 新增`src-tauri/src/native_evidence.rs`：持续排空stderr、保留前32KiB并脱敏，写本机`native-evidence.log`；正文最多16384字符，512KiB后轮换上一份。保留旧阶段事件接收时机；证据按nativePid/nodePid/时间关联。panic hook强制采集并脱敏backtrace，不修改用户RUST_BACKTRACE。未改spawn参数、管道、工作目录、环境或Windows Job策略。
- `desktop/diagnostics.cjs`只返回evidenceAvailable和固定文件名，不自动返回错误正文。Windows日志在`%LOCALAPPDATA%/com.lsou.workbench`，Accio读取后仅反馈必要的脱敏错误摘要；未知正文仍需人工/Agent复核，不能自动上传整份文件。没有新增运营Prompt或Skill。
- `release/lsou-workbench-1.0.6-windows-x64.zip`为独立诊断交付：以已发布1.0.5 ZIP为冻结底包，仅替换原生EXE、两份diagnostics.cjs、插件/build版本和MCP版本。业务payload、Node、bootstrap及其余文件保持逐字节相同，不含今天页面或AI功能变更。工作区package/Cargo/Tauri主版本仍为1.0.5，1.0.6版本只在隔离诊断构建目录设置，不能通过普通package脚本混包复刻。
- 6项Rust测试、18项桌面测试、Windows交叉编译/PE32+ x64、官方插件5项结构校验与52文件ZIP CRC通过。runtimeVerified=false，仍待Windows导入、启动并读取本次native-evidence.log。校验和与隔离构建说明见开发日志。


## 2026-09-11 Windows 1.0.7 路径兼容修复候选

- 用户回传1.0.6错误摘要为`EISDIR: illegal operation on a directory, lstat C:`。这证明某次文件解析失败，不单独证明CreateProcess参数被截断。当前Tauri依赖通过canonicalized current_exe解析资源目录；Node官方issue #60435报告带verbatim前缀的长路径出现同类错误。目标机完整argv/资源路径形态尚未直接核对，不能声称原始根因已完全复现。
- `src-tauri/src/node_launch.rs`负责Windows启动路径：仅将常规verbatim磁盘/UNC资源目录转换为普通绝对路径，保留中文、空格、长路径和共享名；相对盘符、设备路径、尾随点/空格等拒绝，避免静默指向其他文件。随包node.exe使用完整路径，cwd明确设为资源目录，唯一入口参数固定为相对的`payload\desktop\bootstrap.cjs`。继续使用Command参数API，不经过shell。Mac启动命令/cwd保持原行为。
- 原生证据新增resourceVerbatim、launchVerbatim、relativeEntry布尔值，供目标机复测判断实际路径形式，不返回完整路径；1.0.6的stderr/panic采集保留。认证、业务、Node版本、Job/stdio和前端均未修改。
- 1.0.7候选ZIP以1.0.6为冻结底包，仅替换EXE和三处版本/构建元信息。runtimeVerified=false、releaseCandidate=true；工作区主版本仍1.0.5，隔离构建使用1.0.7。Windows运行验证仍由目标机导入、点击启动、Tauri窗口显示及只读店铺数据验收完成。不能通过改JSON标记代替运行验收。


## 2026-09-11 1.0.8 数据清理与内部测试密钥

- 用户已确认1.0.7在Windows正常运行；这确认启动链路恢复，不代表所有业务功能逐项验收。随后反馈其他商家看到开发账号数据：核验1.0.7 ZIP确实包含workctl-demo.json、静态经营数据对象、商品图URL，以及RFQ/行业查询的固定手表默认值。
- 当前源码完全移除随包快照读取和旧静态数据/Legacy渲染器；/api/demo固定410，即使开发目录保留历史文件也不可读取。商品质量统计未实时核验的两项显示缺项；关键词画像仅读取当前账号。RFQ空词不查询商机，输入产品词后才搜索，报价历史仍从当前账号读取；权益无当前数据时显示未查询。行业类目取当前shop-summary，没有类目就不查询；发品类目/图片/参数/卖点/价格/包装不再继承示例默认值。
- scripts/verify-release-data.mjs为准备与打包增加数据检查，阻止demo-data、审计快照、静态样本关键词/行业编号/商品图及运行日志进入交付。当前源码是清理后的完整业务版本，1.0.8不再冻结旧1.0.5业务文件；保持已跑通的Windows原生路径修复。package、Cargo、Tauri、插件、MCP和前端版本统一1.0.8。
- 用户明确授权把两把APP API key封装到当前内部测试包。仅测试ZIP的payload/internal-test-dify.json携带默认Workflow/Chatflow配置；lib/internal-test-config.js只在后端读取白名单字段，普通源码不保存真实值。既有.env.dify/.env.advisor/进程环境及桌面本机配置继续可覆盖默认值；状态接口只返回是否配置，不返回Key。移除该JSON即可去掉默认密钥。普通打包检查默认拒绝此文件，只有显式内部检查允许。
- 本次提供Windows x64内部测试1.0.8 ZIP，不包含开发账号快照、图片或旧静态样本。真实Key只在该ZIP与临时构建目录，未写源码/前端/日志。应用信息GET核验通过，不代表Workflow/Chatflow模型生成验收。新包Windows实机仍需同事再次验证；旧1.0.7及更早包不可作为干净的跨商家交付使用。

## 2026-09-11：成功启动经验落实为启停增强 lifecycle-r1

依据用户分享 hu9crq54qMIV：1.0.7 直接 open 返回 ready，但工具发现绕路，关闭缺少 stop。更新 plugin/scripts/desktop-mcp.cjs：新增 lsou_desktop_stop，状态含 stopping 与 current_mcp_session 范围，等待持有子进程 exit 后报告停止；1.8 秒升级信号、5 秒有界超时，不批量按名称杀进程。停止请求递增生命周期编号，取消已在途的恢复，合并重复停止，停止期间 open 不创建新进程。MCP 保持待命，允许随后重新打开。后端仍由已有 Windows Job / Mac 父进程监测机制清理，不将窗口 exit 冒充逐一核验后端退出。

状态新增 backendReady/windowVerified/businessDataVerified；后两项保持 false，表示 MCP 未完成界面或业务验收。buildRevision=lifecycle-r1，沿用 1.0.8 原生程序，不伪造新原生版本。修改启动/排障 Skill：先发现当前注册 MCP，延迟发现无结果时读取实际 accio-mcp-cli 帮助，不猜路径和命令；用户直接启动时跳过 HTML，停止意图优先，不自动再次恢复。旧版无 stop 不猜参数。

SOP 参考 docs/references/国际站运营SOP.md 的“核心产品数据跟踪、店铺诊断”：输入为当前会话状态与用户意图，判断分开后端、窗口、当前店铺数据，动作限启停/有限恢复/只读验收，输出实证和未验证项。SOP 不覆盖 MCP/桌面进程，不强套经营阈值，未修改云端 Dify Prompt。

## 2026-09-14 1.0.9 接入 Accio 自带图片 CDN

- 产品发布页选择 JPG/PNG/WEBP（单张不超过 8MB）后，既有 `/api/publish/images` 改为调用 Accio 本机网关 `/api/image/cdn/upload`；请求是 `data_uri`，认证复用启动器注入的当前登录会话。上传本身不经过 WorkCTL，不再需要 `PUBLISH_IMAGE_BUCKET/ENDPOINT/PATH_PREFIX`。图片成功返回 HTTPS 地址后，前端替换本地预览并写入 `basicInfo.images[].newImageUrl`，保存草稿/正式发布继续使用原有 WorkCTL 队列与确认流程。
- 接口依据本机 Accio Work 0.32.2 源码与真实上传核验，为内部接口而非公开 WorkCTL 命令。仅允许回环网关地址，禁止重定向；凭据和图片正文不进入日志或前端响应。缺登录、旧版本、限流或上传失败显示可重试的中文提示，不自动切换存储。上传能力查询只证明本机会话已配置，不代表 CDN 调用已成功。
- 自动化测试 125/125 通过。包内 Node/React 的真实图片上传返回 201，匿名访问 CDN 返回 200 且图片字节一致；页面预览与商品 JSON 均已替换为 CDN 地址。此浏览器用例的其他业务读取使用测试数据，未提交真实商品。另通过 Mac M 芯片包内 MCP 启动 Tauri，确认当前店铺真实数据与产品发布页可见。
- 三个独立 1.0.9 ZIP 已构建、校验 CRC 和关键源码一致性。Mac M 芯片完成上述运行检查，Intel Mac/Windows 仅构建与包检查，仍待真机验证；未在 Accio 中重新导入安装新版 ZIP。标准包不包含内部测试 Dify 密钥；已有本机 AI 配置仍按原规则读取。旧内部 1.0.8 包保留，不代表其内置配置自动进入本次标准包。

## 2026-09-14 本地发品 SKU 与失败结果修复

- 用户保存 3 条草稿均返回 `JSON_VAL_EMPTY_SKU`。先前 material 只有阶梯价、没有 `trade.sku`；真实 CLI `--validate-only` 进一步确认每条 SKU 的 `skuAttributes` 也必须非空。此类错误发生在 JSON 校验阶段，不代表国际站已创建草稿。
- 当前 `server.js` 的 `normalizePublishSkus` 保留规格属性的 ID/名称/值/图片、商家编码、stock 和 unitPrice，删除旧商品 SKU ID。参考查询加入 `sku` component；`public/publish-product-utils.js` 将 `trade.sku` 深拷贝到本地 `product.skus`，“复制同类”继续深拷贝。`public/app.js` 提供规格/属性的增删、编码/单价/库存编辑，序列化回 `trade.sku`。新建商品不编造规格，草稿和发布均在入队前检查至少一条非空规格属性；单规格可沿用已填库存，规格价格可沿用已填首档价格，缺失数字保持空值。
- `publishFlowOutcome` 优先读 `pending_fix.details[].error`，识别 SKU 待补区域；前端结果/队列共用 `publishResultDetail`，失败先显示原因与错误码，评分缺失不转成 0。结果文案不再把本地校验失败说成已得到国际站返回。
- 完整测试 130/130 通过，含显式启用的当前 WorkCTL 真实 validate-only；最后空库存修正后再跑 8 项相关测试通过。浏览器检查规格编辑/增删、参考多规格保留、变更属性后清除旧枚举 ID、失败原因/空评分显示通过；React 构建与 diff 检查通过。8787 服务已重启，健康和 CDN 配置检查正常；当前店铺参考商品读取返回 5 个完整规格。没有创建或重试真实商品，没有刷新用户当前页面；旧浏览器待发布资料不会自动补回原本遗漏的 SKU。
- 此轮更新本地源码及服务，尚未重打此前三个 1.0.9 ZIP；正式交付需重新构建。新增 `test/publish-material.test.js`，真实 CLI 检查需显式环境开关；默认测试跳过该外部运行态检查。浏览器验收使用隔离数据，证据在 `/tmp/lsou-sku-qa/`，不进入交付。
- 补充真实材料校验：把当前店铺参考商品返回的 5 个规格与其属性、价格、图片等资料，经当前 `normalizePublishProduct` 组装，再调用 WorkCTL `--validate-only --compact-output off`，返回 `status=validated`。第一次未禁用 CLI 默认压缩输出，外层未提供 data，测试判定失败；明确关闭压缩后完成核验。全程只使用临时 0600 文件并在结束后清理，未调用商品创建接口。

## 2026-09-14 待发布商品删除与撤销

- 列表操作列在“复制同类”下方增加“删除”，仅移除 `publishState.products` 的本地待发布项，保留已提交任务与平台商品。`removedProducts` 保存原对象和位置，左侧顶部“撤销删除”按逆序恢复；删空列表后入口仍可见，恢复保留图片、SKU、编辑内容与已选状态。撤销历史只在当前页面内存保留。
- 删除当前项自动切换剩余可见商品，联动刷新已选数量、底部按钮及编辑器。排队/提交/图片上传期间禁用删除，动作函数也重新检查在途状态；队列刷新同步按钮可用性。不调用平台删除、取消任务或撤销发布接口，不回收其他副本可能共享的预览 URL。
- 1375×935 隔离浏览器验收通过：复制后删除、连续删除、删最后一件再撤销、恢复原顺序与 SKU、非当前项删除保留编辑对象、在途阻断、保留历史任务，无页面异常或真实写请求。静态资源由现有 8787 服务直接提供，未刷新用户页或重启后端；React 构建、语法与 diff 检查通过。未新增常规单元测试或重打插件 ZIP。


## 2026-09-14 产品发布资料改为账号本地缓存

本节取代前述“发布资料只缓存30分钟”和“图库超过24小时自动重读”的浏览约定；其他经营查询缓存不变。

- `lib/publish-read-cache.js` 保存 `catalog / categories / schema:<categoryId> / business-options / reference:<productId>`。只接收已裁剪的只读资料；目录只保存商品号、标题、缩略图、类目、计价单位和修改时间。默认存放 `~/Library/Caches/com.lsou.workctl-dashboard-publish-data/publish-read-cache-<账号哈希>.json`，可用 `PUBLISH_READ_CACHE_DIR` 指定隔离目录；按 `ACCIO_ACTIVE_SPACE` 哈希分文件，0600临时文件原子替换。未识别账号且未显式指定测试缓存目录时只存内存。凭据、浏览器短期引用、发布任务/结果不写入此文件。
- 第一次读取成功自动落盘；普通导航、整页重新打开和服务重启长期复用已保存的商品目录、类目规则、交易选项及已读取参考详情。首次选择尚未缓存的商品详情/类目仍需读取。历史图库沿用原账号文件，普通访问仅补齐缺失或目录修改时间发生变化的商品，不再按24小时自动全量查询。
- 发布页新增缓存时间与“更新店铺资料”。`POST /api/publish/cache/refresh` 合并并发更新，失效发布资料并重读目录、类目和交易选项；已访问的其他详情/规则下次访问重读，图库后台强制更新。实际目录读取绕过普通经营接口缓存；分页或交易选项读取失败不当作成功快照。失败保留旧文件但标记需重读，页面保留已加载资料并显示错误。顶部“刷新数据”在发布页调用同一入口；其他页行为不变。“清除缓存”同时清空这份账号快照。
- 浏览器更新参考库时保留当前待发布商品的标题、图片、价格、库存、SKU、选中项与队列；当前草稿使用的类目会按属性编码迁移至新规则。此次缓存是店铺参考资料，浏览器正在编辑的新商品及撤销删除记录仍在当前页内存，没有新增草稿自动保存或重启重放功能。
- 写前校验仍要求账号叶子类目、Schema、交易选项在30分钟内有效；过期会读平台，失败则阻止入队。随机参考令牌只保留当前进程，24小时有效，重建上下文重新登记，真实商品号不返回浏览器。
- 验证：134项全量测试，133通过、1项需显式启用真实CLI的校验跳过；新增账号隔离、磁盘恢复、并发合并、迟到请求、清空、文件损坏/不可写、过期规则及真实HTTP恢复检查。当前账号334件目录已缓存，重复目录/业务选项/Schema/参考详情并行读取11ms、WorkCTL新增调用0次；新隔离服务禁用上游后从实际磁盘恢复同一资料31ms、调用0次、参考含5个SKU。隔离浏览器验证导航复用、手动更新/失败保留编辑、顶部按钮分流；React构建通过。证据位于 `/tmp/lsou-publish-cache-qa/`，不打入交付包。


## 2026-09-14 上传图片后保存草稿遇到平台连接超时

- 本次日志显示图片上传成功；提交前交易选项和类目列表已读到，类目规则读取失败，`/api/publish/jobs` 为空，未进入写队列。截图错误为下游连接超时3133ms，不能归因于CDN或图片不合格；历史代码未记录失败子阶段，无法进一步区分当次属性列表与属性选项调用。随后单独只读调用两项均成功。
- `server.js` 新增 `runPublishRuleRead`，仅允许 `icbu product list-user-category/list-attribute/list-attribute-options/list-information` 四种只读命令，接入类目与交易规则查询。每次最多20秒；仅明确的超时/连接中断最多重试两次，间隔500/1000ms。权限、登录、参数及一般上游拒绝不自动重试。命令不带商品素材或凭据进入日志，按阶段/次数/耗时记录失败与恢复；上传及publish-from-json不在重试范围内。
- 规则查询连续失败时不使用旧规则放行，不创建发布任务；enqueue返回503/502，含 `submitted:false / retryable / code / stage` 与可读提示。页面确认弹窗保留完整错误、已上传URL和商品编辑内容。修复事件回调await后currentTarget为null导致失败按钮不能恢复的问题，提前保存按钮节点并恢复文字/可点击状态。新页面加载后使用修复的按钮逻辑；服务更新不刷新正在编辑的旧页面。
- 137项测试，136通过、1项显式CLI校验默认跳过。先用真实HTTP+假WorkCTL复现一次下游超时导致502，再验证恢复/连续三次失败/无写入及不重复上传；权限拒绝和写命令白名单边界测试通过。隔离浏览器先复现currentTarget异常，再验证上传新图后两次失败均保留JSON、按钮可重试、无页面异常；未执行真实发品。真实新规则读取返回21项属性、20项官方选项覆盖并写回本账号缓存。React构建、语法、diff检查通过，证据位于 `/tmp/lsou-preflight-qa/`；仅更新本地源码与8787服务，未重打ZIP。


## 2026-09-14 多选属性逐项输出修复

- GW75草稿新失败为 `JSON_VAL_ATTR_TOO_LONG`：浏览器保留23个Function选项，旧normalizePublishProduct只取前20项并用分号拼成278字符，超过WorkCTL 0.1.58逐条attrValue最多50字符限制。真实原商品多选本来就是同attrNameId的多条记录，前述“分号合并、共用-1”的约定不正确，已被本节替代。图片上传及此前的规则超时修复与此错误不同。
- 新增server.js `normalizePublishAttributes(rawAttributes, categorySchema)`，多选数组完整展开为多条basicInfo.attr，逐条匹配本次已校验Schema的官方attrValueId；自定义值保留文本，单值含分号不拆分。取消属性的80条/20值静默截断，仍由完整素材50KB上限控制大小。真正单条值超过50字符时入队前报字段名，不截断或丢弃内容。
- validatePublishProductSchema返回本次Schema，enqueue将对应规则传给normalizePublishProduct第三参数。旧页面原本就提交数组，因此后端更新后不必刷新页面或重新上传图片。public/app.js只修正序列化注释，表单仍保留每个已选项。
- 新增多选23项/官方ID/不丢第21项、超长单值与普通分号回归；HTTP集成通过实际enqueue和假CLI验证23条及对应ID。真实GW75资料经过生产参考映射、前端serialize、后端material后：修复前pending_fix、1条278字符；修复后23条、最长18字符、真实WorkCTL --validate-only返回validated。全量显式启用真实CLI校验139/139通过，React构建/语法/diff检查通过。证据 `/tmp/lsou-multi-attr-qa/`，未执行真实草稿创建或发布。


## 2026-09-14 发布工作区收起完成队列与就地选图

- `public/app.js` 的主页面进度和右侧发布队列只显示仍有 queued/running 的批次；该批次已完成的行保留到整批结束，结束后自动隐藏。完成弹窗仍只主动通知一次，`activeOperationId` 不因进度隐藏而被清除。
- “更新店铺资料”旁新增“发布历史”入口，`completedPublishOperations` 按 operationId 汇总当前服务已有的终态回执，`showPublishHistory` 展示批次时间、动作、成功/失败数；打开明细可查看所有任务及返回历史，不再截断至12条。历史沿用原服务进程队列，刷新页面仍可读取；本次没有增加跨服务重启的任务持久化或自动续跑。
- 创建标题移动到左卡片顶部的 `publishCreateHeader`，创建内容在下方独立滚动。全店图库缓存统计不再渲染，具体商品读取图片的加载/错误提示仍在该商品的选图区域显示。
- 选中参考商品时，旧图与“使用所选商品创建”按钮直接插入所选行之后。取消参考列表内层滚动，选中商品移动到创建内容可见区域；图库回填、图片勾选重绘保留滚动位置。切换搜索会清除旧商品的选图加载态，图片读取期间暂不可确认创建。
- 删除提示只在删除操作后展示8秒，进入新建流程或撤销最后一项时立即隐藏。撤销栈仍只在本页内存中保留；仅撤销本地移除，不调用平台删除或发布。
- 验证：隔离Playwright浏览器验证运行→部分完成→全部完成、历史14条明细与失败原因、通知仅一次、删除撤销不丢编辑、8秒及创建流程自动隐藏、第1/5/20行就地展开选图并保持勾选/滚动、900px与1375px截图检查。139项现有测试138通过、1项需显式启用的真实CLI校验默认跳过；React构建、语法和diff检查通过。证据 `/tmp/lsou-publish-ui-qa/`，不包含真实发布。


## 2026-09-14 商品主副图统一限制为6张

- 用户指出编辑器商品主副图应最多6张，旧代码在参考复用、手动上传、文件夹导入、渲染与序列化各处使用10张，现由 `public/publish-product-utils.js` 导出的 `MAX_PRODUCT_IMAGES=6` 统一前后端约束；历史图库、SKU规格图、详情图的资料读取不按此上限截断。
- 参考商品默认选择前6张主副图，旧图选择计数为6张上限。编辑器/待发布列表展示真实主图数与6张上限，满额隐藏上传入口，删除后恢复；一次手动选择超出剩余名额时整批不上传，超量文件夹整批不创建，不静默丢掉后续文件。
- 旧草稿超量时所有图片仍可见、可排序和逐张删除；渲染、排序、删除与序列化不再slice截断，保存/发布前提示减到6张。server.js normalizePublishProduct对去重后的7张以上远程主图明确拒绝，不截断后提交。
- 验证：隔离浏览器覆盖旧图6张上限、8张旧草稿保留/排序/删除、超额上传0请求、5张加1张成功后禁用继续添加、文件夹7张整批拒绝；0页面异常、0真实写操作。新增纯转换6/7张边界与现有HTTP集成绕过前端的7张拦截，140项现有测试139通过、1显式真实CLI校验默认跳过。React构建、语法和diff检查通过，证据 `/tmp/lsou-image-limit-qa/`。
- 运行边界：当前8787继续保持原服务以保留进程内发布历史，前端静态资源已更新；重新加载页面后前端6张约束生效，新增后端防绕过校验已在隔离HTTP服务验证、随主服务下次启动加载。未刷新用户当前未保存商品的标签页，未重打插件ZIP。

## 2026-09-14 发品编辑器关键词来源、类目选择与图片插入

- 参考创建和“复制同类”沿用已有关键词深拷贝，不从标题生成原商品关键词。`mapReferenceProductToDraft` 新增 `keywordSource / referenceKeywordsEmpty` 来源状态；参考接口确实未返回关键词且当前仍为空时，编辑器提示“参考商品未返回关键词，可在此补充”。本次真实只读核对 E900 商品：`list-information` 的 trunk 原始 `basicInfo.productKeywords` 为空，`query-product-by-id` 也没有关键词字段，因此不能把空白归因为前端漏带。
- 类目搜索和已选类目合并为一个 `details.publish-category-picker`，平时只显示选中路径，打开后就地搜索和选择。支持方向键、Enter、Esc 和点击外部关闭；搜索序号与商品 ID 防止迟到响应覆盖新查询，重绘编辑器时取消旧输入的防抖与请求。
- `updatePublishImageInsertion` 根据图片左右半区计算原数组的插入边界，多行先找最近行；`bindPublishImageSorting` 将鼠标手柄、原生图片拖拽及触屏手柄统一到同一排序方法。独立橙色竖线覆盖在图间空隙，不改变网格布局；松手按边界插入并同步封面，Esc、取消事件或图库外松手不修改顺序。
- 本轮只改前端和既有纯函数测试；保留8787进程及发布历史，不刷新用户的未保存编辑，不改Prompt或正式ZIP。验收证据在临时目录 `/tmp/lsou-editor-detail-qa/`。

## 2026-09-15 图片上传完成后复制与发布质量分呈现

- `publishCopyBlockedReason` 由列表按钮、点击处理与 `clonePublishProductDraft` 共用：等待、读取、上传中、失败或仍有非远程主图时不可复制，全部图片取得 HTTP(S) 地址后恢复。空图片草稿仍允许复制；删除失败图片后按剩余图片判断。成功副本保留图片 URL、顺序与封面，清空 `uploads`，不复制 File、临时预览或上传任务。
- 质量分展示使用原有 `/api/publish/jobs` 的 `finalScore / lowScore / deductReasons / qualityScoreMessage`，后端接口与队列不变。`publishQualitySummary` 只按平台 `lowScore` 标记提示低分，不根据分数硬编码阈值或满分；0分保留为0，缺失评分保持未知。发布/保存成功与质量低分分别呈现。
- `QUALITY_REASON_LABELS` 依据当前已安装国际站生意助手 `alibaba-global-product-optimize/references/product-score-rules.md` 的扣分项对照表提供中文。现有中文原因原样显示，未知编码不猜含义，显示中文兜底并允许展开原文。前端不再截掉接收到的第3条/第4条以后原因；后端原有最多8条归一化约定未改变。
- 完成弹窗、发布历史明细、当前商品结果共用 `renderPublishQualityCard`，大号分数与中文原因分栏展示，低分为橙色。结果轮询通过 `updatePublishOutcomeInsight` 单独更新区域，相同回执保留展开状态与焦点，避免重绘当前编辑输入。
- 真实历史只读核验：当前6条草稿均为3.9分、`lowScore=true`，返回 `title_word_miss_core_error`，对应“标题缺少核心词”。浏览器验收隔离其他业务与上传接口，未触发真实发品或CDN写入。8787不重启，原浏览器页不强制刷新；前端刷新后生效，已有历史可直接按新版呈现。

## 2026-09-15 精简产品发布顶部按钮

- 移除顶部 `publishCreateNew / publishReadyTop` 及其事件、数量和禁用状态更新。新建入口保留在左侧空态 `publishEmptyCreate` 和商品列表 `publishCreateFromList`；批量保存/发布继续由底部按钮操作。
- `publishImportFolder` 保留，并增加用途提示：按子文件夹分组生成待发布商品、上传图片，每组最多6张。文件夹名作为初始标题，仍需补齐资料和确认发布；导入本身不创建平台发布任务。既有文件分组/上传行为未修改。

## 2026-09-15 移除文件夹导入并统一刷新入口

- 本节取代上一节保留文件夹导入的约定：删除 `publishImportFolder / publishFolderInput`、文件夹分组建品函数与左侧面板拖入建品事件。商品编辑器的普通图片上传、6张上限和图片排序继续保留。
- `publishHistory` 移到顶部 `publish-command-row` 右侧，仍调用同一历史弹窗及质量分明细。缓存行只保留读取状态、更新时间与错误提示。
- 删除 `publishRefreshSources`；右上角 `btnReload` 为唯一刷新入口。在发布页仍调用 `refreshPublishSourceData`，更新参考资料并保留已填写商品；刷新过程中禁用按钮，结束或失败后恢复。其他页面沿用原经营数据刷新。
- 验证：隔离浏览器覆盖入口移除、历史及中文质量分、普通文件选择、刷新加载/成功/失败/重试、编辑资料与历史保留、900px/600px状态栏无溢出；0页面异常、0真实写入。Node语法、React构建和diff检查通过，证据 `/tmp/lsou-toolbar-final-qa/`。更新静态资源，不重启8787、不刷新用户原页，不打包ZIP或提交Git。

## 2026-09-15 移除顶部统计并提供官方草稿箱入口

- 删除 `publishStatusStrip` 四项数字、`renderPublishStatus` 及全部调用和专属样式。保留商品行状态、底部校验、执行中的进度与发布历史。缓存提示、查看草稿箱、发布历史合并为一行，不保留空白统计行。
- 新增 `publishDraftBox` 外部链接，使用当前安装的国际站插件 `alibaba-product-publish/reference/url-direct-publish.md` 提供的完整 `products_manage.htm#/product/sketch/...` 地址；新标签打开，使用noopener/noreferrer保留当前页编辑。当前实现为打开国际站后台，尚未接入插件内全量草稿列表，也未把本机保存回执作为平台现存草稿清单。
- 真实只读核验：当前WorkCTL提供product search（必填商品号）、list-information（queryType=draft，必填商品号）和product list（仅商品号/名称，无分页或草稿筛选参数）。选取一条已保存回执查询，search返回空数据，draft详情返回Record does not exist，不能仅凭过去保存成功断定商品仍在草稿箱；无条件list未取得结果，已终止本轮查询，不据此声称平台不支持草稿箱。
- 浏览器验收：移除统计后初始化、输入联动、运行/完成进度、历史评分、刷新成功/失败/重试、编辑保留、普通文件选择正常；草稿箱链接精确匹配官方文档并独立打开（目标站点使用测试替身），900px/600px工具行无溢出。Node语法、React构建与diff检查通过。证据 `/tmp/lsou-drafts-qa/`；未验证登录后的官方草稿列表或正式Tauri包。保留8787服务及用户原页，不改后端或打包ZIP。

## 2026-09-15 用户纠正：草稿箱必须通过WorkCTL读取

- 用户明确要求在插件内通过WorkCTL查看草稿箱，不接受官网跳转。上一节的外链方案不符合需求，现已删除publishDraftBox与专属样式；四项统计仍保持移除，发布历史和原编辑/发布流程保留。
- 重新使用当前活动空间的WorkCTL核验，并执行当前分区cache refresh后再次发现草稿命令：product search（RPC draft_judge_and_search）必填productId；list-information的draft也必填productId。当前公开目录未发现整箱枚举/分页查询草稿的命令。未用本地历史回执冒充完整草稿箱，也未添加无真实读取能力的入口。
- 纠正上一节无条件list挂起的原因：CLI支持stdin输入，execFile未关闭stdin且未传业务参数时会等待输入。本次显式传入空JSON文件并关闭stdin，product list成功返回[]；按真实保存标题查询也返回[]。另一条真实保存回执的search返回data=null，draft详情返回Record does not exist。上述结果不证明全店草稿箱为空，也不证明历史保存失败。
- 当前需求状态：官网外链已撤回；通过WorkCTL列出完整草稿箱尚未实现，缺少可验证的整箱列表能力。已有按ID接口也未在本次样本上返回可用草稿正文。证据 `/tmp/lsou-workctl-drafts-qa/`，不把查询合同存在写成完整功能已接通。

## 2026-09-15 参考商品自定义关键词属性回填

- 用户反馈 M5 参考商品关键词仍为空。真实 WorkCTL `list-information` 的标准 `basicInfo.productKeywords` 为空，但同一商品的自定义 `Keywords:` 属性有值；参考模板及现有本地缓存已包含 `Keywords:: M5 Smart Watch Band`。此前只读取标准数组，漏掉这一来源；不能用之前 E900 的查询结论解释所有商品。
- `public/publish-product-utils.js` 的 `readReferenceKeywords` 先读标准关键词，为空才读取当前参考商品 `texts` 中整条明确标注的 Keyword / Keywords / 关键词属性。兼容模板双冒号，去重并保持现有最多5词、属性回填每词40字符限制；不递归搜索描述内推荐商品，不从标题猜词。标准字段来源仍为 `reference`，属性来源为 `reference-attribute`，编辑器显示属性来源提示。
- 现有本地缓存即可用于新建参考商品，复制同类继续深拷贝关键词。本次只改前端读取与说明；不清缓存、不重启8787、不改当前页面已编辑商品。重新加载前端后，再选择参考商品时生效。
- 验证：使用这款商品的真实读取响应进行隔离Chrome流程验收，确认新建自动带入、复制保留且可独立修改、标准字段优先、空来源不编造；7项辅助函数测试、语法检查、React构建及diff检查通过。证据 `/tmp/lsou-m5-keywords-qa/`；没有真实上传/保存/发布操作，未重打正式插件包。

## 2026-09-15 从发布历史继续编辑原商品

- 结果明细中成功的草稿/发布记录新增可点击标题与“继续编辑”。`POST /api/publish/jobs/:jobId/edit` 只接受历史任务ID，服务端从回执取productId，调用 `operations.readProductForEdit`，经 WorkCTL `icbu product list-information` 的 `queryType=draftFirst` 读取后发放原商品编辑引用。不会按相同标题搜索或走新建发品接口。
- `public/operations.js` 的原商品编辑弹窗复用预读取资料，标题、关键词、主图替换、卖点、公司介绍与FAQ沿用已有编辑能力；类目属性、价格、履约仍只读。保存只提交变化字段到 `product-edit-draft-basic-info / product-edit-draft-detail`，发布仍经独立确认调用 `submit-draft`。弹窗内“本次编辑任务”显示当前编辑产生的回执，发布工作区已填写商品不被覆盖，关闭编辑后回到原历史明细。
- 历史读取失败在原条目显示中文原因并允许重试；`success=true,data="Record does not exist."` 不能视作可编辑资料。用户关闭历史后，迟到响应不再打开编辑器。当前真实历史样本在draft、trunk、draftFirst三种查询均未读到商品，不能宣称这批草稿已完成真实编辑验收，也不能据此判定整店草稿箱为空。
- `restorePublishHistory / persistPublishHistory` 只恢复最多200条终态摘要，不恢复queued/running/material；失败回执禁用重试。现有6条历史已从原服务备份并迁移，核对当前账号专属目录缓存的精确更新时间后更新本地后端；新服务PID58637，回执保留6条，没有重放任务。原浏览器未强制刷新，重载前应保留未保存内容。
- 验证：全量146项测试145通过、1项真实CLI默认跳过，React构建与语法/diff检查通过。隔离HTTP覆盖同名商品准确定位、原ID更新、跨源/伪造目标拒绝、终态跨重启恢复、缺失资料拒绝；隔离Chrome覆盖继续编辑、只提交改动、独立发布确认、原处失败、迟到结果与当前工作区保留。证据 `/tmp/lsou-history-edit-qa/`，未执行真实修改/发布，未打包正式ZIP。

## 2026-09-15 发品结构化详情编辑与提交

- `public/app.js` 的本地商品新增 `detail`：`detailImage`/`companyImage` 为有序 `{url,text,imageSetId?}` 列表，`companyDesc` 为文本，`faqs` 为 `{question,answer}` 列表。独立“商品详情”区支持上传、重试、删除、拖拽/按钮排序、图注、公司介绍和问答编辑，原生弹窗预览当前内容。预览转义所有文字，不执行来源 HTML；国际站最终装修排版不由本地预览保证。
- `server.js` 的 `queryPublishProductDetail()` 通过 WorkCTL `icbu product list-information` 的 `trunk` 版本读取 `detailImage/companyDesc/companyImage/faqs`。已有商品选择与链接导入均带入结构化详情；新的 `detail:v2:<productId>` 资料键按账号落盘、默认复用，旧参考缓存无需全店清除即可补齐详情。读取失败不缓存为空资料，不从商品推荐区拼接正文。
- 图片响应中不同 `imageSetId` 的 `imageIndex` 可重复，导入按原响应顺序保留图片和图注。复制新商品不带旧页面 ID，保留图片的 `imageSetId` 图集分类；提交按用户勾选保留图片，在每个图集内重建 `imageIndex`，映射为 `detail.detailImage/companyImage[].newImageUrl,imageText,imageSetId`，并带上 `companyDesc` 与 `faqs[].question,answer,sortOrder`。卖点仍用原 `productSellingPoint` 字段。
- 主图 6 张限制只作用于主图库。详情和公司图片各有 100 项工作区资源保护边界（不是平台规则）；完整 material 仍受既有 50KB 上限约束，超量拒绝而非截断。`public/publish-product-utils.js` 共用详情默认结构及校验；上传记录用 `section` 区分详情和主图。未取得远程地址或上传失败会阻止复制、草稿和发布，详情问答半填也会阻止提交。排序、切换商品和删除不影响上传所属对象，迟到响应不能恢复已删除图片。
- 复制同类深拷贝详情内容，复用已成功上传的 URL；保存/发布确认摘要显示各类图片和问答数量。此项补齐的是新发品工作区，已有商品历史弹窗继续沿用已有 patch 编辑能力，不宣称能完整复刻旧 HTML 页面或所有旧装修模块。
- 验证：148 项 Node 测试中 147 通过、1 项真实 CLI 默认跳过；另行启用真实 `validate-only` 后 7 项全部通过，包含 10 张商详图的 material 原样保留。隔离浏览器验证实际读取资料回放、独立复制、排序插入线、图文编辑与转义预览、上传失败重试/迟到删除、草稿/发布提交字段和窄屏。真实当前商品端点读回 10 张商详图、18 张公司图片、1321 字公司介绍和 8 条问答，第二次读取复用缓存。平台真实商品写入未在本轮测试执行。


## 2026-09-15 商品规格按已有值展示、空字段按需补充

- `public/app.js` 的规格名称和值保留直接编辑；商家规格编码、独立单价和库存有值时直接显示，无值时放入原生“补充规格信息”折叠区。0 是有效库存。用户编辑过的字段清空后仍保留输入框；WeakMap 按 SKU 对象保存显示/展开状态，不进入素材 JSON、不在副本间共享。添加规格/属性仍能直接填写必需名称和值。
- 收起只是界面展示变化，不删除资料或修改写入规则。多规格缺库存时折叠入口提示正式发布前需填写，`publishActionIssues` 给出具体规格编号；草稿仍允许不完整交易字段。单规格可沿用已填总库存，空单价可沿用首档价格，服务端继续独立校验。
- 实查 M5：当前 list-information 返回规格名称 p-191288010，而 query-product-by-id 同商品销售属性返回 color。`completePublishSkuNames` 只为占位/缺失名称补读完整商品详情，按 propertyId 匹配；仅访问 productQueryResult.skuList.salePropertyPairList，并核对原商品号，排除推荐内容与冲突名称。保留原 SKU 编码/价格/库存/空值，不用平台内部编号代替商家编码。
- 名称映射使用账号本地缓存键 `sku-names:v1:<productId>`；旧参考缓存无需全店刷新即可补齐，正常名称不额外查询。缓存只留属性 ID 与名称；读取失败安全记录日志、提示重试，不缓存成空资料。仅接入账号参考回填，不拓展已有商品写接口。
- 验证：150 项 Node 测试149通过、1真实CLI默认跳过；React构建、语法、diff检查通过。隔离Chrome核验真实M5结构的15个空输入默认隐藏、有值与0显示、键盘展开、清空保留、复制隔离、必需库存阻断、600px布局，0页面异常与平台写入。真实本地端点返回5个color规格，空值保留，首读4193ms/缓存3ms。确认账号缓存及空闲队列后把8787从PID65793更新至69804，6条历史保留、0重放；未刷新用户原页、提交Git或打包正式ZIP。证据 `/tmp/lsou-sku-fields-qa/`。


## 2026-09-15 右侧商品编辑器轻量美化

- 用户要求只轻微美化，保持整体布局、原配色及现有业务。`public/style.css` 末尾使用 `#publishEditor` 限定样式：标题/标签略增字号，主要输入统一32px与7px圆角，边框柔化、橙色焦点，分组和字段留白微调。沿用项目字体和颜色变量，不添加新主题、导航、动画或流程。
- `public/app.js` 只为SKU容器/属性行加样式类，将大块删除属性按钮改为紧邻输入的小图标，保留原事件、禁用状态、title及可访问名称。补充规格仍默认收起，编码/库存/价格和所有序列化规则不变。底部操作继续固定，600px下保留现有重排并将包装输入分两列。
- 隔离Chrome以当前M5参考与8项真实Schema回放，比较美化前后序列化完全一致、左侧布局尺寸不变；验证标题/关键词、焦点、类目和原产地选择、拖图插入线、SKU增删与空项展开、详情预览，1375/900/600px无编辑区溢出，0页面异常/真实写请求。Node语法、React构建、diff检查通过。只更新静态资源，未重启后端或刷新用户原页、未打包ZIP/提交Git。证据 `/tmp/lsou-editor-polish-qa/`。


## 2026-09-15 常见问答轻量美化

- 问答区域沿用右侧编辑器局部颜色变量与轻量风格：调整标题/数量、边框和留白，删除按钮使用低强调的图标加文字。回答继承页面字体，解决浏览器默认等宽字体造成的旧式观感；问题由单行input改成可换行textarea，保留原数据属性与可访问名称，不改变字段内容和提交格式。
- 添加问答后直接聚焦新增问题，避免长列表中寻找空条目。问答仍保持逐条展开；原有删除、复制、半条问答校验、预览及空态逻辑不变。
- 隔离Chrome回放当前M5的4条问答，验证初始序列化精确一致、长问题/多行回答/HTML字符安全保留、添加定位、删除重排、复制隔离、空态和预览，1728/1375/600px无区域溢出，0页面异常/真实写入。语法、React构建、diff检查通过。仅更新静态资源，未刷新用户原页/重启后端/打包或提交Git；证据 `/tmp/lsou-faq-polish-qa/`。

## 2026-09-15 移除编辑器规则匹配提示

- 按用户标注移除商品图片下方的“已根据当前账号商品匹配发品规则”横幅，同时删除其专用文案变量和样式。账号规则读取、未加载时的阻断界面及提交校验保持原逻辑。
- 语法、React构建、diff检查和隔离浏览器验证通过：横幅不再渲染，商品编辑/详情序列化及规则加载阻断正常，0页面错误/平台写入。仅更新静态资源，未刷新用户原页或重启后端；证据 `/tmp/lsou-remove-banner-qa/`。


## 2026-09-15 图集选择及顶部发布操作栏

- 用户确认接入 WorkCTL 已支持的图片图集，并要求将批量操作栏移到原缓存状态所在的顶部。`public/index.html` 将原操作节点移至工作区之前，发布历史并列放置；保留原ID、选择范围和写入确认。正常缓存时间转为操作栏title，刷新/失败状态仍在栏下可见，底部只保留当前单品操作。
- `public/publish-product-utils.js` 共用图集ID校验、已选图片过滤和已核实分类名称。当前内置分类来自当前账号商品的 `mediaInfoDTO.imageSet`，不是完整平台枚举；未核实的源图集显示“原商品图集（ID）”，无ID图片显示“未分组”，不猜测自定义分类。新增自定义图集的创建/命名接口未接入。
- 详情图片保存可选 `imageSetId`；用户操作后 `detail.imageGroupSelection` 按图片字段记录勾选ID，旧数据默认选中已有图片所属图集。取消勾选只隐藏并排除本次提交，图片留在本地可恢复。复制保留全部图片和各自勾选状态且不共享引用；空图集勾选仅是本地编辑入口，不声称向平台写入空图集开关。
- 前端按图集显示各自上传区，可逐图移组、修改说明、删除和组内拖动（橙色插入线）。异步上传只回填所属图片URL，不覆盖移组结果。预览、确认数量及服务端素材使用同一勾选规则；素材去除选择器状态，在每个图集中独立编号。未上传图片继续按原全商品规则阻止复制/提交。
- 参考详情缓存升级至 `detail:v2:<productId>`，旧v1不覆盖或清空；选择参考时按需重读一次补回imageSetId，无需刷新全店。成功资料及未知源ID按账号保存，失败仍记日志且不缓存为空。
- 验证：152项Node测试151通过、1项真实CLI默认跳过；单独启用当前WorkCTL validate-only的10项测试全通过。隔离Chrome覆盖取消/恢复/预览、复制隔离、组内排序和移组、失败重试与上传中移组、未知/无分组、提交选择、顶部操作栏位置及1375/600px布局，0页面异常/平台写入。真实本地接口读回10张商详图及18张公司图，含2/6种图集，首读1790ms、缓存3ms响应一致。
- 服务由PID69804更新到76207，6条历史完整保留且0重放；未刷新用户原页、执行真实发布、提交Git或打包ZIP。证据 `/tmp/lsou-image-groups-qa/`。


## 2026-09-15 移除队列模式选择器

- 按用户标注删除顶部发布操作栏中只有一个选项的“队列模式”标签和下拉框，以及专用CSS；调整窄屏发布历史所在行，避免移除后留下空行。原控件不被JS引用，服务端逐条执行与间隔规则不受影响。
- React构建、语法和diff检查通过；隔离Chrome核验控件消失、1375/600px操作栏无溢出、发布历史及批量草稿确认可打开，0页面错误/平台写入。仅更新静态资源，未刷新用户原页、重启服务、提交Git或打包ZIP。证据 `/tmp/lsou-remove-queue-policy-qa/`。


## 2026-09-16 ALI 运营顾问界面整合

- 用户批准按参考 HTML 的八个模块替换界面，产品发布全量保留并在侧栏独立突出；旧业务工作区经二级导航和辅助工作区继续访问。
- `public/consultant.js` 负责模块归属、运营规划、营销定位、运营基建、优爆品跟进与看板补充；`public/consultant.css` 负责新版外观。React 与原生入口共用这些文件。产品发布原 HTML、原样式表、发布工具与后端未改动。
- 新增规划/任务/确认表使用浏览器本地键 `lsou:consultant:local-planning:v1`，不是账号云同步或 AI 自动报告。真实核心品候选读取商品分析接口；平台分层原值保留，候选排序不等于平台判定。业务员表按当前统计周期取报告，缺失值不转零，自定义时间不伪造汇总。
- 备份：`/Users/garden/YD/ReverseAccio/lsou-ui-backups/20260916-155623/`，包含完整工程归档及源码归档。
- 验证：Node 全量 155 项，154 通过、1 默认跳过；React 构建通过；浏览器检查九个入口、600px 窄屏、本地任务保存、真实商品候选及 React 发布编辑器切页保留。此轮未提交平台草稿/发布、未重新打包三平台插件。


## 2026-09-16 按八张已确认图片重新实现界面

- 上一次仅调整风格未满足用户按图还原要求，本条取代上面的默认入口说明。八模块默认进入可交互的设计预览，顶部明确标记“示例数据”；查看真实工作区可返回原数据业务页。当前预览不代表真实经营数据或已完成AI执行。
- `public/advisor-design.js/css` 管理独立外壳、导航和共享组件；`advisor-workflows.js` 管理规划/定位/基建，`advisor-analytics.js` 管理推广/核心品/数据分析，`advisor-dashboard.js` 管理看板/商机。原生HTML与React入口共用四个脚本与样式。
- `window.AdvisorPages` 注册页面，`AdvisorMounts` 挂载交互，`AdvisorDesign.navigate/real` 切换设计预览和原真实工作区。预览事件 `lsou:navigation`；商机本地演示分配键 `lsou:advisor:demo-leads`。商品图为新生成的演示素材 `public/assets/advisor-products.png`。
- 产品发布始终进入原DOM与原逻辑，禁止用预览重新渲染编辑器；基础样式、发布工具和后端与换版前备份一致。旧 consultant 文件继续服务原真实业务页。
- 本地入口 http://127.0.0.1:8787/；参考HTML的8765服务保留。验证使用 `npm run build:frontend`、`node --test test/*.test.js`，浏览器检查八页、600px布局与原发布入口。当前为浏览器设计实现，尚非三平台插件交付验收。


## 2026-09-16 八页新版切换真实 WorkCTL 数据（取代设计预览约定）

- 用户要求直接在新版读取真实数据，八页不再保留演示数据分支。`advisor-design.js` 提供 `AdvisorLive.fetch/range/format`，复用当前服务的账号与 WorkCTL 环境；默认上一个完整自然月，支持日/周/月与自定义31天范围。商品不支持周/任意范围时单独标注完整月口径。
- dashboard：shop-summary/shop-channel/shop-region/account-summary/shop-product、已保存overview-tasks；visitor：visitor-detail和customer-profile。访客接口实测忽略pageSize20，采用每页10并优先使用响应有效pageSize；累计访客不冒充询盘客户，记录总数不视为独立人数。
- analytics：advertising/report+plans真实直通车/全站推报表和投放配置；两商品页复用dashboard/product-analysis及平台图片。报表空值不补零，商品去重数与平台total不一致时显示部分样本，AI对话/跟进任务无真实来源则显示未接通。
- workflows：shop-product及customer-profile(shop_keyword/country)。真实关键词可导出；经营目标/定位/任务为明确标识的页面内人工草稿，刷新清空，不写平台，不编造公司能力或词与商品关联。
- 当前真实接口存在本账号缓存，页面标注查询周期及读取信息；读取成功不意味着刚刚刷新平台。数据图片仅来自返回记录，生成的演示商品图不再被页面引用。产品发布仍是原DOM/业务逻辑。
- 验证：158项测试157通过1默认跳过，React构建及JS检查通过；浏览器原生/React真实数值一致，商品筛选/详情与访客第二页正常，八页600px无外层横溢出。未执行平台写入、未打包或提交Git。

- 2026-09-16 顶部按用户批注移除“更多业务工具”和WorkCTL连接状态标签；删除该标签专用健康探测，页面自身真实数据查询照常运行。


## 2026-09-16 统一刷新与界面文案

- 顶部统一“刷新”重新加载当前模块，保留所选日期与页面内人工记录；去掉分散的重新读取按钮和界面中的工具名称。读取期间按钮禁用，完成或失败后恢复。


## 2026-09-16 看板指标简洁版与详细版

- 看板经营指标提供简洁版六项和详细版十二项切换；详细版复用 `app.js` 的原始 `OVERVIEW_KPIS` 定义，经 `LsouOverviewMetrics()` 返回副本，展示行业均值、优秀值及比较。广告花费未接入时保留缺失状态。
- `advisor-dashboard.js` 使用同一份真实汇总响应切换展示，不追加查询；累计与最新日指标分别计算。选择保存在本地键 `lsou:overview:metric-mode`，刷新及切页保留。样式位于 `advisor-design.css`。

- 详细版布局调整：桌面六列两行共用紧凑面板，行业数值以内联小字保留，比较说明与统计口径移至指标悬停提示。

- 简洁版六项指标下方也显示对应行业均值/优秀值，统计口径保留为悬停提示；TM访客使用fbTmUv的同行字段。

## 2026-09-16 产品发布统一外壳

- 产品发布复用av-mode顶栏、侧栏与背景，保留原tab-product-publish DOM及加载器。AdvisorDesign仅接管外壳，返回false继续原导航；顶部刷新转交原btnReload。移除辅助工作区选择器。

## 2026-09-16 暖色品牌与看板列表

- 共用顶栏恢复原来搜图片logo，名称统一运营顾问；外壳背景微橙。顶部KPI维持紧凑，业务员列表增加姓名标识及行距，产品榜单采用序号与两行标题，健康度使用对应语义图标。

## 2026-09-16 恢复运营服务报告与对话入口

- 七个非看板模块通过 `advisor-services.js` 提供30个主题入口和共用dialog抽屉，分分析报告/问顾问。两入口同步加载该脚本。
- 复用已有 `/api/advisor/config|context|analysis|chat`，主题写入cache_scope及SOP方法限制，沿用六页后端分析合同，未新建30套独立Dify流程。`AdvisorLive.records()`按导航代次收集实际成功读取；旧页面迟到响应不进入当前页。
- 报告使用真实返回结果并支持Markdown下载；会话按页面、主题、日期隔离。服务状态实测analysisConfigured=true、chatConfigured=false，聊天UI存在但发送禁用，需配置现有后端Chatflow才可问答。

- 商机页内嵌 RFQ：`public/advisor-dashboard.js` 的 `mountRfq` 复用 `rfq-internal-search` 只读接口，默认搜索词来自当前店铺近30天 `customer-profile/shop_keyword`；用户可换词搜索，原生折叠卡展示脱敏采购说明和报价名额。RFQ 属于独立当前商机池，不随经营日期筛选，也不关联到选中访客。完整站内/站外搜索与报价记录仍在原 RFQ 工作区。

- 2026-09-16 业务交互更新：七页移除独立“运营服务”栏。`AdvisorServices.attach` 将主题分析按钮放入对应业务卡片；定位复用五项左侧菜单，基建复用四步按钮。点击等待 `AdvisorLive.ready()` 后调用现有顾问 context/analysis，右侧内嵌结果自动生成；不新增专用Dify工作流，沿用既有分析契约。工作区高度跟随视口固定，左右内容内部滚动；定位原数据和任务/历史入口保留在右侧折叠区。定位结构重绘由观察器恢复当前主题，异步结果只更新所属会话。此交互取代此前模态报告抽屉。

- 2026-09-16 结果卡片协议：`public/advisor-services.js` 的 `layouts` 定义30个主题各自四个固定板块，`presentationRule` 通过现有Workflow业务输入约束tasks标题和短文本长度，继续兼容schema 2.0与证据校验，不需替换后端接口。缓存范围增加 `presentation: prototype-cards-v1`，避免复用旧长文。前端按标题匹配，不按位置把诊断冒充客群结论；无依据的维度保留待补资料。市场国家表直接使用当前店铺画像数据，全文及复查按需展开。

- 2026-09-16 积分触发约定：选择业务项只准备context或展示已有报告，禁止自动调用analysis。用户点击“开始分析（消耗积分）”或“重新分析（消耗积分）”才运行Workflow；按钮旁明确积分提示，不显示未经核实的扣费数字。问顾问发送前同样显示积分提示。此规则取代上一版点击业务即自动生成。

- 2026-09-16 Workflow→Chatflow连续交互：移除报告/问顾问页签。固定结果生成后，在同一区域底部显示“继续讨论”，发送时才调用Chatflow。使用已展示报告的snapshot_id（包括缓存报告），后端按该快照自动携带analysis_result和原业务事实；重新分析成功后清空旧对话会话，避免混用旧结果。未生成结果不展示聊天入口。

- 营销定位默认数据优先：进入页面及切换五项定位菜单仅显示当前店铺国家、关键词、商品等已读取资料，不打开分析结果或请求顾问context。用户点击资料区“开始分析（消耗积分）”后才准备分析并运行Workflow。生成后原资料保留为可展开依据，继续讨论沿用该结果。

- 市场与客群数据看板：`advisor-workflows.js` 的 `marketDashboard/loadMarket` 展示店铺国家、买家身份、来源渠道、搜索词四组近30天图表，以及行业国家/细分类目商机图、近90天全球需求场景表。身份来自customer-profile/byr_identity，渠道来自source；行业类目从当前shop-summary读取cateId，复用旧版market-country/categories/opportunities接口。行业与店铺口径分开，缺失数值不补零，读取失败在对应卡片提示；所有请求经AdvisorLive进入后续分析快照，ready等待级联读取结束。固定高度内部滚动，不自动分析。

### 公司定位资料面板（2026-09-17）
营销定位通过现有只读 `/api/workspaces/storefront` 读取 `companyProfile`，由 `advisor-workflows.js` 的 `loadCompany/companyDashboard` 展示企业基础、生产研发、市场占比、定制、证书、交付结算、产品分组及实景素材。公司填报市场份额与访客画像分开；区间规模不转换为虚构评分。国家语言选项库不是企业服务覆盖。证书为上传记录，PDF 显示文档入口，不能认定认证有效性。右侧固定高度内滚动；现有明确积分分析按钮保持不变。

- 产品定位真实看板：`loadProductPosition/productDashboard` 复用 `/api/dashboard/product-analysis`，展示商品样本、搜索曝光/点击/加权点击率、平台分层、曝光点击率四组、询盘与曝光 TOP6、企业资料里的产品系列及待关注数量。自然日/月口径复用 productPeriod；其他区间单独展示上个完整月并标注。分页不完整明确按返回样本统计；成本利润缺失不自动认定利润款。固定高度内部滚动，付费分析仍须点击按钮。
- 产品定位展示修订：默认数据面板不展示流量表现分组/四象限及其阈值说明；保留商品分层、基础指标和排名。

### 营销定位双栏布局（2026-09-17）
顶部 `wf-position-tabs` 横排五项定位；左侧 `wfPositionBody` 常驻资料，占约65%，右侧 `wfPositionAI` 独立承载 Workflow 报告和 Chatflow 继续讨论。`advisor-services.js/ensureDrawer` 在定位页仅替换右栏占位，不再把左侧资料折叠进报告。切换页签不触发分析；仍需右侧明确积分按钮。异步资料重绘后由 decorate 恢复已选结果，左右独立滚动。

### 装修文案资料可视化（2026-09-17）
`decorationDashboard` 复用 storefront/companyProfile 的真实资料，店铺文案展示品牌、图片分类数量、系列导航、20件商品素材、证书、企业介绍/服务及实景；详情文案可从20件参考商品切换主图、现有标题、价格、MOQ，并展示公司公共素材。数据接口未含所选商品规格/属性/商详全文，保留原产品编辑工作区入口；未返回装修页面版本时不伪造预览。`AdvisorPositionContext` 将用户所选商品作为显式分析事实，缓存/会话按商品区分，切换商品不调用模型。页面继续左右独立滚动。

### 运营基建流程与词工具（2026-09-17）
前三步分别进入一键选品、整理关键词、批量标题的右侧报告准备态，步骤高亮由 keywordTools.step 管理，付费生成须明确点击；第四步直接路由原产品发布。关键词区改为买家搜索词/行业场景热词/广告关键词三来源；类目从当前 shop-summary 读取，行业词使用 market-opportunities 全球近90天场景，广告词沿用旧词工具的 ads-keywords 业务线110102001、当前类目和100条分页查询。keywordTableData 共用显示和导出，不能把场景需求指数当单词搜索量，也不能把广告指数当实际次数。三来源事实经 AdvisorLive 纳入分析。

- 运营基建词表布局：`keywordToolBody` 通过 `data-keyword-kind` 区分三个来源，固定列宽并使用带全文 title 的省略文本。三种来源均保留舒展行距、按视口限制在180–380px的表格纵向滚动区，预留底部分页位置，不强求一屏放完；原始值仍由 `keywordTableData` 提供给导出。
- 三种词表的关键词使用 `keywordCell` 渲染复制按钮，`copyKeyword` 在用户点击后写入完整原文并提供状态提示；非关键词数值列不参与复制。

- 2026-09-17：运营基建行业词保留所有返回国家/地区维度，每次请求10条场景并展开热门词；广告词每页20条。`loadKeywordPage`维护来源独立页码、加载状态及版本保护，返回不足页容量停止翻页，空下一页保留当前内容。复制仍为完整关键词，导出针对当前接口页。
- 顶栏积分按用户确认暂用Demo余额10,000并明确标识“演示”，不代表真实账户、不模拟实际扣费；后续需接入自有积分系统。当前Workflow和Chatflow仍直连配置的Dify服务。

### 运营规划固定规则（2026-09-17）
`advisor-workflows.js/planRules`为纯函数：从选定日期内最新shop-summary记录生成最多三个关注方向，同记录同行字段对标；曝光与访客归为一组、接待归为一组，低于均值优先。比率须有效分母、缺项不补零、回复时长越低越好。输出只标差距和查看方向，日指标与30天滚动指标明确分开，不冒充周期汇总。`loadPlanDirections`使用导航版本保护；`AdvisorPlanContext`向用户主动打开的规划分析提供派生依据，不自动运行模型。页面首先展示免费规则卡片，原有规划模板仍在下方。
- 2026-09-18规则v2：关注点最高390px，可展开查看两条排查建议及组合信号；加入5分钟回复率、搜索曝光×CTR、访客×商机转化、回复覆盖×时长与同类目连续3日观察。连续性必须连续自然日，不跨缺日；全部为浅层排查方向，无自动付费分析。
- 规则v3增加allItems及未判断项，默认三个分组代表、可展开全部；排序为状态和相对差距，不代表风险评分。loadPlanDirections并行读取经营、商品分析、直通车/全站推报表，商品保留独立自然月/日口径。连续14日拆为两个7日窗口；缺报、缺分母、缺对标与长期数据不足明确不判断，不补零。

## 2026-09-18：营销定位一键交给 Accio Work

- 已保存旧版 Git 标签 `dify-own-credits-version`（84fd62b）：自有积分 Demo + Dify Workflow/Chatflow。当前迁移范围为营销定位的五项分析按钮，其他业务页仍保留原分析链路，不能称为全站已迁移。
- `AdvisorPositionExport(index)` 直接复制当前定位模块状态，按市场/公司/产品/装修主题选择数据；保留来源、实际周期、错误与人工记录，阻止未就绪或页面不匹配的数据交接。图表之外同批已返回记录也保留，不限于TOP6。
- `POST /api/advisor/aw-handoff` → `lib/aw-handoff.js`：保存账号隔离的本机 JSON（`~/.lsou/analysis-handoffs/<scope hash>/<uuid>.json`，文件0600），通过操作系统打开 `accio://chat/new?query=...`，让AW新对话读取该快照分析。消息只携带文件路径与分析要求，不把业务数据塞入URL；文件保留供后续对话引用，目前不自动清理。
- 当前使用AW本机文件读取能力，无需新增MCP或用户下载上传。不调用Dify、不调用自有积分；OS唤起成功只标记请求已提交，不假报模型已完成。模型结果与追问在AW中，不能回写本页报告或追加已有对话。
- 本机macOS、Accio0.32.6已实测协议自动发送及实际JSON读取；Windows/Linux唤起分支和正式Tauri交付包尚未实机验证。后端运行的本机须与AW相同。

## 2026-09-18：撤下 Workflow / Chatflow 占位侧栏

- 运营规划至商机转化不再生成 `avWorkflowPanel`，营销定位不再生成 `wfPositionAI`；业务页使用全宽数据区，保留固定高度与内部滚动。旧Dify实现暂存但不再从已撤下的卡片入口触发。
- 营销定位的AW入口移到横向定位菜单下的紧凑工具条 `wfPositionHandoff`，五个主题仍按当前数据交接。其他页面尚未接入AW，不再添加会指向空侧栏的分析按钮。

- 运营基建词表布局（2026-09-18）：`.wf-foundation`通过`--keyword-card-height`统一左卡与右侧两卡总高度；`#wfKeywordTable`为flex布局，只有表格区滚动，分页固定留在底部。三个词表切换不改变高度，行距保持不变。

- 经营关注点（2026-09-18）：桌面三列排列，窄屏单列；“未判断的指标”不再渲染，但规则结果仍保留skipped用于数据边界，不改成零或强行判断。

- 经营关注点最新展示约定：仅显示三个重点，不再提供“查看全部”入口；三列卡片同排等高，原完整规则数据保留。

- 运营规划不再展示经营目标填写和店铺阶段占位；该数据条只保留三项已返回数据计数，等宽排列。

- 日期选择现在由`periodDialog()`创建`#avDatePopover`，作为按钮锚定的非模态下拉；实际dialog共用`html body dialog:modal`居中规则，新增弹窗勿再清除auto margin。周期校验与应用后重新读取逻辑保留。

- 2026-09-18：新版 advisor-design 日期下拉沿用公共 TimePolicy：日/完整ISO周/自然月独立输入，禁止未结束周期；商品分析及优爆品页仅指定日/月并校验近90天月初，跨页继承非法商品周期时恢复上个完整月。访客仍严格最长1个月；不再把自由区间覆盖成 range，也不把所有工具一律限制近90天/31天。

- 2026-09-18 运营推广：`public/advisor-analytics.js` 的 mountAds 承载账户资金/流水、行业基准、四类计划、详情及主动建议。`lib/advertising.js` 新增 detail、plan-diagnosis、explanation，report支持可选计划id；详情跟随固定白名单和真实计划导航，不开放投放写操作。报表company_*与campaign_*分口径，临时报表名独立。WorkCTL0.1.58全站推屏蔽词导航和实际能力不一致，后者只支持标准推广；错误应保留不能当空表。实机验收与正式交付分开记录。

- 2026-09-18：顶栏公司名及Logo通过 /api/workspaces/identity 精简读取（loadCompanyIdentity），复用公司资料工具；不等待店铺装修附加查询。advisor-design 的 loadIdentity 维护单个并发读取，切页保留顶栏，公司Logo仅允许HTTPS，缺失/失败使用店铺图标。页面标题旁重复店铺占位已移除。

- 2026-09-18：全局 #avMastPeriod 位于品牌右侧，navigate按当前页面重绘合法时间粒度；产品发布清空周期控件。积分Demo已从顶栏移除，刷新位于最右。各顾问页面标题区改为紧凑单行、隐藏面包屑；日期浮层继续锚定当前周期按钮。
- 2026-09-18：全局顶栏帮助中心及通知占位入口已移除，不再生成对应按钮。
- 顶栏位置最新调整（2026-09-18）：品牌 → 公司头像/名称 → 右侧日周月与日期 → 刷新；取代此前日期位于品牌右侧的布局。
- 顶栏公司全名现直接完整展示，可用空间不足时换行，不再截断省略。
- 2026-09-18：顾问各页顶部重复页名/说明整行已移除；页面由左侧当前导航标识。历史规划保留在经营关注点卡片标题右侧，日期保留全局顶栏。

- 产品发布切页隐藏约定（2026-09-18）：`#advisorDesign[hidden]` 必须优先于各固定高度工作区的 `display:flex`，否则旧顾问页面会重新显示并挤压发布编辑器；保留旧DOM不代表允许显示。

- 商机转化首屏（2026-09-18）：visitor模板先渲染国家画像、买家等级与RFQ三列等高360px卡片，内容卡内滚动；访客询盘筛选/明细置于下方。买家等级仍明确为当前页访客口径。

- 商机页下方通过`av-rfq-dock`挂载唯一`tab-rfq`，沿用`LsouRfq.load`及原控件事件；RFQ入口只滚动到`av-rfq-workspace`。navigate必须先调用AdvisorRestoreRfq归还节点，再重绘，避免删除已有绑定。异步RFQ查询按版本拒绝旧响应。

- 数据分析与优化页：移除诊断依据/执行清单占位，商品当前周期详情放右侧`aa-product-detail`，点击查看详情更新七项双列指标；优爆品页详情位置保留。

- 优爆品提升：移除历史趋势、跟进动作占位；详情默认收起，点击查看详情在该商品下一行展开，同一时间一项，再点收起。取代旧版列表下方独立详情卡。

- 商机画像最新布局：国家分布及买家等级合并为一个访客买家画像卡片，两个饼图并排，RFQ在右侧等高；国家前五加其他国家，等级仍为当前页样本。

- RFQ商机池在商机转化挂载后自动使用店铺搜索词加载（保留已输入关键词），并自动读取当前首条详情；两个RFQ按钮仅滚动，不再承担加载动作。

### 2026-09-18 持久执行任务
- `lib/planning-tasks.js` 提供 `/api/advisor/tasks` POST（list/generate/add/edit/complete/move/delete/restore/cancel）。数据放在 `~/.lsou/planning-tasks/<账号哈希>/tasks.json`，请求子目录保存 input.json、固定Skill副本和 result.json；独立于插件代码目录升级。
- 最近请求编号保存在latest，新生成将现有最近任务转历史；允许人工移回。结果只导入一次，不覆盖已有任务。关闭后再次list补读待处理请求。人工CRUD有revision校验，删除进入回收站。
- `public/planning-tasks.js` 挂载共享任务卡，4秒轮询结果；生成直接交接，不弹窗，编辑使用页内表单。绑定 `plugin/skills/lsou-planning-tasks/SKILL.md` v1，记录hash；桌面准备阶段复制Skills到后端资源。
- 当前单机本地保存，无跨设备同步；取消等待不取消Accio会话，只停止导入该请求。AI新增建议，既有任务编辑由用户完成。

- 执行任务UI最新约定：直接显示work（工作事项）、reason（为什么要做），操作仅完成/编辑，最近/历史页签保留。Skill lsou-planning-tasks v2 输出两字段；内部ID、完成状态、归档和修订字段只用于持久化，不作为用户表单。旧title/action/evidence仍可兼容，旧数据不删除。


### 2026-09-18 分析报告实际执行与持久回传（替代此前未接通状态）
- 当前分析目录由 `plugin/analysis-skills.json` 提供，`lib/analysis-runs.js` 读取31个 `html_report` 项并校验允许的入口页；任务另由 `lib/planning-tasks.js` 绑定 `lsou-planning-tasks`。广告诊断可从分析页和推广页进入，广告问答归推广页；历史按实际 `entry_page` 保存。
- `public/analysis-reports.js` 在各业务页挂载分析主题、补充问题、开始分析与报告历史；`public/advisor-services.js` 只保留现有按钮的适配。选择主题不生成。营销定位、基建流程、广告专用按钮、知识问答及单计划表单统一进入相应Skill。账户平台诊断/推荐仍可只读取资料；知识问答和单计划生成不再绕开Skill。原旧接口仅兼容，不代表当前入口使用它们。
- 正式React脚本表与原生HTML入口均加载 `analysis-reports.js`、`planning-tasks.js`。桌面准备同时复制Skills及 `analysis-skills.json`，否则打包后报告目录不可用。
- 点击时锁定日/周/月与起止日、资料版本、明确选定对象；等待 `AdvisorLive.ready()` 后保存全部已读取记录。期间切页、切周期或换对象则拒绝旧请求；`AdvisorLive.records()` 不再默默只取30条。各来源保留自己的统计范围，页面不支持的周粒度不能伪装为周数据。“当前”是点击时的选择，不是第四种模式。
- `lib/analysis-context.js` 共用完整日期/自然周/自然月校验及指标字典；关键词搜索热度指数与本店访客数不可混算。当前未结束周期可以保存，但Skill必须说明完整性与数据覆盖，不能按完整业绩判断。
- `POST /api/advisor/reports` 接受 `list/generate/read/cancel`。资料按账号哈希存于 `~/.lsou/analysis-runs/<账号哈希>/`；每请求固定保存 `input.json`、`skill/`及模板、模型 `report.html`，服务端验收后冻结为 `accepted.html`；`index.json` 保存状态、摘要和哈希。请求编号幂等，资料变化拒绝复用；同主题同周期未完成或无效结果须先取消再重发。取消仅停止本地接收，不终止宿主对话。
- 新分析先排除对应Skill版本已变化的旧报告，再带入同主题最近5份和其他主题最近8份报告摘要、原周期及本机历史原件位置，以及已有人工任务；历史是待核对参考，不能取代当前事实。规则更新前的报告仍可在历史查看，标明旧版分析，不自动复用其结论；历史按新到旧显示生成时间。全部历史原件仍保留，未实现跨设备同步。
- 模型原子写完整报告后，服务端轮询导入；不信任报告路径、符号链接或执行内容。静态结构及业务正文校验后注入禁止脚本和网络的内容策略，前端用无权限 `sandbox` 展示；下载保留内容策略。已验收历史不可被后续源文件悄悄覆盖，读取时验证哈希。
- 任务新增/编辑点击只委托具体按钮，避免根容器页签属性误触发重绘；人工修订、完成与历史保留。v2最多8条，标准化两列正文精确去重并保留编辑前指纹；不同对象/理由仍可新增。源材料只作建议，不自动改投放、商品或向客户发送内容。
- 本地验证：`npm test`、`npm run build:frontend`；Skill用官方 `quick_validate.py`。真实宿主测试必须同时检查固定Skill副本、输入快照、写回原件、存储导入与页面回显。合成数据/browser通过不能代替三平台正式Tauri安装包验收。本轮证据位于 `tmp/skill-repair-20260918/`，原失败证据保留在 `tmp/skill-acceptance-20260918-180015/`。

### 2026-09-18 1.0.10 三平台完整插件封装

- package/Cargo/Tauri/插件/MCP/前端版本统一1.0.10，buildRevision为20260918。release仅新增三个独立ZIP：macos-arm64、macos-x64、windows-x64；保留旧包，最新入口见README。每包35份Skill，其中32项分析/任务及3项启动辅助，31份报告模板与分析目录同时进入插件根目录和原生payload。
- 沿用Windows已修复的普通绝对资源目录、固定相对bootstrap参数、资源cwd、随包node.exe、原生脱敏错误日志、20秒内返回在途状态与受控停止机制。标准包无开发账号快照、示例商品、运行日志或内部测试密钥；配置和业务历史继续留在用户本机原目录。
- 按目标顺序构建，共享payload/runtime不并发覆盖；Windows使用已有cargo-xwin/LLVM/LLD和XWIN缓存，Mac完成adhoc签名核验，未做Apple公证。45项Node相关测试及9项Rust测试通过；Windows/Intel为原生编译与结构检查，未在目标机运行。
- Mac M芯片从打包stage的MCP入口验证加载后待命、主动启动、真实Tauri窗口、当前店铺数据、分析入口/任务模块、停止及后端端口关闭；没有重装用户Accio插件。build.json保持runtimeVerified=false，不将本机stage测试冒充三平台导入验收。用户明确排除Skill效果检验，本次未调用分析生成。证据在tmp/plugin-release-1.0.10/。

### 2026-09-18 Windows 1.0.11 分析对话唤起修复

- 用户Windows实机反馈：1.0.10窗口/资料保存正常，explorer.exe短链接复现退出码1且Accio未收到；PowerShell Start-Process对照能创建新对话。证据支持替换中继方式，不声称已查清Windows内部原因或验证完整业务链接。
- lib/aw-handoff.js的openAW在Windows通过固定PowerShell脚本调用Start-Process，完整URL放子进程专用环境变量，不插入脚本文本，不启用ExecutionPolicy绕过、不自动fallback/重试。Mac open及Linux xdg-open行为保持。
- launchErrorDetails只保留code/errno/signal/killed/stderrPresent及固定结构的HRESULT/Win32错误码；不记录URL、原始异常正文、路径或凭据。报告、任务和兼容定位交接均记录请求号与此诊断；界面错误不再一律归因未登录。
- 本次只交付1.0.11 Windows x64，Mac继续1.0.10。版本与原生程序同步重建，buildRevision=20260918-win-protocol-r1。198项工程测试197通过、0失败、1项原有可选发布测试跳过；ZIP结构/CRC/清洁检查与151个payload文件一致性通过。未发起实际协议/Skill效果测试，Windows新包的完整链接投递仍待目标机确认，runtimeVerified=false。

### 2026-09-18 1.0.11 更新准备与插件退出

- `plugin/scripts/desktop-mcp.cjs` 新增 `lsou_plugin_prepare_update / lsou_plugin_cancel_update / lsou_plugin_shutdown`。更新准备阻止启动和恢复，复用已有停止等待；整体退出先确认所属窗口退出、返回回执，再结束当前连接。失败保留连接供排障，不删除配置或历史，不结束其他连接或独立窗口。
- `preparingUpdate` 只属于当前连接；`shutdownScheduled` 是即将退出的回执，不能当作宿主全局停用。诊断独立进程标记 `pluginConnection=standalone_diagnostic`。宿主可能重新连接，文件占用时完全退出 Accio（Windows 包括托盘）后再打开导入。
- 启动页新增停止/更新按钮，启动与排障 Skill 按用户意图路由。面向用户不输出工具名，不为验证更新运行分析。停止状态不当作需要自动修复的错误。
- 只读核对当前 Accio 0.32.6 的导入源码：标准ZIP会解压到按插件ID确定的固定来源，已有local-directory来源一致时允许再次导入；不同来源仍可能冲突。旧全局插件toggle已退役，未调用它或写插件注册表。当前没有自动下载更新功能，源码检查不等于Windows覆盖导入实测。
- 本次Windows包保持1.0.11，构建标识20260918-update-r2，文件名增加update-r2以保留原包；打包脚本可用`--revision`选择安全修订名。Mac共用源码已更新，既有Mac 1.0.10交付包不变。相关21项工程检查通过，2份Skill静态验证通过，无Skill效果测试。
- 修订ZIP的结构、CRC、35份Skill及151个payload文件一致性检查通过，原包保留。工程和构建证据在tmp/plugin-release-1.0.11-update-r2/，Windows实机导入更新仍未验证；当前未修改用户的已安装插件。

### 2026-09-18 本地正式发布管理基线

- 用户确认当前Windows可用、Mac正常，选择先管理本地版本、校验、三平台包和更新记录。`release-manifest.json`记录Windows1.0.11/update-r2与Mac两种架构1.0.10的实际SHA256，三个基线包未重打。Mac反馈未指明芯片，不据此新增Intel实机验收结论。
- 读取当前Accio Work0.32.6及内置plugin-create1.0.3规范，版本独立于宿主；validate-plugin.cjs与当前官方验证器逐字节相同。不新增未知宿主兼容字段，不修改安装记录。
- `scripts/manage-release.mjs`提供check/version/publish/prune。同步package/lock/插件/Tauri/Cargo/MCP/前端版本；拒绝同版重发、降级、文件名后缀替代版本。登记要求三平台同版本同源码，自动更新README入口。构建记录sourceDigest，打包和登记均检查，避免过期构建混入。
- ZIP和校验文件排他创建；临时展开目录移至.build-cache/package-stage。发布元数据进入Git，release只放交付包。后续正式版本必须高于1.0.11；本次不自行升级当前已确认基线。
- 删除23个旧ZIP、23个校验文件和5项重复展开/验证产物；保留三包与3份校验文件。清理和工程证据在tmp/release-management/。未重装用户插件、上传市场或运行分析。

### 2026-09-18 GitHub 源码仓库整理

- 用户指定远端为 `https://github.com/wmWW-G/l-souPlugin`，默认分支 `main`。清理前远端为 2026-09-03 的 `7f71ced709d8baa05df66e215ac959baf7575532`，仅一个分支，无标签或 Releases；本机源码仓库仍独立保留既有历史。
- 通过 `.build-cache/remote-cleanup-source` 中的远端克隆整理、提交和推送，沿用远端历史，不重写提交。同步当前源码、35 份 Skill、工程测试及发布记录；仅移除根目录 `design-*` 材料、`design-pages/`、`design-audit-2026-09-03/` 的 95 个旧设计文件，本地原件保留。
- `.gitignore` 固定忽略旧设计材料；README 聚焦当前安装、开发、结构、分析及发布流程。发布登记只列本地包名，不生成 GitHub 上不存在的 ZIP 下载链接。历史细节继续保存在本文件及开发日志。
- ZIP、构建缓存、业务记录、密钥和日志不上传。后续维护先读取最新 main，使用正常提交与推送并核对远端 SHA；不强推覆盖历史。
- 用户随后要求直接提交并推送：本机仓库配置 `origin=git@github-b:wmWW-G/l-souPlugin.git`，仅此仓库使用 SSH 443 连接。核对远端 `ffc1467` 的227个文件后连接双方既有历史，保留当前源码；后续直接在项目根目录的 `main` 提交、推送，不再通过独立清理克隆发布。95份设计资料和5份生成schema仅从版本管理移除，本地原件保留。

### 2026-09-18 Skill 短消息与本地回传规则

- 用户要求按钮消息仅保留 Skill Name 和必要输入参数。31 份报告及执行任务统一调用 `skillRequestMessage(skillName, period, requestRef)`，按用户最新要求输出普通英文指令 `Use <skill-name> skill; period=day|week|month; dates=start..end; request=scope/id`，不使用美元符号；不再发送长规则或绝对文件路径。账号隔离段沿用现有 scope 的20位哈希，任务编号沿用独立请求。
- 32 份业务 Skill 新增“工作台请求与本地回传”：按系统用户主目录和任务参数精确定位 `.lsou/analysis-runs/` 或 `.lsou/planning-tasks/` 的请求，读取 input.json 并核对身份、周期、固定技能副本和输出路径；不扫描账号或猜最新任务。原日/周/月尺度与各主题业务方法保留。
- 报告快照增加 request_ref；任务快照增加 schema_version=lsou.planning-run.v1、request_ref、result_path，完整技能副本统一保存在请求的 skill/。旧在途请求及历史导入机制不迁移、不删除；新消息与新技能随同一新版交付。
- 临时文件写完并关闭后，在同目录原子重命名为 report.html/result.json，再回读；固定回传格式、路径边界、任务去重和人工状态保护写入对应 Skill。报告或任务本身才是回传产物，聊天只给简短完成说明。
- 27 项定向工程检查通过，包含31报告入口、任务日/周/月参数定位、原子回传、历史恢复和 Windows 协议回归；32份 Skill 格式检查通过。没有发送真实分析、运行模型效果测试、重打包、重装或推送远端。

- 英文命令统一：启动页五个按钮也发送 `Use ... skill; action=...`，启动/状态/停止/更新由启动Skill显式路由，排障使用 diagnose-and-recover 且保留一次恢复上限。旧定位兼容接口使用 `Use ... skill; input=<snapshot>`。仅发送指令改为英文，Skill内的方法、中文报告与界面文案沿用原约定。
