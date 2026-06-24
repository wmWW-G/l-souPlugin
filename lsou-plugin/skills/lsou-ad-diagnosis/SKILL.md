---
name: lsou-ad-diagnosis
displayName: 来搜广告维度诊断
displayDescription: 打开广告诊断中心，分析广告计划、花费、CTR、CPC、CPA、商机和 L1+ 效率。
description: Open L-SOU ads diagnosis page with Browser Extension and extract campaign, spend, CTR, CPC, CPA, inquiry, conversion, and L1+ opportunity metrics.
version: 1.0.0
---

# 来搜广告维度诊断

## 一句话触发

用户说“做广告诊断”“看广告花费”“查 CPC CPA”“看 L1+ 商机”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/diagnosisSKILL/store-ad-diagnosis.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `同步数据`

## 教程图

- 回复中默认展示：`![来搜广告维度诊断教程图](resources/tutorial-images/05-lsou-ad-diagnosis.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定要分析的店铺。
- 打开页面后先检查登录、授权、店铺绑定和广告权限；异常时停止并请用户处理。
- 若用户没有说明日期范围，优先用 `Ask User` 询问“最近 7 天 / 本月 / 自定义”；默认推荐“最近 7 天”，适合广告异常排查。
- 若页面有多个广告计划且用户没指定，优先用 `Ask User` 让用户选择“当前默认计划 / 全部计划概览 / 指定计划”。
- 点击同步后若计划表或明细表仍显示加载中、空表或 `-`，重试一次；仍无数据时报告页面状态。

## 实测边界

- 实测页面可读取广告计划列表，可能存在多个计划。
- 日期范围需要明确；页面默认一般是最近 7 天。
- KPI 全 0、计划表显示暂无消耗、地域/关键词等报告为空，可能只是该计划/时间范围无投放消耗，不等于页面失败。
- Tab 切换可能残留旧内容；读取时要确认当前 tab 标题和表格内容一致。

## 执行步骤

1. 打开 URL。
2. 如用户指定广告计划或日期范围，选择计划并设置开始/结束日期。
3. 点击 `同步数据`。
4. 读取广告花费、ROI、总商机量、商机转化率、CPC、CPA、CTR。
5. 读取推广计划表和日期明细表，重点看计划状态、预算、今日已耗、询盘量、平均转化成本、L1+ 商机。

## 输出

输出低效计划、可加预算计划、需要暂停或调价的方向。若全 0 或暂无消耗，输出“当前条件无消耗数据”和建议用户换计划/日期。
