#!/bin/bash
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
node tools/stop.js
echo
read -r -p "Press Return to close. " _
