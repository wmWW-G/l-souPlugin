---
name: lsou-hero-tracking
displayName: 来搜重点产品跟进
displayDescription: 打开重点产品跟进页，只看爆品产品清单和近期表现。
description: Open L-SOU hero tracking page with Browser Extension and extract hero product list, owners, levels, showcase, top display, P4P, exposure, clicks, visits, and inquiries.
version: 1.0.0
---

# 来搜重点产品跟进

## 一句话触发

用户说“跟进重点产品”“看爆品跟进”“看核心产品表现”“爆品最近怎么样”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/explosivePDUS/hero-tracking.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `同步数据`

## 教程图

- 回复中默认展示：`![来搜重点产品跟进教程图](resources/tutorial-images/07-lsou-hero-tracking.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定要分析的店铺。
- 打开页面后先检查登录、授权、店铺绑定和权限状态；异常时停止并请用户处理。
- 若用户没有说明按月、按周还是按日，优先用 `Ask User` 询问；默认推荐“按月”。
- 如果页面提示仅显示爆品但表格为空，先重试同步；仍为空时说明当前范围没有返回爆品产品。
- 如果用户要看某个负责人或某个产品，优先用 `Ask User` 或对话补充筛选条件。
- 如果页面提示未获取 ctoken 或扩展 ID，提示用户先确认 Alibaba 后台登录态和来搜扩展状态。

## 实测边界

- 实测页面会筛选 `prodLevel3=爆品`；同步成功后也可能返回 0 条爆品。
- 表格为空且显示 `暂无数据` 时，应输出“当前条件下无爆品”，不是失败。
- 导出按钮即使空表也可能可用；没有用户明确要求时不要导出。
- 不记录、不复述任何 token、cookie、JWT 或浏览器内部状态。

## 执行步骤

1. 打开 URL。
2. 设置用户指定月份；无指定则使用页面默认月份。
3. 点击 `同步数据`。
4. 读取仅显示 `prodLevel3` 为“爆品”的产品表。
5. 重点看产品 ID、产品图、名称、链接、负责人、优品等级、橱窗、顶展、P4P、曝光、点击、访问、询盘。

## 输出

输出核心爆品状态、资源位是否匹配、是否存在高曝光低询盘或低流量风险。若无爆品，说明筛选条件和页面状态。
