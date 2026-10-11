#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install the current LTS from https://nodejs.org, then rerun this installer."
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node --version))."
  exit 1
fi

# Use a user-writable folder and add it to KeyShot's Scripts folders in Preferences.
SCRIPTS_DIR="$HOME/Library/Application Support/KeyShot Director/Scripts"
mkdir -p "$SCRIPTS_DIR"
LAUNCHER="$SCRIPTS_DIR/KeyShot Director.py"
if [ -e "$LAUNCHER" ] && ! grep -q 'KEYSHOT_DIRECTOR_MANAGED_LAUNCHER' "$LAUNCHER"; then
  echo "Refusing to replace an existing, unmanaged KeyShot script: $LAUNCHER"
  exit 1
fi

node - "$APP_DIR" "$LAUNCHER" <<'NODE'
const fs = require('fs');
const root = JSON.stringify(process.argv[2]);
const target = process.argv[3];
const source = `# KEYSHOT_DIRECTOR_MANAGED_LAUNCHER
# Start this script from KeyShot's Scripts tab after saving your scene.
import os
KD_HOME = ${root}
bridge = os.path.join(KD_HOME, "bridge", "cc_bridge.py")
if not os.path.isfile(bridge):
    raise RuntimeError("KeyShot Director was moved. Run install-mac.sh again from its current folder.")
exec(compile(open(bridge, "r", encoding="utf-8-sig").read(), bridge, "exec"))
`;
fs.writeFileSync(target, source, { encoding: 'utf8', mode: 0o600 });
NODE

echo "KeyShot launcher installed: $LAUNCHER"
echo "In KeyShot, open Preferences > Folders > Scripts and add: $SCRIPTS_DIR"
echo "Then open the Scripting window, select KeyShot Director, and click Run."
echo "Start the companion app with Start KeyShot Director.command (or: ./start-mac.sh)."
