#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

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

while true; do
  KD_OPEN=1 node server/server.js
  result=$?
  [ "$result" -eq 3 ] || break
done
echo
echo "KeyShot Director has stopped. Close this window when you are ready."
read -r -p "Press Return to close. " _
