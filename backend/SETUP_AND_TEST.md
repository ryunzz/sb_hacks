# Setup and Run Guide for Gemini Computer Use Agent

Follow these steps to set up the backend and run tests properly.

## 1. Prerequisites (Check First)

Ensure you have:
*   **Google Chrome** installed.
*   **Python 3.8+** installed.
*   A **Gemini API Key** from [AI Studio](https://aistudio.google.com/).

## 2. One-Time Setup

Run these commands in your terminal (from the project root):

### Set up Backend Environment
```bash
# Go to backend directory
cd backend

# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

### Set up API Key
Create a file named `gemini_api_key` in the `backend/` folder and paste your key inside:
```bash
echo "YOUR_ACTUAL_API_KEY" > gemini_api_key
```

### Load Chrome Extension
1.  Open Chrome and go to `chrome://extensions/`.
2.  Enable **Developer mode** (top right).
3.  Click **Load unpacked**.
4.  Select the **root folder** of this project (where `manifest.json` is).

## 3. Running the Agent (Daily Workflow)

You need **two separate terminals** running.

### Terminal 1: Launch Chrome with Remote Debugging
**Close all existing Chrome windows first.** Then run:

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Windows (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222
```

*Verify Chrome is ready by visiting http://127.0.0.1:9222/json in the new window. You should see JSON text.*

### Terminal 2: Start Backend Server
```bash
cd backend
source venv/bin/activate
python websocket_server.py
```
*You should see `[WebSocket] ✓ Server running on ws://localhost:8000`.*

## 4. How to Test

1.  In the Chrome window you launched (Terminal 1), click the **Vision Agent extension icon**.
2.  Open the side panel.
3.  Type a command like:
    *   "Click the search box" (to test mouse movement - look for the red circle!)
    *   "Go to google.com and search for cats"
4.  Watch the terminal output for logs and the browser for actions.

## 5. Troubleshooting

*   **"Connection refused"**: Make sure `websocket_server.py` is running.
*   **"Failed to connect to Chrome"**: Make sure Chrome was started with the `--remote-debugging-port=9222` flag and no other Chrome instances were open.
*   **Agent says it did it, but nothing happened**: We just enabled "Mouse Highlighting". If you don't see a red circle moving, the agent isn't actually connecting to the visible tab. Restart Chrome and the backend.
