# workctl 经营数据面板

本地前后端可视化面板。每一次点击、排序、筛选、下钻都会真实执行一条 `workctl` 命令,
页面上所有数字均由 workctl 返回,不含任何 mock 数据。

## 启动

```bash
cd /Users/garden/YD/ReverseAccio/lsou-plugin-project
./start.sh
# 打开 http://127.0.0.1:8787
```

`start.sh` 是标准启动入口。它每次都会从 Accio Desktop 的本地健康状态识别当前
活动 space，读取当前账号的 runtime 凭据和已安装 Workctl 版本，依次预检网关认证
和 `icbu advisor` schema，全部通过后才启动页面。token 只进入当前服务进程环境，
不会写入本项目、日志或浏览器代码。

改端口：`PORT=9000 ./start.sh`。只有调用方已经自行提供当前有效的
`ACCIO_GATEWAY_TOKEN`、`ACCIO_LOCAL_GATEWAY_URL` 和 `WORKCTL_BIN` 时，才应绕过
启动预检直接执行 `node server.js`。

启动前必须先打开并登录 Accio Desktop。若 Accio 已退出、切换账号、插件未安装或
动态命令未注册，脚本会直接给出具体错误并停止，不会启动一个表面可访问但无法取数
的页面。Accio 在服务运行期间重启后，请重新执行 `./start.sh` 获取新的运行态凭据。

## 架构

```
浏览器  ──GET /api/q/{endpoint}?flags──────▶  Node HTTP 服务 ──▶ WorkCTL 只读查询
       ├─GET /api/publish/categories───────▶  当前账号叶子类目搜索
       ├─GET /api/publish/category-schema─▶  类目属性 + 官方选项 ID
       ├─POST /api/publish/reference──────▶  参考商品标题、类目与文本
       ├─POST /api/publish/images─────────▶  图片校验 + 远程上传
       └─POST /api/publish/enqueue────────▶  确认/校验/幂等 ──▶ publish-from-json
```

- **后端** `server.js`,零依赖,仅用 Node 内置 `http` / `child_process`
- **前端** `public/`,零依赖,图表为手写 SVG
- **品牌视觉** 使用来搜官网的白色、暖米色和 `#ff6600` 品牌橙；桌面端采用 220 px 左侧业务边栏 + 右侧行动优先工作区，窄屏自动切换为顶部横向导航；方形 Logo 位于 `public/assets/`
- **经营总览** 首屏只保留 6 项核心结果，把真实的曝光→点击→访问→商机→询盘→成交链路、每日趋势、3 项数据驱动待办，以及渠道/国家/商品摘要放在同一屏；尚未接入的数据能力统一标注“规划中”
- **设计验收** `design-qa.md` 记录官网参考、桌面/窄屏截图、交互检查和迭代结论

## 已接入的只读 WorkCTL 端点

| API | workctl 命令 | 面板 |
|---|---|---|
| `shop-summary` | `icbu advisor data-advisor-shop-summary` | 经营大盘 |
| `shop-product` | `icbu advisor data-advisor-shop-product` | 商品效果 |
| `shop-region` | `icbu advisor data-advisor-shop-region` | 地域分布 |
| `shop-flow` | `icbu advisor data-advisor-shop-flow` | 流量渠道 |
| `shop-channel` | `icbu advisor data-advisor-shop-channel` | 控制台 |
| `visitor-detail` | `icbu advisor data-advisor-visitor-detail` | 访客明细 |
| `account-summary` | `icbu advisor data-advisor-account-summary` | 员工绩效 |
| `flow-profile` | `icbu advisor data-advisor-shop-flow-profile` | 控制台 |
| `customer-profile` | `icbu advisor data-advisor-shop-customer-profile` | 控制台 |

## 交互 → 实际执行的命令

| 你的操作 | 触发的真实调用 |
|---|---|
| 切换日期 / 快捷区间 | 当前面板带新 `--start-date --end-date` 重查 |
| 点 KPI 卡片 | 本地切换指标重绘(复用同一份 summary 数据) |
| 点总览中的真实待办 | 跳转商品运营或客户与询盘，继续查看明细 |
| 点“规划中”模块 | 只提示能力边界，不展示模拟数字，也不会执行写操作 |
| 收起左侧菜单 | 切换为 68 px 图标栏，右侧图表自动按新宽度重绘 |
| 点趋势图数据点 | 弹出该日全量字段 |
| 点商品表头排序 | `--order-by <field> --order-model ASC/DESC` 重新查询 |
| 商品分层 / 有效果品 / P4P 筛选 | `--prod-level --has-effect Y --p4p-prod Y` |
| 商品翻页 | `--page-no N --page-size 20` |
| 点地域条形图的国家 | 跳转访客面板并执行 `--buyer-country <国家>` |
| 点流量渠道条 | 展开该渠道子渠道拆解 |
| 访客 TM / 询盘过滤 | `--is-atm-fb --is-mc-fb` |
| 命令控制台执行 | 任意白名单端点 + 自定义 flag,绕过缓存 |
| 搜索或切换发品类目 | 实时读取当前账号 `list-user-category`，再按类目读取 `list-attribute` 与 `list-attribute-options` |
| 导入参考商品 | 粘贴 Alibaba 商品链接，调用 `publishflow query-template-info-by-id` 带入标题、类目和可用文本；固定属性仍按当前账号 Schema 生成 |
| 上传商品图片 | 校验 JPG/PNG/WEBP 与 8MB 上限后，调用 `icbu other upload-file` 转成远程 URL；存储参数由管理员配置 |
| 保存当前草稿 | 二次确认后把当前商品加入真实队列，调用 `publishflow publish-from-json --publish_type draft` |
| 发布当前商品 | 完整校验与二次确认后，把当前商品加入真实队列，调用 `publishflow publish-from-json --publish_type product` |
| 批量保存草稿 / 批量发布 | 只处理左侧勾选项，服务端按并发 1、相邻提交至少间隔 1 秒逐条执行 |
| 查看本次进度 | 单品显示 `0/1 → 1/1`；批量显示 `0/N → N/N` 和 1…N 节点，全部结束后自动弹出成功/失败结果 |

## 安全边界

- 查询端点白名单硬编码在 `server.js` 的 `ENDPOINTS`,前端无法执行任意命令
- 参数经 `flags` 白名单过滤后以 `execFile` 数组形式传入,不经 shell,无注入风险
- 页面使用 camelCase 业务字段，后端在执行前转换为 Workctl schema 要求的 kebab-case 参数
- 发品图片上传、产品草稿与发布是已授权的写能力，使用独立 POST 路由、同源 JSON、确认短语、幂等键、批量上限和服务端字段复核；改价、投放、发消息、删除等其他写操作仍未接入
- 完整商品素材只进入权限为 0600 的临时参数文件，执行后立即删除；命令日志和浏览器响应不包含完整素材或 Accio 凭据
- `material` 内部严格使用 Alibaba 发品规范的 `categoryId + basicInfo / trade / fulfillment / detail` 四块结构，不再发送项目自造的扁平 JSON
- 类目和 PRODUCT 属性来自当前登录账号；固定单选携带 WorkCTL 返回的正整数 `attrValueId`，服务端入队前再次检查类目归属、必填属性和 ID/文字配对
- `publish-from-json` 返回的质量分、扣分原因和失败补全路径会被转换为页面业务提示；失败不会自动重试，用户修改资料并再次确认后才产生新任务
- 图片存储的 bucket、endpoint 和路径前缀只允许通过服务端环境变量配置，页面不会要求普通用户填写或返回这些参数
- 服务仅监听 `127.0.0.1`

## 发品图片配置

参考商品导入和现有远程图片无需额外配置。若要让用户从电脑选择新图片，需要由
管理员在启动时提供存储参数：

```bash
PUBLISH_IMAGE_BUCKET="你的存储桶名称" \
PUBLISH_IMAGE_ENDPOINT="可选的存储端点" \
PUBLISH_IMAGE_PATH_PREFIX="lsou-product-publish" \
./start.sh
```

这些值只进入 Node 服务进程，不会发送到浏览器。未配置 bucket 时工作台仍可正常
读取数据和发布已有远程图片，但新增图片按钮会禁用并显示原因。

## 注意

- 访客明细接口最长支持 1 个月窗口,前端会自动把区间收敛到结束日前 30 天
- 商品效果接口不接受日期参数,返回的是平台默认统计口径
- 相同命令 5 分钟内走缓存,日志中标记 `CACHE`;控制台执行始终为 `LIVE`
- `GET /api/health` 会检查服务与当前 Workctl 认证状态；`ready` 表示可以取数，`degraded` 表示需要重新运行 `./start.sh`
- 用户新选图片会先在浏览器预览，再上传并替换为远程 URL；如果管理员未配置 bucket，新增图片会被前端禁用，现有远程图片仍可进入队列
- 发布队列保存在当前 Node 进程内，服务重启后不会恢复；正式操作前应确保当前队列已经处理完毕
- 2026-09-03 首次真实草稿尝试因旧版扁平 material 被上游拒绝解析；结构修正后，用户再次确认的同一商品已经成功保存到国际站草稿箱
- 数据口径为平台可见数据,不含商品成本、人工、线下费用,因此不能等同于净利润
