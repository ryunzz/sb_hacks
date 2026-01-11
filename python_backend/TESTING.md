# Vision Agent - Testing Guide

Complete guide for testing the Gemini 2.5 Computer Use integration.

---

## Prerequisites

Before testing, ensure you have:

- ✅ Python 3.8+ installed
- ✅ Google Chrome installed
- ✅ Gemini API key (from https://ai.google.dev/)
- ✅ Deepgram API key (from https://deepgram.com/)

---

## Setup Steps

### 1. Install Python Dependencies

```bash
cd python_backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

### 2. Configure Environment Variables

```bash
cp .env.template .env
# Edit .env and add your GEMINI_API_KEY
```

### 3. Launch Chrome with CDP

```bash
./launch_chrome.sh
```

You should see:
```
🚀 Launching Chrome with CDP on port 9222...
✅ Chrome launched with CDP on port 9222
```

**IMPORTANT:** Keep this Chrome window open. This is the browser instance the agent will control.

### 4. Load Extension in CDP Chrome

1. In the CDP Chrome window that just opened, go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the extension directory (parent of `python_backend/`)
5. The Vision Agent extension should now appear

### 5. Configure Extension API Keys

1. Click the Vision Agent extension icon
2. Click the settings/gear icon
3. Enter your Gemini API key
4. Enter your Deepgram API key (for voice)
5. Click "Save Settings"

### 6. Start Python Backend

In a new terminal (keep Chrome running):

```bash
cd python_backend
source venv/bin/activate
python main.py
```

You should see:
```
[Init] Starting Vision Agent backend...
[Init] WebSocket server: ws://localhost:8000
[Init] Chrome CDP: http://localhost:9222

[Init] Initializing Playwright CDP controller...
[Init] ✓ Connected to Chrome via CDP
[Init] Initializing Gemini Computer Use agent...
[Init] ✓ Gemini agent initialized
[Init] ✓ WebSocket server starting on port 8000

============================================================
🚀 Vision Agent Backend is READY!
============================================================
```

---

## Test Scenarios

### Test 1: Basic Navigation

**Goal:** Verify the agent can navigate to a URL

1. Open the CDP Chrome window
2. Click the Vision Agent extension icon (opens side panel)
3. Type or say: **"Go to github.com"**
4. Expected behavior:
   - Backend logs show: `[Gemini] Getting next action for goal: Go to github.com`
   - Browser navigates to github.com
   - Agent narrates: "I'm navigating to github.com" (or similar)
   - Completion message: "Task completed: Navigated to GitHub"

**Logs to check:**
```
[WebSocket] Received: user_message
[Gemini] Starting task: Go to github.com
[Gemini] Narration (before_action): I'll navigate to GitHub...
[Playwright] navigate: https://github.com
[Gemini] Narration (after_action): Successfully navigated to GitHub
[WebSocket] Broadcasted narration to 1 client(s)
```

### Test 2: Click Interaction

**Goal:** Verify the agent can click elements

1. Navigate to google.com first: "Go to google.com"
2. Then say: **"Click the search box"**
3. Expected behavior:
   - Agent takes screenshot
   - Identifies search box coordinates
   - Clicks the element
   - Narrates actions before and after

**Logs to check:**
```
[Gemini] Action: click_at(500, 300)
[Playwright] click_at: x=500, y=300 (pixel: 720, 270)
```

### Test 3: Type Text

**Goal:** Verify the agent can type into inputs

1. With Google open and search box active
2. Say: **"Type 'Python tutorials' and press enter"**
3. Expected behavior:
   - Agent types "Python tutorials"
   - Presses Enter key
   - Search results appear

### Test 4: Complex Multi-Step Task

**Goal:** Verify autonomous task execution

1. Say: **"Help me search for Claude AI on Google"**
2. Expected behavior:
   - Agent navigates to Google (if not there)
   - Clicks search box
   - Types "Claude AI"
   - Presses Enter
   - Narrates each step
   - Completes with summary

**This tests:**
- Multi-step planning
- Autonomous loop
- Context retention
- Narration at each stage

### Test 5: User Interruption

**Goal:** Verify interruption handling

1. Start a long task: **"Go to github.com and search for Python projects"**
2. While agent is working, immediately say: **"Stop, go to google.com instead"**
3. Expected behavior:
   - Agent stops current task
   - Logs show: `[WebSocket] Received: interrupt`
   - Agent starts new task (go to google.com)
   - Previous task abandoned

**Logs to check:**
```
[WebSocket] Interruption: Stop, go to google.com instead
[Gemini] Handling interruption - stopping current task
[Gemini] Starting new task: go to google.com instead
```

### Test 6: Voice Narration

**Goal:** Verify TTS (Text-to-Speech) works

1. Say or type: **"Describe this page"**
2. Expected behavior:
   - Agent captures screenshot
   - Describes what's on screen
   - **Voice narration plays** (you hear the description)
   - Text appears in side panel chat

**This tests:**
- Deepgram TTS integration
- Narration callback
- Voice output

### Test 7: Error Handling

**Goal:** Verify graceful error handling

1. Stop the Python backend (Ctrl+C)
2. Try sending a message: **"Go to github.com"**
3. Expected behavior:
   - Extension detects backend is down
   - Shows error: "Python backend not connected. Please ensure the backend server is running."
   - No crash or hang

### Test 8: Screen Description (Vision)

**Goal:** Verify Gemini Vision still works for passive observation

1. Navigate to any website
2. Say: **"What do you see on this page?"** or **"Describe this screen"**
3. Expected behavior:
   - Routes to OLD Gemini Vision (in background.js)
   - Does NOT go through Computer Use backend
   - Returns description quickly

**This ensures:**
- Message routing works correctly
- "describe" keywords route to vision, not computer use
- Both systems coexist

---

## Debugging Tips

### Check WebSocket Connection

```bash
# In terminal
curl http://localhost:8000

# Should return connection upgrade error (expected)
# Just verifies server is listening
```

### Check CDP Connection

```bash
curl http://localhost:9222/json

# Should return JSON array of open tabs
```

### View Backend Logs

All logs have prefixes:
- `[Init]` - Startup
- `[WebSocket]` - WebSocket server
- `[Gemini]` - Gemini agent
- `[Playwright]` - Browser controller

### View Extension Logs

1. **Service Worker (background.js):**
   - `chrome://serviceworker-internals/`
   - Find Vision Agent, click "Inspect"

2. **Side Panel (sidepanel.js):**
   - Right-click side panel
   - Click "Inspect"

3. **Content Script (content.js):**
   - Open DevTools on the webpage
   - Console tab

### Common Issues

**"Failed to connect to Chrome via CDP"**
- Chrome with CDP not running
- Solution: Run `./launch_chrome.sh`

**"GEMINI_API_KEY not found"**
- `.env` file missing or empty
- Solution: Copy `.env.template` to `.env` and add key

**"Python backend not connected"**
- Backend not running or crashed
- Solution: Restart `python main.py`

**"No response received from background"**
- Extension API keys not configured
- Solution: Open extension settings, add Gemini + Deepgram keys

**Agent not narrating**
- Deepgram API key missing
- Mute button enabled
- Solution: Check extension settings, unmute if needed

---

## Success Criteria

✅ All 8 test scenarios pass
✅ Backend starts without errors
✅ Chrome CDP connection works
✅ WebSocket connects (check backend logs)
✅ Voice narration plays through speakers
✅ Multi-step tasks complete autonomously
✅ Interruptions work correctly
✅ No crashes or hangs

---

## Performance Expectations

- **Navigation:** ~2-3 seconds per action
- **Click/Type:** ~1-2 seconds per action
- **Screenshot + Analysis:** ~1-3 seconds
- **Voice narration latency:** <500ms (Deepgram Aura)
- **Complete task (3-5 steps):** ~10-15 seconds

---

## Next Steps After Testing

1. Test more complex workflows (e.g., "pay my credit card bill")
2. Add error recovery mechanisms
3. Implement conversation persistence
4. Add action history viewer in UI
5. Optimize screenshot frequency
6. Add unit tests for each component

---

**Questions or Issues?**

Check the main plan file: `~/.claude/plans/nested-brewing-liskov.md`
Or review: `claude_files2/WORKFLOW.md`
