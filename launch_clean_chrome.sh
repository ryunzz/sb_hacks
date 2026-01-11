#!/bin/bash

# Kill existing Chrome instances to avoid conflicts
pkill -f "Google Chrome"

echo "Starting Chrome with:"
echo " - Remote Debugging (Port 9222)"
echo " - Fresh User Profile (in /tmp)"
echo " - Loaded Extension (from project root)"

# Launch Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="/tmp/chrome_dev_profile_$(date +%s)" \
  --load-extension="/Users/zixiangzheng/ryunzz/sb_hacks" \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1440,900 \
  &

echo "Waiting for Chrome to start..."
sleep 2

# Verify port
if lsof -i :9222 > /dev/null; then
    echo "✅ Chrome is listening on port 9222"
else
    echo "❌ Error: Chrome failed to bind port 9222"
    exit 1
fi
