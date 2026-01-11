# Gemini Computer Use Agent - Backend

This backend integrates Google's Gemini Computer Use API with the Chrome extension for autonomous web browsing.

## Features

- **Logged-in Session Management**: Connects to existing Chrome via remote debugging
- **Unlimited Turns**: No artificial turn limits, continues until task complete or user interrupts
- **Multi-Tab Support**: Works on any browser tab, handles tab switching
- **Real-time Narration**: Sends action descriptions to extension for text-to-speech
- **Error Handling**: Graceful error recovery with user-friendly messages
- **Interruption Support**: User can interrupt and redirect agent mid-task

## Architecture

```
Chrome Extension (existing: background.js, sidepanel.js)
    ↓ WebSocket (ws://localhost:8000)
Python Backend
├── websocket_server.py      # WebSocket handler (entry point)
├── gemini_cua_agent.py      # Core agent with unlimited turns
├── browser_manager.py        # Chrome CDP connection
└── tab_manager.py           # Multi-tab handling
    ↓ Chrome DevTools Protocol
Chrome Browser (--remote-debugging-port=9222)
```

## Prerequisites

- Python 3.8 or higher
- Google Chrome browser
- Gemini API key (get from [Google AI Studio](https://aistudio.google.com/))
- Chrome extension loaded (see main project README)

## Installation

### 1. Install Python Dependencies

```bash
cd backend
pip install -r requirements.txt
playwright install chromium
```

### 2. Create API Key File

Create a file named `gemini_api_key` in the `backend/` folder:

```bash
echo "your_gemini_api_key_here" > gemini_api_key
```

**Get your API key**: https://aistudio.google.com/

### 3. Verify Installation

```bash
python -c "from google import genai; print('✓ google-genai installed')"
python -c "from playwright.sync_api import sync_playwright; print('✓ playwright installed')"
python -c "import websockets; print('✓ websockets installed')"
```

## Running the System

### Terminal 1: Launch Chrome with Remote Debugging

**macOS**:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Linux**:
```bash
google-chrome --remote-debugging-port=9222 &
```

**Windows**:
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**Verify Chrome is running**: Open http://localhost:9222/json in a browser. You should see a JSON list of all open tabs.

### Terminal 2: Start Backend Server

```bash
cd backend
python websocket_server.py
```

You should see:
```
============================================================
Gemini Computer Use Agent - WebSocket Server
============================================================

[WebSocket] Starting server on ws://localhost:8000
[WebSocket] ✓ Server running on ws://localhost:8000
```

### Terminal 3: Use the Extension

1. Load the Chrome extension (see main README)
2. Click extension icon in Chrome toolbar
3. Open side panel
4. Enter a task, for example:
   - "Go to GitHub"
   - "Search for Python tutorials on Google"
   - "Go to Reddit and summarize the top post"

The agent will execute the task autonomously, narrating each action.

## Usage

### Basic Tasks

```
"Go to github.com"
"Search for machine learning tutorials"
"Navigate to Twitter and check trending topics"
```

### Multi-Step Tasks

```
"Go to Google, search for 'best restaurants near me', and click the first result"
"Browse Reddit, find the top post on r/programming, and summarize it"
"Go to LinkedIn, search for software engineer jobs, and open the first listing"
```

### Interrupting Tasks

While a task is running, type a new instruction in the extension:
```
"Stop, go to YouTube instead"
"Cancel that, navigate to Twitter"
```

The agent will immediately switch to the new task.

## Project Structure

```
backend/
├── websocket_server.py       # WebSocket server (main entry point)
├── gemini_cua_agent.py       # Core agent implementation
├── browser_manager.py         # Chrome CDP connection manager
├── tab_manager.py            # Multi-tab handling
├── requirements.txt          # Python dependencies
├── gemini_api_key            # API key (create this, gitignored)
└── README.md                 # This file
```

## Configuration

### Modify Turn Limit

Edit `gemini_cua_agent.py`:
```python
self.MAX_TURNS = 100  # Change to desired value
```

### Change Screen Resolution

Edit `gemini_cua_agent.py`:
```python
SCREEN_WIDTH = 1440
SCREEN_HEIGHT = 900
```

**Important**: Resolution must match your actual Chrome window size for accurate coordinate mapping.

### Change WebSocket Port

Edit `websocket_server.py`:
```python
server = WebSocketServer(host="localhost", port=8000)  # Change port here
```

Then update `background.js` in the Chrome extension:
```javascript
const WS_URL = 'ws://localhost:8000';  // Update to match
```

## Troubleshooting

### "Failed to connect to Chrome"

**Problem**: Backend cannot connect to Chrome via CDP.

**Solutions**:
1. Verify Chrome is running with `--remote-debugging-port=9222`
2. Check http://localhost:9222/json - should show open tabs
3. Close all Chrome instances and restart with debug flag
4. Try a different port (9223, 9224, etc.)

### "No browser context found"

**Problem**: Chrome is running but no context available.

**Solutions**:
1. Make sure you have at least one tab open in Chrome
2. Don't use Chrome's Guest mode
3. Don't use --incognito mode

### "Agent is already running"

**Problem**: Extension sends a new task while agent is busy.

**Solutions**:
1. Wait for current task to complete
2. Send an interrupt message to stop current task
3. Restart backend server to reset state

### "Connection refused"

**Problem**: Extension cannot connect to WebSocket server.

**Solutions**:
1. Make sure backend server is running (`python websocket_server.py`)
2. Check server is on port 8000 (or update WS_URL in background.js)
3. Check firewall settings

### "Missing API key"

**Problem**: `gemini_api_key` file not found.

**Solutions**:
1. Create the file: `echo "your_key" > backend/gemini_api_key`
2. Make sure you're in the `backend/` folder
3. Get an API key from https://aistudio.google.com/

### Agent stops at turn 10

**Problem**: Still using hardcoded turn limit.

**Solutions**:
1. Check `gemini_cua_agent.py` - should use `while turn < self.MAX_TURNS:`
2. Make sure you're running the correct version of the code

### No narration in extension

**Problem**: Extension doesn't display/speak agent actions.

**Solutions**:
1. Check extension console for errors
2. Verify WebSocket connection is open
3. Check `background.js` is receiving messages

### Coordinates are off

**Problem**: Agent clicks in wrong locations.

**Solutions**:
1. Ensure SCREEN_WIDTH and SCREEN_HEIGHT match your browser
2. Don't resize browser window during agent operation
3. Use full-screen mode for consistency

## API Usage and Costs

**Gemini 2.5 Computer Use API**:
- Model: `gemini-2.5-computer-use-preview-10-2025`
- Pricing: Check [Google AI Pricing](https://ai.google.dev/pricing)
- Each turn includes: screenshot upload + function calls
- Typical task: 10-30 turns depending on complexity

**Estimated Costs** (approximate):
- Simple task (5 turns): ~$0.05-0.10
- Medium task (15 turns): ~$0.15-0.30
- Complex task (30 turns): ~$0.30-0.60

**Cost Optimization Tips**:
- Use clear, specific task descriptions
- Interrupt stuck tasks early
- Lower MAX_TURNS for simple tasks
- Reduce screenshot resolution if acceptable

## Development

### Running in Development Mode

```bash
# Watch logs
python websocket_server.py | tee backend.log

# Debug mode (verbose logging)
# Add print statements to agent code as needed
```

### Testing Individual Components

**Test BrowserManager**:
```python
from browser_manager import BrowserManager
bm = BrowserManager()
context = bm.connect()
print(f"Connected! {len(context.pages)} tabs open")
bm.disconnect()
```

**Test TabManager**:
```python
from browser_manager import BrowserManager
from tab_manager import TabManager

bm = BrowserManager()
context = bm.connect()
tm = TabManager(context)
page = tm.get_active_page()
print(f"Active page: {page.url}")
print(tm.get_tab_context_string())
```

### Adding New Actions

Edit `exec_calls()` in `gemini_cua_agent.py`:
```python
elif name == "your_new_action":
    # Implement action
    page.do_something(args["param"])
```

Add narration in `generate_narration()`:
```python
elif name == "your_new_action":
    return "Doing something cool"
```

## Security Considerations

- API keys stored in plain text (gitignored)
- Agent has full control over browser
- Can access logged-in sessions
- User should monitor agent actions
- Interruption available at any time

**Recommendations**:
- Don't share API keys
- Don't run untrusted tasks
- Monitor agent behavior
- Use separate Chrome profile for testing
- Review actions before sensitive operations

## Contributing

See main project README for contribution guidelines.

## License

See main project LICENSE file.

## Support

For issues, questions, or feature requests:
- Check CLAUDE_PLEASE.md for implementation details
- Review troubleshooting section above
- Check Chrome extension console for errors
- Verify Chrome remote debugging is working

## Additional Resources

- [Gemini Computer Use Docs](https://ai.google.dev/gemini-api/docs/vision)
- [Playwright CDP](https://playwright.dev/python/docs/api/class-browser#browser-connect-over-cdp)
- [WebSockets Python](https://websockets.readthedocs.io/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
