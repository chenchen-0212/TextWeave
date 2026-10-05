#!/usr/bin/env bash
# 把已构建好的 .app 打包成 .dmg 与 .zip
#
# 用法：bash scripts/package-macos.sh [版本号]
# 前置：已执行 wails build -platform darwin/universal，产出 build/bin/TextWeave.app

set -euo pipefail

VERSION="${1:-${VERSION:-0.3.0}}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

APP="build/bin/TextWeave.app"
if [[ ! -d "$APP" ]]; then
  echo "错误：找不到 $APP，请先执行 wails build -platform darwin/universal" >&2
  exit 1
fi

DIST="dist"
mkdir -p "$DIST"

DMG="$DIST/TextWeave-${VERSION}-macos-universal.dmg"
ZIP="$DIST/TextWeave-${VERSION}-macos-universal.zip"

# 组装 DMG 内容：应用本体 + /Applications 软链，用户打开后直接拖拽安装
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

# ---------------------------------------------------------------- 代码签名
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "=== 代码签名 ==="
  ENTITLEMENTS="$PROJECT_ROOT/build/darwin/entitlements.plist"
  if [[ -f "$ENTITLEMENTS" ]]; then
    codesign --deep --force --options runtime --timestamp \
      --sign "$APPLE_SIGNING_IDENTITY" \
      --entitlements "$ENTITLEMENTS" \
      "$STAGE/TextWeave.app"
  else
    codesign --deep --force --options runtime --timestamp \
      --sign "$APPLE_SIGNING_IDENTITY" \
      "$STAGE/TextWeave.app"
  fi
  codesign --verify --verbose=2 "$STAGE/TextWeave.app"
else
  echo "提示：未设置 APPLE_SIGNING_IDENTITY，产物为未签名版本。"
  echo "      用户首次打开会被 Gatekeeper 拦截，需右键「打开」或在"
  echo "      「系统设置 → 隐私与安全性」中允许。"
fi

# ---------------------------------------------------------------- 生成 DMG
echo "=== 生成 DMG ==="
rm -f "$DMG"
# UDZO = 压缩只读映像，体积最小，适合分发
hdiutil create \
  -volname "文织 TextWeave" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$DMG"

# ---------------------------------------------------------------- 公证
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" ]]; then
  echo "=== 提交公证（notarization）==="
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait
  # 把公证凭据钉到 DMG 上，用户离线也能通过校验
  xcrun stapler staple "$DMG"
  echo "公证完成"
else
  echo "提示：未提供公证凭据，跳过 notarization。"
fi

# ---------------------------------------------------------------- 附带 ZIP
# DMG 在部分企业内网环境下会被限制，额外提供 zip 作为备用分发方式
echo "=== 生成 ZIP ==="
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"

echo
echo "=== 产物 ==="
ls -lh "$DIST"
