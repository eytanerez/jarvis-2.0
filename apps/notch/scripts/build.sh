#!/usr/bin/env bash
# Builds Jarvis Notch.app (the native notch companion) for local dev.
# Output: apps/notch/.build/xcode/Build/Products/<config>/Jarvis Notch.app
set -euo pipefail

MODE="${1:-build}"
APP_NAME="Jarvis Notch"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT_DIR/DynamicIsland.xcodeproj"
SCHEME="DynamicIsland"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA="$ROOT_DIR/.build/xcode"
APP_BUNDLE="$DERIVED_DATA/Build/Products/$CONFIGURATION/$APP_NAME.app"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

cd "$ROOT_DIR"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build

case "$MODE" in
  build)
    echo "Built: $APP_BUNDLE"
    ;;
  run)
    pkill -x "$APP_NAME" >/dev/null 2>&1 || true
    /usr/bin/open -n "$APP_BUNDLE"
    ;;
  *)
    echo "usage: $0 [build|run]" >&2
    exit 2
    ;;
esac
