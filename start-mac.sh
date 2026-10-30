#!/bin/bash
# KeyShot Director - macOS start script (also used by "Start KeyShot Director.command").
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd -P)"
cd "$APP_DIR"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install the current LTS from https://nodejs.org."
  read -r -p "Press Return to close. " _
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $(node --version))."
  read -r -p "Press Return to close. " _
  exit 1
fi

# Stop a previous copy of this app that is still running (it only touches the process recorded by this folder's own marker).
node "$APP_DIR/tools/stop.js" || true
echo "Starting KeyShot Director ..."
while true; do
  KD_OPEN=1 node "$APP_DIR/server/server.js"
  result=$?
  # exit code 3 = "Restart" was pressed in the page
  [ "$result" -eq 3 ] || break
done
echo
echo "KeyShot Director has stopped. Close this window when you are ready."
read -r -p "Press Return to close. " _
