#!/bin/bash
# Double-click to install. If macOS refuses to open this file, open Terminal in this folder and run:  bash install-mac.sh
cd "$(dirname "$0")" || exit 1
bash ./install-mac.sh
status=$?
echo
read -r -p "Press Return to close. " _
exit $status
