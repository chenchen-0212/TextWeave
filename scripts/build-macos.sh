#!/usr/bin/env bash
# 构建 macOS 产物（.app + .dmg）
#
# 必须在 macOS 上运行。
# 原因：Wails 通过 cgo 调用 Cocoa / WebKit，无法从 Windows 或 Linux 交叉编译出可用的 .app。
#
# 前置条件：
#   1. Xcode Command Line Tools：xcode-select --install
#   2. Go 1.21+ 与 Node 18+
#   3. Wails CLI：go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0
#
# 可选（用于正式分发）：
#   APPLE_SIGNING_IDENTITY  —— 代码签名证书名，如 "Developer ID Application: Your Name (TEAMID)"
#   APPLE_ID / APPLE_TEAM_ID / APPLE_APP_PASSWORD —— 用于公证（notarization）

set -euo pipefail

VERSION="${VERSION:-0.2.0}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== 环境检查 ==="

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "错误：macOS 产物必须在 macOS 上构建。" >&2
  echo "      Wails 依赖 cgo 调用 Cocoa / WebKit，无法跨平台编译。" >&2
  echo "      若手上只有 Windows 机器，请使用 .github/workflows/release.yml 里的 CI。" >&2
  exit 1
fi

if ! xcode-select -p >/dev/null 2>&1; then
  echo "错误：未安装 Xcode Command Line Tools，请执行：xcode-select --install" >&2
  exit 1
fi

if ! command -v wails >/dev/null 2>&1; then
  echo "错误：未安装 Wails CLI，请执行：" >&2
  echo "      go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未安装 Node.js（需要 18+）" >&2
  exit 1
fi

# Wails 的 macOS 构建必须开启 cgo
export CGO_ENABLED=1
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-10.15}"

echo "  macOS: $(sw_vers -productVersion)"
echo "  arch : $(uname -m)"
echo "  go   : $(go version | awk '{print $3}')"
echo "  node : $(node -v)"
echo "  wails: $(wails version | head -1)"

echo
echo "=== 构建通用二进制 .app（arm64 + amd64）==="
# universal 会分别编译两个架构再合并，因此首次构建耗时较长
wails build -clean -platform darwin/universal

APP="build/bin/TextWeave.app"
if [[ ! -d "$APP" ]]; then
  echo "错误：构建未生成 $APP" >&2
  exit 1
fi

echo
echo "=== 校验 .app 结构 ==="
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" || true
echo "  架构：$(lipo -archs "$APP/Contents/MacOS/TextWeave" 2>/dev/null || echo '未知')"

echo
echo "=== 打包 .dmg 与 .zip ==="
bash scripts/package-macos.sh "$VERSION"

echo
echo "=== 完成 ==="
ls -lh dist
