---
name: lsou-title-generator
displayName: 来搜标题制作
displayDescription: 输入关键词、产品属性和目标市场，打开标题制作页生成标题草稿。
description: Open L-SOU title generator page with Browser Extension, input keyword library, product attributes, and target market, then summarize the page-generated title draft and quality notes.
version: 1.0.0
---

# 来搜标题制作

## 一句话触发

用户说“生成标题”“标题制作”“优化 SEO 标题”“给产品起标题”时使用。

## 页面与工具

- URL: `https://test.l-sou.cn/operationSKILL/ops-title.html`
- 推荐子代理: `browser`
- 浏览器工具族: `browser_*`
- 主动作按钮: `生成 AI 标题建议`

## 教程图

- 回复中默认展示：`![来搜标题制作教程图](resources/tutorial-images/12-lsou-title-generator.png)`。
- 若用户明确只要数据、快速结果或不要图片，可以省略教程图。

## 前置检查与异常处理

- 使用前提醒用户：需要已安装并启用来搜Plugin、已登录来搜账号、并已绑定店铺。
- 打开页面后先检查登录、授权和页面可用状态；异常时停止并请用户处理。
- 如果缺少关键词、产品属性或目标市场，优先用 `Ask User` 收集；不可用时用普通对话追问。
- 点击生成后如果推荐标题仍是示例标题，先确认用户是否接受示例；否则不要把示例当真实结果。
- 导出标题或批量复制只有用户明确要求时才点击。

## 实测边界

- 实测页面初始已有固定示例标题，生成动作偏前端/演示，不要声称真实 AI 后端生成。
- 页面存在隐藏产品名输入，不要依赖隐藏字段；只填写可见关键词、产品属性和目标市场。
- `导出标题 (.CSV)` 是 CSV，不是真 Excel 工作簿。
- 如果用户要求严格平台规则或真实搜索词覆盖，需要说明当前页面只提供标题草稿。

## 执行步骤

1. 如果缺少关键词或产品属性，先问一个最小补充问题。
2. 打开 URL。
3. 填入关键词库、核心产品属性、目标人群/国家。
4. 点击 `生成 AI 标题建议`。
5. 读取页面生成的标题规范审计、AI 建议、推荐标题库、得分和 SEO 优化项，并标注为页面草稿。
6. 用户要求导出时点击 `导出标题 (.CSV)`；要求批量复制时点击 `批量复制`。

## 输出

输出推荐标题草稿、得分原因、风险项和可继续优化的关键词。不要声称已真实调用 AI 后端或保存到后台。
