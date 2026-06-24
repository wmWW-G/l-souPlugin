---
name: lsou-market-analysis
displayName: 来搜市场分析
displayDescription: 输入核心产品，打开市场分析页并生成模板化市场分析框架。
description: Open L-SOU market analysis page with Browser Extension, input a product name, run the page demo flow, and summarize the generated market-analysis framework as a draft.
version: 1.0.0
---

# 来搜市场分析

## 一句话触发

用户说“做市场分析”“分析某个产品市场”“看市场机会”“L-SOU 市场穿透”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/operationSKILL/ops-market.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `一键 L-SOU 市场穿透`

## 教程图

- 回复中默认展示：`![来搜市场分析教程图](resources/tutorial-images/09-lsou-market-analysis.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定店铺。
- 打开页面后先检查登录、授权和页面可用状态；异常时停止并请用户处理。
- 如果用户没有给产品名或关键词，优先用 `Ask User` 询问要分析的产品；不可用时用普通对话追问。
- 点击穿透后如果结果仍停留在 `[READY]`、系统就绪或空白状态，等待并重试一次。
- 如果页面没有返回市场结论，只报告页面状态和已输入的产品词，不编造市场机会。

## 实测边界

- 实测点击后没有新增业务请求，页面脚本未发现真实抓取接口；结果属于前端模板化市场报告。
- 空产品名会触发原生 alert；缺产品名时先 Ask User，不要主动触发弹窗。
- 页面日志可能写 Google Trends、CR5、关税、VoC、成本精算等，但这不是已验证真实数据源。
- 结果可能含与输入产品不匹配的固定字段；输出时标注为“页面模板结果”，不要当真实市场证据。
- 如果用户要求真实市场分析，应提示需要接入真实数据源或让用户提供数据。

## 执行步骤

1. 如果用户没给产品名，先问“要分析哪个产品或关键词？”
2. 打开 URL。
3. 在产品输入框填入用户给的核心产品名。
4. 点击 `一键 L-SOU 市场穿透`。
5. 等待结果区从 READY 状态变为分析结果。
6. 读取页面生成的 8 阶段市场分析框架、评分和建议，并标注为模板化结果。

## 输出

输出市场分析框架、页面生成的评分/结论、需要真实验证的数据项和下一步验证动作。不要声称已实时抓取第三方市场数据。
