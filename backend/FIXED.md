# Fix Applied: Sync Playwright + Asyncio Compatibility

## Problem 1: "It looks like you are using Playwright Sync API inside the asyncio loop"
The error occurred because:
1. The agent uses **sync Playwright** (`sync_playwright()`)
2. The WebSocket server uses **asyncio**
3. Mixing these two doesn't work - sync Playwright detects asyncio event loop and refuses to run

## Problem 2: "'NoneType' object has no attribute 'get_active_page'"
After fixing Problem 1, this error occurred because:
1. Agent initialization (`agent.initialize()`) was called in async context
2. The initialization failed silently (sync Playwright refused to run)
3. `self.tab_manager` never got created (stayed `None`)
4. When `run_task()` tried to use `tab_manager.get_active_page()`, it crashed

## Solution Applied

### 1. Updated `websocket_server.py`
- Added `ThreadPoolExecutor` to run sync code completely outside asyncio
- Added message queue (`queue.Queue()`) for thread-safe communication
- Changed from `asyncio.to_thread()` to `loop.run_in_executor(self.executor, ...)`
- Added `process_message_queue()` method to relay messages from agent thread to WebSocket clients
- **Fixed:** Moved `agent.initialize()` into thread pool executor (was causing silent failure)

**Key Changes:**
```python
# Before (doesn't work - runs in asyncio):
self.agent = GeminiCUAAgent()
self.agent.initialize()  # ❌ Fails silently, tab_manager stays None

# After (works - runs in thread pool):
self.agent = GeminiCUAAgent()
loop = asyncio.get_event_loop()
await loop.run_in_executor(
    self.executor,
    self.agent.initialize  # ✓ Runs outside asyncio
)

# Task execution:
# Before (doesn't work):
await asyncio.to_thread(self.agent.run_task, task, self.send_to_clients)

# After (works):
def thread_safe_callback(message):
    self.message_queue.put(message)

loop = asyncio.get_event_loop()
await loop.run_in_executor(
    self.executor,
    self.agent.run_task,
    task,
    thread_safe_callback
)
```

### 2. Updated `gemini_cua_agent.py`
- Removed all `asyncio.create_task()` calls
- Changed callback to synchronous (just puts messages in queue)
- Removed async imports

**Key Changes:**
```python
# Before (doesn't work in sync context):
import asyncio
asyncio.create_task(
    self.send_callback({"type": "narration", "text": "..."})
)

# After (works):
self.send_callback({"type": "narration", "text": "..."})
```

## How It Works Now

```
Chrome Extension
    ↓ WebSocket (asyncio)
    ↓
WebSocket Server (async)
    ↓
    ├─ Initialization (run_in_executor)
    │   └─→ [Thread Pool - NO asyncio]
    │       └─→ agent.initialize()
    │           ├─→ browser_manager.connect() (sync Playwright)
    │           └─→ tab_manager setup
    │
    └─ Task Execution (run_in_executor)
        └─→ [Thread Pool - NO asyncio]
            └─→ agent.run_task()
                ├─→ sync Playwright operations
                └─→ sync callback → Queue
                    ↓
WebSocket Server reads queue → sends to clients (async)
```

**Key Points:**
1. **Agent creation** happens in async context (OK - just creates object)
2. **Agent initialization** happens in thread pool (REQUIRED - uses sync Playwright)
3. **Agent task execution** happens in thread pool (REQUIRED - uses sync Playwright)
4. **Messages flow through queue** (thread-safe communication between sync and async)

## Testing

Now you can run:
```bash
# Terminal 1: Chrome with remote debugging
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Terminal 2: Backend server
cd backend
source venv/bin/activate
python websocket_server.py
```

The error should be gone! ✓
