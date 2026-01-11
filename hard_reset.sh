#!/bin/bash

# Hard Reset Script for Vision Agent Environment

echo "🛑 Stopping everything..."
pkill -f "python websocket_server.py"
pkill -f "Google Chrome"

echo "🧹 Cleaning up..."
rm -rf /tmp/chrome_dev_profile*

echo "🚀 Launching Chrome with Debugging (Port 9222)..."
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="/tmp/chrome_dev_profile_$(date +%s)" \
  --load-extension="$(pwd)" \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1440,900 \
  > /dev/null 2>&1 &

echo "⏳ Waiting for Chrome to initialize..."
sleep 3

# Verify Port
if lsof -i :9222 > /dev/null; then
    echo "✅ Chrome is ready on port 9222"
else
    echo "❌ ERROR: Chrome failed to open debugging port 9222."
    echo "   Please try running this script again."
    exit 1
fi

echo "🔌 Starting Backend Server..."
cd backend
source venv/bin/activate
python websocket_server.py
