# Vision Agent - Python Backend

Python backend for Gemini 2.5 Computer Use integration with Vision Agent Chrome Extension.

## Setup

### 1. Create Virtual Environment

```bash
cd python_backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
playwright install chromium
playwright install-deps chromium
```

### 3. Configure Environment

Copy `.env.template` to `.env` and add your Gemini API key:

```bash
cp .env.template .env
```

Edit `.env` and replace `your_gemini_api_key_here` with your actual API key from https://ai.google.dev/

### 4. Launch Chrome with CDP (Using Your Default Profile)

**IMPORTANT:** Close ALL Chrome windows first!

```bash
# Close Chrome completely
pkill -f "Google Chrome"

# Launch Chrome with CDP (uses your default profile)
./launch_chrome.sh
```

This will launch Chrome with:
- ✅ Your default Chrome profile (all extensions, logins, bookmarks)
- ✅ CDP enabled on port 9222
- ✅ Vision Agent extension already installed (if you had it before)

**Manual launch:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222
  # No --user-data-dir = uses your default profile!
```

### 5. Start the Backend

```bash
python main.py
```

You should see:
```
[Init] Starting Vision Agent backend...
[Init] WebSocket server: ws://localhost:8000
[Init] Chrome CDP: http://localhost:9222
[Init] ✓ Connected to Chrome via CDP
[Init] ✓ Gemini agent initialized
[Init] ✓ WebSocket server starting on port 8000
```

### 6. Verify/Load Chrome Extension

**In the Chrome window that just opened:**

1. Go to `chrome://extensions/`
2. Look for "Vision Agent"

**If already there:** ✅ Skip to step 7!

**If NOT there:**
1. Enable "Developer mode" (toggle top-right)
2. Click "Load unpacked"
3. Select: `/Users/zixiangzheng/ryunzz/sb_hacks/`
4. Configure API keys (click extension icon → settings → add Gemini + Deepgram keys)

The extension will auto-connect to the Python backend via WebSocket.

## Testing

Verify the WebSocket server is running:
```bash
curl http://localhost:8000
```

Verify Chrome CDP is accessible:
```bash
curl http://localhost:9222/json
```

## Troubleshooting

See the main plan file at `/Users/zixiangzheng/.claude/plans/nested-brewing-liskov.md` for detailed troubleshooting steps.

## Architecture

- `main.py` - Entry point and orchestration
- `websocket_server.py` - WebSocket server for Extension ↔ Backend communication
- `gemini_agent.py` - Gemini 2.5 Computer Use API client
- `playwright_controller.py` - Playwright CDP controller for browser automation
- `config.py` - Configuration management
- `utils/` - Helper utilities
