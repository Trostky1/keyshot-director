#!/bin/bash
# KeyShot Director - macOS installer. Run once from the extracted folder:   bash install-mac.sh
# Options:  --scripts-folder "<path>"   install the KeyShot launcher into that Scripts folder
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# Terminal normally has Homebrew on PATH already; add the usual homes in case it does not.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install the current LTS from https://nodejs.org, then rerun this installer."
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node --version))."
  exit 1
fi
echo "Node.js $(node --version) ... ok"

# A ZIP extracted by some tools loses the executable bit, and files from a download carry macOS's quarantine flag, which
# makes Finder refuse to open the .command files. Both are repaired for this folder only.
chmod +x "$APP_DIR"/*.sh "$APP_DIR"/*.command 2>/dev/null || true
xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null || true

mkdir -p "$APP_DIR/bridge/cmd" "$APP_DIR/bridge/resp" "$APP_DIR/bridge/shots" "$APP_DIR/references" "$APP_DIR/renders"

exec node "$APP_DIR/tools/install-launcher.js" "$APP_DIR" "$@"
