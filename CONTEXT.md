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
2. `public/app.js` 请求本地 `/api/q/<endpoint>`、`/api/dashboard/product-analysis`、`/api/demo`、`/api/endpoints`、`/api/log` 或 `/api/cache/clear`；产品发布页先用 `GET /api/publish/account-context` 从当前账号商品自动取得内部类目，再用 `GET /api/publish/category-schema` 读取该类目的属性和官方选项，`GET /api/publish/categories` 只用于用户主动搜索更换类目，`GET /api/publish/upload-capability` 检查图片服务，`POST /api/publish/images` 上传新图片，`POST /api/publish/reference` 导入参考商品，`GET /api/publish/jobs` 读取队列，并在最终确认后用 `POST /api/publish/enqueue` 写入队列。
3. `server.js` 用 `ENDPOINTS` 校验只读端点和允许参数，把 camelCase 业务字段转换为 Workctl schema 要求的 kebab-case 参数；发布写路由不复用该白名单，而是单独执行同源 JSON、确认短语、幂等键、服务端字段复核和批量上限检查。
4. Workctl 返回 JSON 后，服务端解析并缓存 5 分钟，再由前端渲染 6 项核心 KPI、经营链路、趋势、数据驱动待办、渠道/国家/商品诊断摘要，以及各业务详情页。RFQ 数据会在服务端移除买家姓名、账号、跳转链接和报价正文后再进入浏览器。

## 关键模块与状态

- `server.js`：定义 `ENDPOINTS` 只读白名单、参数构造、Workctl 执行、JSON 解析、缓存、命令日志、REST API 和静态文件服务；产品发布部分先通过 `data-advisor-shop-product` 分页读取当前账号已有商品与其 `categoryId`，对浏览器只保留标题、缩略图和类目，再通过 `list-user-category`、`list-attribute`、`list-attribute-options` 生成对应类目表单。参考商品使用 `publishflow query-template-info-by-id`，本地图片使用 `icbu other upload-file`，写入侧维护进程内串行队列，通过临时 0600 JSON 文件调用 `publishflow publish-from-json`。material 使用平台 `categoryId + basicInfo / trade / fulfillment / detail` 嵌套结构；完整商品素材、上传 bucket、失败补全路径都不会进入浏览器响应。
- `start.sh`：从 Accio 本地 `/health` 识别活动 space，从账号 runtime 文件仅向进程环境注入 gateway 凭据，根据当前插件清单定位 Workctl，并在启动服务前完成健康与 schema 预检。
- `public/app.js`：定义页面数据请求和交互；主要状态包括经营汇总 `summaryRows`、当前 KPI `curKpi`、商品分页排序 `pState`、完整商品分析 `productAnalysisData`、流量数据 `flowRaw`、地域排行 `regionRows`、访客分页 `vState`、RFQ 商机池 `rfqState`、产品发布本地素材与真实队列快照 `publishState`、控制台端点 `EPS` 和标签页加载状态 `LOADED`。客户页联合读取访客行为、店铺回复质量和买家画像；商品页对 378 条商品效果记录计算曝光 × 点击率四象限；流量页合并渠道、国家、画像、搜索词和市场机会；关键词广告页在一页中区分店铺词库、可售资源和投放效果空状态；RFQ 页实时联合站内、站外、详情与报价历史，并在权益慢接口不可用时明确回退到最近审计快照。产品发布页把当前账号全部商品去重后的实际类目放进顶部业务名称下拉，选择后只更新当前编辑商品，并以内部 `categoryId` 实时重建右侧参数；右侧搜索仍可覆盖账号历史之外的全部官方叶子类目。草稿和正式发布都进入服务端并发 1 的真实 WorkCTL 队列；同一次操作用 operationId 分组，页面显示单品 0/1 或批量 0/N 总进度、编号节点和终态结果弹窗。订单物流、风险、装修、素材、知识和账号页面继续通过 `MODULE_LIVE_DEMO` 展示脱敏审计快照。
- `public/index.html`：定义左侧业务信息架构与右侧行动优先工作区。侧边栏名称、分组和顺序是当前产品设计基线；“市场机会”内容按用户要求并入“流量分析”，不再单列入口。“运营待办”保留现状，后续只读取 Dify 的结构化输出。
- `public/style.css`：负责来搜品牌浅色工作台、220 px 桌面固定边栏、68 px 收起态、窄屏横向导航、结果数据带、行动清单、诊断摘要、表格、图表、弹窗、日志和响应式布局。桌面端产品发布页使用固定窗口工作区：顶部状态与紧凑进度、底部批量操作保持可见，左右两张卡片独立纵向滚动。
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
- 用户已明确授权的“上传发品图片 / 保存产品草稿 / 提交产品发布”是当前开放的写能力；改价、修改广告、发送消息、删除、保存策略或消耗额度仍不得加入当前面板。图片上传所需 bucket、endpoint 和路径前缀只能由管理员通过 `PUBLISH_IMAGE_BUCKET`、`PUBLISH_IMAGE_ENDPOINT`、`PUBLISH_IMAGE_PATH_PREFIX` 配置，页面不提供也不返回这些内部参数。
- 产品发布写接口必须只接受同源 `application/json`，要求确认短语和长度合格的幂等键，并在服务端重新校验字段。队列通过 `publish-from-json` 获得质量分、字段修正和结构化失败结果；单品逐条执行时由服务端维持至少 1 秒提交间隔，失败不会自动重试，用户修改资料并再次确认后才生成新的写任务。队列状态区分 `queued`、`running`、`saved_draft`、`submitted` 和 `failed`；`submitted` 只表示已经提交平台流程，不等于审核通过或商品在线。同一请求内所有任务共享 `operationId`，并有从 1 开始的 `position` 与 `total`，前端据此计算总进度和结果汇总。WorkCTL 返回的 `itemJsonPath` 只保留在服务进程内用于排障，页面只显示“图片、属性、价格、包装”等业务区域。
- 产品图片分两类：Demo 或已有商品的远程 HTTP(S) 图片可直接进入队列；用户新选的 JPG、PNG、WEBP 图片会先在浏览器预览，再由服务端校验图片签名和 8MB 上限并通过 `icbu other upload-file` 转成远程 URL。没有配置 `PUBLISH_IMAGE_BUCKET` 时，工作台仍可启动，但新增上传入口会禁用并明确提示。右侧不再从写死的智能手表配置起步：页面会先读取当前账号全部商品的类目分布，能匹配同款缩略图时使用该商品类目，其余素材使用账号已在用的同类目或主营默认类目，然后再按内部 `categoryId` 实时取得属性与官方选项。用户只看业务名称，系统内部维护编码；固定单选会提交 WorkCTL 返回的正整数 `attrValueId`，服务端入队前再次按实时 Schema 检查类目归属、必填项和 ID/文字配对。参考商品导入只带入类目、标题和文本，固定属性仍按当前账号的实时 Schema 重新生成。计价单位和运费方案同样不要求用户填写内部 ID：`GET /api/publish/business-options` 复用当前账号商品目录并结合少量 `product_query_information` 结果读取店铺实际使用值，前端只显示业务名称，服务端在入队前自动匹配并复核；没有可读取运费方案时省略可选字段并沿用国际站账号默认设置。2026-09-03 的首次真实草稿因旧扁平 material 结构被拒绝；改成 `categoryId + basicInfo / trade / fulfillment / detail` 嵌套结构后，用户再次确认的同一商品真实草稿已返回 `saved_draft` 并保存到国际站草稿箱。
- 真实队列当前保存在 Node 服务进程内，服务重启后不恢复；队列不保存完整素材到磁盘。若要支持跨重启续跑，需要另行设计加密持久化、任务对账和远端状态恢复。
- 标准入口必须使用 `./start.sh`，不要依赖 `server.js` 中兼容保留的历史默认路径。脚本会用当前活动 space 的真实二进制覆盖 `WORKCTL_BIN`。
- 从普通终端或 Codex 启动时，不再手工复制 gateway URL 和 token；`start.sh` 会临时注入服务进程环境。Accio 在服务运行期间重启后，需要重新运行脚本以更新凭据。

## 常见修改位置

- 增加或调整只读数据端点：修改 `server.js` 的 `ENDPOINTS`，并同步检查参数白名单和前端调用。
- 调整字段解析、筛选、分页、排序或图表：修改 `public/app.js`。
- 调整商品四象限：同时检查 `server.js` 的 `getProductAnalysis()` 和 `public/app.js` 的 `renderProductAnalysis()`；商品分页并发上限为 4，避免拖慢同一网关的其他页面。
- 调整产品发布矩阵、字段编辑或真实队列：前端修改 `public/index.html`、`public/style.css` 和 `public/app.js` 中的 `PUBLISH_CATEGORY_CONFIG` / `registerLivePublishCategory()` / `publishState` / `renderPublish*` / `startPublishQueue()`；后端修改 `server.js` 的 `loadPublishCategories()`、`loadPublishCategorySchema()`、`validatePublishProductSchema()`、`normalizePublishProduct()`、`enqueuePublishJobs()` 和 `processPublishQueue()`。不要再手工增加新类目；页面应通过实时搜索和 Schema 注册自动适配。
- 调整总览待办规则：修改 `public/app.js` 的 `renderActionItems()`；必须继续只从真实返回字段推导，不能补写无法核验的任务数量、负责人或业务影响。
- 把脱敏审计快照升级为实时页面：先在 `server.js` 接入并核验对应只读端点，再把 `MODULE_LIVE_DEMO` 的静态快照替换成前端请求和明确的加载/错误状态；写操作继续保持禁用。
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
