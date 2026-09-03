#!/bin/bash
# 启动 workctl 经营数据面板。
#
# 这个脚本不会保存 Accio gateway token。每次启动都会从当前 Accio Desktop
# 的健康状态重新识别活动 space，再把账号级 runtime 凭据和当前插件的
# Workctl 路径只注入即将启动的 Node.js 子进程。

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ACCOUNTS_ROOT=${ACCIO_ACCOUNTS_ROOT:-"${HOME}/.accio/accounts"}
HEALTH_URL=${ACCIO_HEALTH_URL:-"http://127.0.0.1:4097/health"}
NODE_EXECUTABLE=${NODE_BIN:-node}

cd "$SCRIPT_DIR"

# curl 用于读取 Accio Desktop 本地健康状态，jq 用于只在内存中解析 JSON。
# 任一工具缺失都应在启动前明确失败，不能让页面启动后才显示模糊的 CLI 错误。
for REQUIRED_COMMAND in curl jq; do
  if ! command -v "$REQUIRED_COMMAND" >/dev/null 2>&1; then
    echo "[workctl-dashboard] 启动失败：缺少命令 $REQUIRED_COMMAND" >&2
    exit 1
  fi
done

HEALTH_JSON=$(curl -fsS --max-time 5 "$HEALTH_URL") || {
  echo "[workctl-dashboard] 启动失败：无法连接 Accio Desktop 本地网关" >&2
  exit 1
}

# health 中可能先出现账号 storageKey，再出现团队 space storageKey；最后一条
# resource_identity_gate 才是当前项目与插件实际所在的活动 space。
ACTIVE_SPACE=$(printf '%s' "$HEALTH_JSON" | jq -er \
  '[.bootTiming.stages[]? | select(.stage == "resource_identity_gate") | .detail.storageKey // empty] | last | select(type == "string" and length > 0)') || {
  echo "[workctl-dashboard] 启动失败：Accio health 未返回活动 space" >&2
  exit 1
}
ACCOUNT_ID=${ACTIVE_SPACE%%_*}
GATEWAY_FILE="$ACCOUNTS_ROOT/$ACCOUNT_ID/.accio/runtime/gateway-cli.json"

if [ ! -f "$GATEWAY_FILE" ]; then
  echo "[workctl-dashboard] 启动失败：当前账号 runtime 凭据不存在" >&2
  exit 1
fi

# 命令替换结果只进入进程环境，不输出到终端，也不写回任何项目文件。
ACCIO_GATEWAY_TOKEN=$(jq -er \
  '.password | select(type == "string" and length > 0)' "$GATEWAY_FILE") || {
  echo "[workctl-dashboard] 启动失败：runtime 凭据缺少 gateway token" >&2
  exit 1
}
ACCIO_LOCAL_GATEWAY_URL=$(jq -er \
  '(.url // "http://localhost:4097") | select(type == "string" and length > 0)' "$GATEWAY_FILE") || {
  echo "[workctl-dashboard] 启动失败：runtime 凭据缺少 gateway URL" >&2
  exit 1
}

CLI_MANIFEST="$ACCOUNTS_ROOT/$ACTIVE_SPACE/plugins/installed/alibaba-com-seller-assistant/clis/clis.json"
if [ ! -f "$CLI_MANIFEST" ]; then
  echo "[workctl-dashboard] 启动失败：当前 space 未安装国际站生意助手 CLI" >&2
  exit 1
fi

WORKCTL_VERSION=$(jq -er \
  '[.tools[]? | select(.id == "workctl") | .source.version // empty] | first | select(type == "string" and length > 0)' \
  "$CLI_MANIFEST") || {
  echo "[workctl-dashboard] 启动失败：clis.json 未声明 Workctl 版本" >&2
  exit 1
}
WORKCTL_BIN="$ACCOUNTS_ROOT/$ACTIVE_SPACE/plugins/data/cli-tools/plugins/alibaba-com-seller-assistant/tools/workctl/versions/$WORKCTL_VERSION/prefix/bin/workctl"

if [ ! -x "$WORKCTL_BIN" ]; then
  echo "[workctl-dashboard] 启动失败：当前 Workctl 不存在或不可执行" >&2
  exit 1
fi

export ACCIO_GATEWAY_TOKEN ACCIO_LOCAL_GATEWAY_URL WORKCTL_BIN

# 先验证本地网关认证，再确认本项目依赖的动态 advisor、底层发布 Schema 和
# publishflow 编排命令已注册。图片上传只有管理员配置 bucket 后才执行对应预检。
# 预检只读取 schema，不查询经营数据，也不会触发任何商品写操作。
WORKCTL_HEALTH=$("$WORKCTL_BIN" health --format json 2>&1) || {
  echo "[workctl-dashboard] 启动失败：Workctl 无法连接当前 Accio 会话" >&2
  exit 1
}
if ! printf '%s' "$WORKCTL_HEALTH" | jq -e '.success == true' >/dev/null 2>&1; then
  echo "[workctl-dashboard] 启动失败：Workctl 健康检查未通过" >&2
  exit 1
fi

WORKCTL_SCHEMA=$("$WORKCTL_BIN" schema icbu advisor data-advisor-shop-summary \
  --format json --compact-output off 2>&1) || {
  echo "[workctl-dashboard] 启动失败：经营大盘 schema 不可用" >&2
  exit 1
}
if ! printf '%s' "$WORKCTL_SCHEMA" | jq -e '.success == true' >/dev/null 2>&1; then
  echo "[workctl-dashboard] 启动失败：经营大盘动态命令未注册" >&2
  exit 1
fi

PUBLISH_SCHEMA=$("$WORKCTL_BIN" schema icbu product new-publish-product \
  --format json --compact-output off 2>&1) || {
  echo "[workctl-dashboard] 启动失败：产品发布 schema 不可用" >&2
  exit 1
}
if ! printf '%s' "$PUBLISH_SCHEMA" | jq -e '.success == true' >/dev/null 2>&1; then
  echo "[workctl-dashboard] 启动失败：产品发布动态命令未注册" >&2
  exit 1
fi

PUBLISHFLOW_HELP=$("$WORKCTL_BIN" publishflow --help 2>&1) || {
  echo "[workctl-dashboard] 启动失败：产品发布流程不可用" >&2
  exit 1
}
if ! printf '%s' "$PUBLISHFLOW_HELP" | grep -q 'publish-from-json'; then
  echo "[workctl-dashboard] 启动失败：publish-from-json 未注册" >&2
  exit 1
fi
if ! printf '%s' "$PUBLISHFLOW_HELP" | grep -q 'query-template-info-by-id'; then
  echo "[workctl-dashboard] 启动失败：参考商品导入流程未注册" >&2
  exit 1
fi

# bucket 是管理员部署参数，不能让普通运营人员在页面输入。没有配置时仍允许工作台
# 启动，现有 CDN 图片和其他功能可继续使用；右侧会明确显示“图片上传尚未配置”。
if [ -n "${PUBLISH_IMAGE_BUCKET:-}" ]; then
  UPLOAD_SCHEMA=$("$WORKCTL_BIN" schema icbu other upload-file \
    --format json --compact-output off 2>&1) || {
    echo "[workctl-dashboard] 启动失败：图片上传 schema 不可用" >&2
    exit 1
  }
  if ! printf '%s' "$UPLOAD_SCHEMA" | jq -e '.success == true' >/dev/null 2>&1; then
    echo "[workctl-dashboard] 启动失败：图片上传动态命令未注册" >&2
    exit 1
  fi
else
  echo "[workctl-dashboard] 提示：未配置发品图片 bucket，新选图片暂不能上传"
fi

# 释放包含运行态 JSON 的普通 shell 变量；导出的三项环境变量由 Node 服务使用。
unset HEALTH_JSON GATEWAY_FILE CLI_MANIFEST WORKCTL_HEALTH WORKCTL_SCHEMA PUBLISH_SCHEMA PUBLISHFLOW_HELP
if [ -n "${UPLOAD_SCHEMA:-}" ]; then
  unset UPLOAD_SCHEMA
fi

echo "[workctl-dashboard] Accio 运行环境检查通过（Workctl ${WORKCTL_VERSION}）"
exec "$NODE_EXECUTABLE" server.js
