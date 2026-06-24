---
name: lsou-product-diagnosis
displayName: 来搜产品全面诊断
displayDescription: 打开产品全面诊断，分析 SKU 曝光、点击、访问、询盘、资源位和优化清单。
description: Open L-SOU product diagnosis page with Browser Extension and extract SKU exposure, clicks, visits, inquiries, product level, resource positions, AI diagnosis, and action plan.
version: 1.0.0
---

# 来搜产品全面诊断

## 一句话触发

用户说“做产品诊断”“看 SKU 表现”“找需要优化的产品”“产品全面诊断”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/diagnosisSKILL/store-product-diagnosis.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `同步数据`

## 教程图

- 回复中默认展示：`![来搜产品全面诊断教程图](resources/tutorial-images/03-lsou-product-diagnosis.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定要分析的店铺。
- 打开页面后先判断是否登录、授权、绑定店铺或权限异常；异常时停止并让用户处理。
- 若用户没有说明按月、按周还是按日，优先用 `Ask User` 询问；默认推荐“按月”。
- 产品总表为空、只有表头或没有 SKU 时，重试一次同步；仍为空时说明当前时间范围没有返回产品数据。
- 如果表格过长，只读取 TOP 项、异常项和执行计划，不要机械复述整表。

## 实测边界

- 实测点击 `同步数据` 后可返回商品数据；总表可能有大量商品，异常分类表可能为 0 行。
- `高点击高转化`、`高流量低转化` 等分类为空时，表示当前规则下无匹配商品，不等于接口失败。
- 某些 KPI 可能显示 `-` 或占位，例如优质产品数、主图视频覆盖率、零效果产品数；输出时标为“页面未返回”。
- 页面个别标题可能残留 HTML 字符，忽略样式问题，聚焦表格数据。

## 执行步骤

1. 打开 URL。
2. 设置用户指定的时间范围。
3. 点击 `同步数据`。
4. 读取产品诊断总表，重点看产品 ID、负责人、优品等级、橱窗、顶展、P4P、曝光、点击、访问、询盘、TM 和询盘率。
5. 读取 Q2 产品优化执行落地计划表。

## 输出

按“优先优化、继续放量、观察、下架/重发”分类输出产品建议；空分类要说明“当前未匹配”，不要强行凑产品。
