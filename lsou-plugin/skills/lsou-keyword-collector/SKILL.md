---
name: lsou-keyword-collector
displayName: 来搜关键词整理
displayDescription: 输入产品词或主词，打开关键词整理页并生成关键词分组草稿。
description: Open L-SOU keyword collector page with Browser Extension, input product keywords, run the page demo flow, and summarize the generated keyword grouping draft.
version: 1.0.0
---

# 来搜关键词整理

## 一句话触发

用户说“整理关键词”“做关键词库”“关键词穿透”“批量导词”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/operationSKILL/keyword-collector.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `一键 L-SOU 关键词穿透`

## 教程图

- 回复中默认展示：`![来搜关键词整理教程图](resources/tutorial-images/11-lsou-keyword-collector.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定店铺。
- 打开页面后先检查登录、授权和页面可用状态；异常时停止并请用户处理。
- 如果用户没有给产品词或主词，优先用 `Ask User` 询问要整理的关键词。
- 如果用户给了多个主词，保留原始分隔，不要擅自删词；如需清理，先询问。
- 点击穿透后如果词库为空或仍是系统就绪状态，等待并重试一次；仍为空时报告页面状态。

## 实测边界

- 实测为静态/模拟关键词结果，点击后未观察到真实关键词库或平台搜索词 API。
- 空输入会触发原生 alert；缺主词时先 Ask User。
- `关键词批量导出` 只有用户明确要求时才点击。
- 输出时可作为关键词分组草稿，不要声称已连接真实关键词大师库或平台数据。

## 执行步骤

1. 如果用户没有给主词或产品名，先问“要整理哪个产品或主词？”
2. 打开 URL。
3. 在关键词输入框填入用户提供的主词，可按逗号或换行输入多个。
4. 点击 `一键 L-SOU 关键词穿透`。
5. 读取页面生成的主词、同类词、批量导词、清理词库和 AI 优化发品建议，并标注为页面模拟结果。
6. 用户要求导出时点击 `关键词批量导出`。

## 输出

输出可用于发品、标题、广告和品广的关键词分组草稿，并说明需要真实词库进一步验证。
