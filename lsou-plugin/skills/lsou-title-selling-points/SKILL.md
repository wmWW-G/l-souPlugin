---
name: lsou-title-selling-points
displayName: 来搜标题卖点制作
displayDescription: 输入关键词、目标客群和卖点，打开标题+卖点制作页生成详情页文案草稿。
description: Open L-SOU title and selling points page with Browser Extension, input keywords, target audience, and selling points, then summarize the page-generated product detail page copy draft.
version: 1.0.0
---

# 来搜标题卖点制作

## 一句话触发

用户说“生成标题和卖点”“做五点卖点”“标题+卖点制作”“帮我写详情页文案”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/operationSKILL/ops-title-selling-points.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `AI 一键生成标题与卖点`

## 教程图

- 回复中默认展示：`![来搜标题卖点制作教程图](resources/tutorial-images/13-lsou-title-selling-points.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定店铺。
- 打开页面后先检查登录、授权和页面可用状态；异常时停止并请用户处理。
- 如果缺少关键词、目标国家/客群或核心卖点，优先用 `Ask User` 收集；可用选择项包括“只生成标题和卖点 / 同时导出 CSV / 复制到剪贴板”。
- 点击生成后如果预览仍是示例文案，先确认用户是否接受示例；否则不要把示例当真实结果。
- 导出或复制属于用户动作，只有用户明确要求时才点击。

## 实测边界

- 实测主按钮无真实业务 API；页面通过前端逻辑拼接标题和五点卖点。
- 页面无强制空输入校验，缺值时会用通用兜底词；缺产品名、目标市场或卖点时应先 Ask User，避免生成泛化文案。
- `从“关键词大师库”导入` 实测为固定示例关键词并弹窗，不是已验证真实词库。
- `导出为 EXCEL (CSV)` 实际是 CSV；`保存当前方案`未验证有后台保存动作。
- 本页输出只能定位为详情页文案初稿，不要声称真实 AI、VoC、关键词库分析或后台保存。

## 执行步骤

1. 如果缺少关键词、目标市场或核心卖点，先问一个最小补充问题。
2. 打开 URL。
3. 填入精选关键词、目标客群与国家、核心功能点。
4. 点击 `AI 一键生成标题与卖点`。
5. 读取页面生成的推荐标题和五点卖点，并标注为前端生成草稿。
6. 用户要求导出时点击 `导出为 EXCEL (CSV)`；要求复制时点击 `复制到剪贴板`。

## 输出

输出标题草稿、五点卖点草稿、关键词覆盖说明和下一步主图制作建议。不要声称已真实调用 AI 后端或保存到后台。
