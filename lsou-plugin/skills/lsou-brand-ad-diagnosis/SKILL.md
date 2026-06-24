---
name: lsou-brand-ad-diagnosis
displayName: 来搜品广维度诊断
displayDescription: 打开品广诊断报告，读取页面演示数据并整理品广诊断框架。
description: Open L-SOU brand ads diagnosis page with Browser Extension, read the page demo data, and summarize a brand ads diagnosis framework without overstating it as live backend data.
version: 1.0.0
---

# 来搜品广维度诊断

## 一句话触发

用户说“做品广诊断”“看品牌广告”“看问鼎/顶展效果”“分析 L1+ 品广”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/diagnosisSKILL/brand-ad-diagnosis.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `同步后台数据`

## 教程图

- 回复中默认展示：`![来搜品广维度诊断教程图](resources/tutorial-images/06-lsou-brand-ad-diagnosis.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定要分析的店铺。
- 打开页面后先检查登录、授权、店铺绑定和品广权限；异常时停止并请用户处理。
- 若用户没有说明时间范围，优先用 `Ask User` 询问“本月 / 最近 7 天 / 按页面默认”；默认推荐“本月”。
- 点击同步后若品广总览、L1+ 数据或整改计划为空，等待后重试一次。
- 如果品牌广告没有投放或无权限，输出“页面未返回品广数据”，不要假设投放效果。

## 实测边界

- 实测页面包含 `mockData` 和模拟更新逻辑，未观察到真实业务 API。
- `同步后台数据` 只应理解为页面演示动作；不要声称已同步真实品广后台。
- 产品链接可能为 `#`，图片可能为空，部分筛选可能报缺少 KPI DOM。
- 本页适合输出品广诊断模板、字段检查清单和整改框架；不适合输出真实投放结论。

## 执行步骤

1. 打开 URL。
2. 点击 `同步后台数据`。
3. 读取品广总览：曝光次数/人数、点击次数/人数、到店次数/人数、详情浏览次数/人数、浏览产品数量。
4. 读取 L1+ 点击、到店、浏览占比和 TOP 关联产品明细。
5. 读取整改计划表。

## 输出

输出品广诊断框架、页面演示数据摘要和下一步需要补充的真实投放数据。不要把演示数据当真实效果。
