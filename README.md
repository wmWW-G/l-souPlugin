# 来搜Plugin

来搜Plugin 把来搜经营驾驶舱、店铺诊断、产品诊断、广告诊断、品广诊断、重点产品跟进、新店运营规划、市场分析、选品、关键词、标题和卖点等页面整理成可直接触发的 Accio Plugin 工作流。

![用 ZIP 安装来搜Plugin](lsou-plugin/resources/tutorial-images/14-zip-install-guide.png)

## 目录

- `lsou-plugin/`：插件源码目录，可用于继续修改和校验。
- `lsou-plugin.zip`：已打包的 Plugin Hub 上传包。
- `lsou-plugin-chrome-test-record.md`：浏览器实测记录。

## 使用前提

使用前需要安装并启用来搜Plugin，登录来搜账号，并绑定要分析的店铺。插件会按用户的一句话需求打开对应页面，读取页面数据，并在回复里输出对应教程图和分析结果。

## 一句话安装 Prompt

把下面这句话发给 Codex，即可从 GitHub 获取来搜Plugin，并安装到使用者自己的 Accio 环境：

```text
请从 https://github.com/wmWW-G/l-souPlugin 获取来搜Plugin，下载并校验仓库里的 lsou-plugin.zip 和 lsou-plugin/ 插件目录，然后按 Accio Plugin 的本机安装流程安装到我当前登录的 Accio 环境。安装完成后，请验证来搜Plugin已加载，并提醒我登录来搜账号、绑定要分析的店铺后再使用。
```

## 校验

当前包已通过 Accio plugin-create 官方校验：`plugin.json`、`skills/`、`subAgents`、`resources/` 和 `path-safety` 均通过。
