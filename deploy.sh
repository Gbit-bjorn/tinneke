#!/bin/bash
set -e
# Uitgevoerd na git pull via Plesk Git hook
cd "$(dirname "$0")"
npm install --production --quiet
# Plesk/Passenger herstart via touch
touch tmp/restart.txt
echo "[$(date)] Deploy succesvol"
