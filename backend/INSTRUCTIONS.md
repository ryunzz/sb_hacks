# Setup and Run Instructions

Complete guide to set up and run the Gemini Computer Use Agent backend.

---

## Prerequisites

- Python 3.8 or higher
- Google Chrome browser
- Gemini API key (get from https://aistudio.google.com/)

---

## One-Time Setup (Do Once)

### Step 1: Create Virtual Environment

```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
python3 -m venv venv
```

### Step 2: Activate Virtual Environment

```bash
source venv/bin/activate
```

You should see `(venv)` appear at the start of your terminal prompt.

### Step 3: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 4: Install Playwright Browsers

```bash
playwright install chromium
```

### Step 5: Create API Key File

**Get your Gemini API key:** https://aistudio.google.com/app/apikey

```bash
echo "paste_your_actual_api_key_here" > gemini_api_key
```

**Verify it was created:**
```bash
cat gemini_api_key
```
(Should display your API key)

### Step 6: Load Chrome Extension (One Time)

1. Open Chrome
2. Go to: `chrome://extensions/`
3. Toggle **Developer mode** ON (top-right)
4. Click **Load unpacked**
5. Select folder: `/Users/zixiangzheng/ryunzz/sb_hacks/`
6. Extension should appear in toolbar

---

## Running the System (Every Time)

You need **3 terminals** running simultaneously:

### Terminal 1: Launch Chrome with Remote Debugging

**Close all Chrome windows first:**
```bash
killall "Google Chrome" 2>/dev/null || true
```

**Launch Chrome with debugging enabled:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Verify it works:**
- Open new Chrome tab
- Go to: http://localhost:9222/json
- Should see JSON listing all tabs ✓

**Keep this terminal running!**

---

### Terminal 2: Start Backend Server

```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
source venv/bin/activate
python websocket_server.py
```

**Expected output:**
```
============================================================
Gemini Computer Use Agent - WebSocket Server
============================================================

[WebSocket] ✓ Server running on ws://localhost:8000
```

**Keep this terminal running!**

---

### Terminal 3: Use the Extension

1. In Chrome, click the extension icon in toolbar
2. Open side panel (should appear on right)
3. Type a task, for example:
   ```
   Go to github.com
   ```
4. Press Enter or click Send

**Expected behavior:**
- Backend terminal shows: `[WebSocket] Received task: Go to github.com`
- Chrome navigates to GitHub
- Extension shows narration messages
- Task completes with success message

---

## Quick Test Tasks

### Test 1: Basic Navigation
```
Go to github.com
```
Should navigate to GitHub and complete.

### Test 2: Search
```
Go to Google and search for Python tutorials
```
Should open Google, type search, and press enter.

### Test 3: Multi-Step
```
Go to Wikipedia and search for artificial intelligence
```
Should navigate to Wikipedia and perform search.

---

## Troubleshooting

### "Failed to connect to Chrome"

**Problem:** Backend can't connect to Chrome.

**Fix:**
```bash
# Check if Chrome is running with debugging
# Open in browser: http://localhost:9222/json
# Should show JSON with all tabs

# If not working, restart Chrome:
killall "Google Chrome"
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

### "Connection refused" (WebSocket)

**Problem:** Extension can't connect to backend.

**Fix:**
```bash
# Make sure backend is running:
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
source venv/bin/activate
python websocket_server.py

# Should show: [WebSocket] ✓ Server running on ws://localhost:8000
```

### "Missing API key"

**Problem:** No `gemini_api_key` file.

**Fix:**
```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
echo "your_actual_api_key_here" > gemini_api_key
cat gemini_api_key  # Verify it's there
```

### Agent does nothing / No response

**Problem:** Extension not connected.

**Fix:**
1. Check Chrome extension console (F12 → Console tab)
2. Look for WebSocket errors
3. Verify backend shows: `[WebSocket] Client connected`

### "ModuleNotFoundError"

**Problem:** Virtual environment not activated or dependencies not installed.

**Fix:**
```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
source venv/bin/activate  # Activate venv
pip install -r requirements.txt  # Reinstall dependencies
```

---

## Stopping the System

### Stop Backend Server
In Terminal 2, press: `Ctrl+C`

### Stop Chrome
In Terminal 1, press: `Ctrl+C`
Or just close Chrome normally.

### Deactivate Virtual Environment
In any terminal:
```bash
deactivate
```

---

## Quick Start Script (Optional)

Create a file `start.sh` in the `backend/` folder:

```bash
#!/bin/bash

echo "=== Starting Gemini CUA Agent ==="
echo ""

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "ERROR: Virtual environment not found!"
    echo "Run setup first:"
    echo "  python3 -m venv venv"
    echo "  source venv/bin/activate"
    echo "  pip install -r requirements.txt"
    exit 1
fi

# Activate venv
source venv/bin/activate

# Check API key
if [ ! -f "gemini_api_key" ]; then
    echo "ERROR: gemini_api_key file not found!"
    echo "Create it with:"
    echo "  echo 'your_api_key' > gemini_api_key"
    exit 1
fi

# Start server
echo "Starting WebSocket server..."
python websocket_server.py
```

Make it executable:
```bash
chmod +x start.sh
```

Then run:
```bash
./start.sh
```

---

## Daily Workflow

Once setup is complete, your daily workflow is:

**Terminal 1:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Terminal 2:**
```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
source venv/bin/activate
python websocket_server.py
```

**Chrome Extension:**
- Click extension icon
- Send tasks
- Done!

---

## For Other Operating Systems

### Linux

**Chrome with debugging:**
```bash
google-chrome --remote-debugging-port=9222 &
```

**Everything else same as macOS**

### Windows

**Chrome with debugging (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**Virtual environment:**
```powershell
cd C:\path\to\sb_hacks\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python websocket_server.py
```

---

## Advanced

### Change Maximum Turns

Edit `gemini_cua_agent.py`:
```python
self.MAX_TURNS = 100  # Change to desired value
```

### View Detailed Logs

```bash
python websocket_server.py | tee backend.log
```

Logs saved to `backend.log`

### Test Without Extension

You can test the agent programmatically:
```python
from gemini_cua_agent import GeminiCUAAgent

agent = GeminiCUAAgent()
agent.initialize()

def callback(msg):
    print(f"Agent: {msg}")

agent.run_task("Go to github.com", callback)
```

---

## Need Help?

- Check `README.md` for detailed documentation
- Check `FIXED.md` for common technical issues
- Check `CLAUDE_PLEASE.md` for implementation details
- Review backend terminal logs for error messages
- Check extension console (F12 in Chrome) for errors

---

## Summary Checklist

Setup (one time):
- [ ] Create virtual environment
- [ ] Install dependencies
- [ ] Install Playwright browsers
- [ ] Create `gemini_api_key` file
- [ ] Load Chrome extension

Running (every time):
- [ ] Terminal 1: Launch Chrome with `--remote-debugging-port=9222`
- [ ] Terminal 2: Start backend with `python websocket_server.py`
- [ ] Terminal 3: Use extension to send tasks

That's it! 🚀
