#!/bin/sh
# Accio 将 cwd 设置为插件根目录；不依赖用户终端 PATH 或外部 Node。
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(uname -m)" in
  arm64) TARGET=macos-arm64; REQUIRED='Mac（M芯片）版' ;;
  x86_64) TARGET=macos-x64; REQUIRED='Intel Mac版' ;;
  *) echo "不支持此 Mac 芯片" >&2; exit 1 ;;
esac
APP="$ROOT/resources/$TARGET/LSOUWorkbench.app"
NODE="$APP/Contents/Resources/runtime/node"
# 错包时 Node 尚不能运行，因此在最外层 shell 就给出不含用户路径的分类诊断。
if [ ! -d "$ROOT/resources/$TARGET" ]; then
  MESSAGE="安装包与当前电脑不匹配，请导入${REQUIRED}。"
  if [ "${1:-}" = '--diagnose' ]; then
    printf '{"ok":false,"code":"PACKAGE_WRONG_PLATFORM","message":"%s"}\n' "$MESSAGE"
  else printf '[PACKAGE_WRONG_PLATFORM] %s\n' "$MESSAGE" >&2; fi
  exit 1
fi
if [ ! -f "$NODE" ] || [ ! -f "$APP/Contents/MacOS/lsou-workbench" ]; then
  MESSAGE='安装包缺少运行程序，请重新导入完整安装包。'
  if [ "${1:-}" = '--diagnose' ]; then
    printf '{"ok":false,"code":"PACKAGE_INCOMPLETE","message":"%s"}\n' "$MESSAGE"
  else printf '[PACKAGE_INCOMPLETE] %s\n' "$MESSAGE" >&2; fi
  exit 1
fi
chmod +x "$NODE" "$APP/Contents/MacOS/lsou-workbench" 2>/dev/null || {
  printf '[PACKAGE_PERMISSION] 无法恢复本插件运行程序权限，请重新导入安装包。\n' >&2
  exit 1
}
unset ELECTRON_RUN_AS_NODE
exec "$NODE" "$ROOT/scripts/desktop-mcp.cjs" "$@"
