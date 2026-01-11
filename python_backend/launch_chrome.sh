#!/bin/bash
# Launch Chrome with Chrome DevTools Protocol (CDP) enabled
# Uses your DEFAULT Chrome profile (with all extensions, logins, bookmarks)

echo "🚀 Vision Agent - Chrome CDP Launcher"
echo ""

# Check if Chrome is already running
if pgrep -f "Google Chrome" > /dev/null; then
    echo "⚠️  Chrome is already running!"
    echo ""
    echo "To use Vision Agent with CDP, you need to:"
    echo "1. Close ALL Chrome windows completely"
    echo "2. Run this script again"
    echo ""
    echo "This will launch Chrome with your default profile + CDP enabled."
    echo "All your extensions, logins, and bookmarks will be available!"
    echo ""
    exit 1
fi

# Kill any existing Chrome instances with CDP
pkill -f "remote-debugging-port=9222" 2>/dev/null

# Wait a moment for processes to clean up
sleep 2

echo "Launching Chrome with CDP using your DEFAULT profile..."
echo ""
echo "This Chrome will have:"
echo "  ✅ All your extensions (including Vision Agent if already installed)"
echo "  ✅ All your Google account logins"
echo "  ✅ All your bookmarks and history"
echo "  ✅ All your saved passwords"
echo ""

# Launch Chrome with CDP using DEFAULT profile
# No --user-data-dir means it uses your normal Chrome profile
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check \
  > /dev/null 2>&1 &

sleep 2

echo "✅ Chrome launched with CDP on port 9222"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Next Steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. If Vision Agent extension is NOT installed yet:"
echo "   • Go to chrome://extensions/"
echo "   • Enable 'Developer mode' (top right)"
echo "   • Click 'Load unpacked'"
echo "   • Select: /Users/zixiangzheng/ryunzz/sb_hacks/"
echo ""
echo "2. Configure extension API keys:"
echo "   • Click Vision Agent extension icon"
echo "   • Click settings/gear icon"
echo "   • Enter Gemini API key"
echo "   • Enter Deepgram API key"
echo "   • Click 'Save Settings'"
echo ""
echo "3. Start the Python backend:"
echo "   cd python_backend"
echo "   source venv/bin/activate"
echo "   python main.py"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 To verify CDP is running: curl http://localhost:9222/json"
echo "🛑 To stop: pkill -f \"remote-debugging-port=9222\""
echo ""
