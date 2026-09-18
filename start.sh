#!/bin/bash
# 本地开发与 Tauri 共用 Accio 安装发现逻辑，避免两种启动方式在平台更新后出现差异。
# 凭据仅在 Node 进程内传递，不写入文件，也不通过 shell eval 或命令输出转交。
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
NODE_EXECUTABLE=${NODE_BIN:-node}
cd "$SCRIPT_DIR"
exec "$NODE_EXECUTABLE" "$SCRIPT_DIR/desktop/runtime.cjs" --start-development
