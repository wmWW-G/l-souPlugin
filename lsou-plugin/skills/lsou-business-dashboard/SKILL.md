---
name: lsou-business-dashboard
displayName: 来搜经营驾驶舱
displayDescription: 打开经营驾驶舱，同步并汇总 GMV、询盘、访客、产品和业务团队表现。
description: Open L-SOU business dashboard with Accio Work Browser Extension to sync and extract GMV, inquiry, visitor, product ranking, sales team performance, and AI diagnosis.
version: 1.0.0
---

# 来搜经营驾驶舱

## 一句话触发

用户说“看数据看板”“打开经营驾驶舱”“看 GMV 和询盘目标”“汇总老板看板”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/index.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `同步数据`

## 教程图

- 回复中默认展示：`![来搜经营驾驶舱教程图](resources/tutorial-images/01-lsou-business-dashboard.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定要分析的店铺。
- 打开页面后先判断是否出现登录、授权、验证码、未绑定店铺、无权限或请选择店铺；出现这些状态时停止读取，让用户先处理。
- 若用户没有说明按月、按周还是按日，优先用 `Ask User` 弹出选择；默认推荐“按月”，适合老板经营复盘。
- 点击同步后如果仍是空表、占位符、`-` 或加载提示，等待后重试一次；仍无数据时报告页面状态，不编造。
- 如果找不到 `同步数据` 按钮，读取页面标题和可见按钮，说明页面结构可能变化。

## 实测边界

- 实测页面默认显示店铺/公司、GMV、询盘、商品 TOP10、团队绩效和 AI 建议。
- 时间粒度可切换月、周、日；切换后仍要以页面最终展示为准。
- `同步数据` 后页面可能变化，但实测未稳定观察到新增业务请求；输出时说“页面显示/页面更新”，不要额外保证“实时后台同步成功”。
- `导出报告` 和 AI 指令输入只有用户明确要求时才使用。

## 执行步骤

1. 用 Accio Work Browser Extension 打开 URL。
2. 如果用户指定月份、周或日期，先切换页面时间类型并填入时间；否则保留页面默认时间。
3. 点击 `同步数据`，等待页面指标、表格和 AI 建议刷新。
4. 读取 GMV 目标、询盘目标、本周 GMV、广告总花费、商机成本、全店访客、询盘转化率。
5. 读取产品询盘 TOP10、业务团队绩效表和 AI 经营诊断建议。

## 输出

先给老板摘要，再列关键指标、产品异常、业务员表现和下一步动作。输出中标注数据来自页面展示；不要编造页面没有显示的数据。
