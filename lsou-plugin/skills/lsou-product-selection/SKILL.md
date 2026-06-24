---
name: lsou-product-selection
displayName: 来搜选品经理
displayDescription: 输入核心产品，打开选品经理页并生成选品 SOP 草稿。
description: Open L-SOU product selection manager with Browser Extension, input a product name, run the page demo flow, and summarize the selection SOP draft, grouping, assets, and team assignment.
version: 1.0.0
---

# 来搜选品经理

## 一句话触发

用户说“做选品”“选品经理”“分析选品方向”“给这个产品做选品穿透”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/operationSKILL/ops-selection.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `一键 L-SOU 选品穿透`

## 教程图

- 回复中默认展示：`![来搜选品经理教程图](resources/tutorial-images/10-lsou-product-selection.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定店铺。
- 打开页面后先检查登录、授权和页面可用状态；异常时停止并请用户处理。
- 如果用户没有给产品名，优先用 `Ask User` 询问要围绕哪个产品选品。
- 如果页面停留在 `[READY]` 或只显示示例分组，点击穿透后等待并重试一次。
- 如果选品结果缺少分组、数据定品或团队分工，只输出已展示模块并标注缺失。

## 实测边界

- 实测点击后无业务网络请求；页面通过前端日志模拟 TOP RANKING、市场参谋、流量参谋和 AI Agent。
- 空产品名会触发原生 alert；缺产品名时先 Ask User。
- B/C/D/E 面板内容本来就在 DOM 中，主按钮不会证明表格已真实刷新。
- 本页适合输出选品 SOP 草稿、分组框架和待验证数据清单；不能声称真实穿透榜单或参谋数据。

## 执行步骤

1. 如果用户没有给产品名，先问“要围绕哪个产品做选品？”
2. 打开 URL。
3. 填入核心产品名。
4. 点击 `一键 L-SOU 选品穿透`。
5. 读取产品分组、全维选品、数据定品、资料中心、团队考核模块，并标注为页面示例/模拟结果。
6. 读取主分组、子分组、核心产品前置、状态、定岗人员。

## 输出

输出选品结构草稿、优先上架方向、分组建议、人员分工和需要补充的真实数据。不要声称已真实更新选品表或定品表。
