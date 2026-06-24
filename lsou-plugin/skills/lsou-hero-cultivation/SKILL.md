---
name: lsou-hero-cultivation
displayName: 来搜优爆品培育导航
displayDescription: 打开优爆品数据看板，监控爆品、优品、潜力优品、普通品和低质品。
description: Open L-SOU hero product cultivation dashboard with Browser Extension and extract hero, high-quality, potential, normal, and low-quality product matrix.
version: 1.0.0
---

# 来搜优爆品培育导航

## 一句话触发

用户说“看优爆品”“爆品培育”“看看爆品矩阵”“优品潜力品怎么分布”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/diagnosisSKILL/store-hero-cultivation.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `同步数据`

## 教程图

- 回复中默认展示：`![来搜优爆品培育导航教程图](resources/tutorial-images/04-lsou-hero-cultivation.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定要分析的店铺。
- 打开页面后先检查登录、授权、店铺绑定和权限状态；异常时停止并请用户处理。
- 如果爆品、优品、潜力优品等计数全是 `-` 或产品表只有加载提示，点击同步后等待并重试一次。
- 如果同步后仍无数据，说明页面未返回优爆品矩阵，不要补假数据。
- 如用户要按商机品或交易品细看，优先用 `Ask User` 让用户选择“全部 / 商机品 / 交易品”。

## 实测边界

- 实测同步后会出现爆品、优品、潜力优品、普通品、低质品统计。
- 某些分类可能为 0，例如爆品或低质品为 0，这是有效业务结果，不是页面失败。
- KPI 总量可能大于表格当前渲染行数；输出时区分“页面计数”和“当前表格可见行”。
- 图片列可能为空；不要声称已完成图片/主图诊断。

## 执行步骤

1. 打开 URL。
2. 点击 `同步数据`。
3. 读取总数、商机品、交易品中的爆品、优品、潜力优品、普通品、低质品数量。
4. 读取产品表中的产品 ID、类目、类型、橱窗、商机优爆品、交易优爆品、30d 曝光、30d 访客、90d 询盘人、90d 支付买家。

## 输出

输出爆品矩阵概览、需要加资源的潜力品、需要淘汰或重发的低质品；明确空分类和表格截断情况。
