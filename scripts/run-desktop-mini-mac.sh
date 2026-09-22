#!/bin/zsh
set -euo pipefail

taskflow_root="${0:A:h}/.."
cd "$taskflow_root"

desktop_url="${TASKFLOW_DESKTOP_URL:-http://localhost:3002/desktop-mini?demo=mini}"
swift_binary="/tmp/taskflow-desktop-mini-mac"
module_cache="/tmp/taskflow-swift-module-cache"
app_bundle="/tmp/TaskFlowMini.app"

if ! curl -fsS --max-time 2 "$desktop_url" >/dev/null 2>&1; then
  echo "TaskFlowのローカルサーバーが起動していません。先に npm run dev:local を実行してください。" >&2
  echo "接続先: $desktop_url" >&2
  exit 1
fi

mkdir -p "$module_cache"
CLANG_MODULE_CACHE_PATH="$module_cache" xcrun swiftc desktop/mac-mini/main.swift -o "$swift_binary" -framework Cocoa -framework WebKit
mkdir -p "$app_bundle/Contents/MacOS"
cp "$swift_binary" "$app_bundle/Contents/MacOS/TaskFlowMini"
cp desktop/mac-mini/Info.plist "$app_bundle/Contents/Info.plist"
open -a "$app_bundle" --args "$desktop_url"
