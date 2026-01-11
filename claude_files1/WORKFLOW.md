# Vision Agent - Workflow Documentation

**Last Updated:** 2026-01-10 (Added rate limiting & enhanced error handling)
**For:** Claude Code Agents & Developers

---

## Project Overview

Vision Agent is a Chrome Extension (Manifest V3) that provides AI-powered accessibility features for blind and low-vision users. It combines voice interaction, screen understanding, and web automation using Google Gemini 2.0 Flash and Deepgram Nova-2.

**Core Capabilities:**
- 👁️ Screen Understanding (via screenshot + Gemini Vision)
- 🎤 Voice Input (Deepgram WebSocket streaming STT)
- 🔊 Voice Output (Web Speech API TTS)
- 🤖 Web Automation (AI-driven click/type/scroll actions)
- 💬 Conversational AI (context-aware chat)

---

## File Structure & Responsibilities

### Core Files

#### **manifest.json**
- **Type:** Extension configuration
- **Purpose:** Defines extension metadata, permissions, and component registration
- **Key Configurations:**
  - Permissions: `activeTab`, `scripting`, `tabs`, `storage`, `sidePanel`
  - Host permissions: `<all_urls>` (required for content script injection and screenshots)
  - Background service worker: `background.js` (module type)
  - Content script: `content.js` (runs on all URLs at `document_idle`)
  - Side panel: `sidepanel.html`
  - Options page: `options.html`

#### **background.js** (Service Worker)
- **Type:** Background service worker (ES module)
- **Purpose:** Central orchestration layer - handles all AI/API interactions
- **Key Responsibilities:**
  1. **Gemini Client Management**
     - Initializes GoogleGenerativeAI client with API key from storage
     - Maintains two models: `gemini-2.0-flash-exp` (chat & vision)
     - Auto-loads config on service worker startup (not just install)
  2. **Rate Limiting** ⭐ NEW
     - Tracks API request timestamps in rolling 60-second window
     - Limits to 14 requests/minute (safe buffer for free tier: 15 RPM)
     - Pre-emptively blocks requests before hitting API limit
     - Provides user-friendly wait time messages
  3. **Message Router**
     - Listens to `chrome.runtime.onMessage` from side panel and content scripts
     - Routes messages to appropriate handlers based on `type`:
       - `message` → `handleUserMessage()` - natural language processing
       - `describe` → `describeActiveTab()` - screen description
       - `screenshot` → `captureActiveTab()` - screenshot capture
       - `config_updated` → `updateConfig()` - API key updates
  4. **Conversation Management**
     - Maintains `conversationHistory[]` array for context
     - Manages chat sessions with Gemini
  5. **Action Planning & Execution**
     - Detects action keywords (go to, click, type, scroll)
     - Uses Gemini Vision + screenshot to generate JSON action plans
     - Delegates execution to content script via `chrome.tabs.sendMessage()`
  6. **Screenshot Capture**
     - Uses `chrome.tabs.captureVisibleTab()` to get current tab as base64 PNG
     - Sends to Gemini Vision API for analysis
     - Validates tab URL (blocks chrome:// and chrome-extension:// pages)
  7. **Enhanced Error Handling** ⭐ NEW
     - Detailed logging at every step with `[functionName]` prefixes
     - Specific error messages instead of generic failures
     - Protected page detection with helpful guidance
     - API key validation before attempting requests
     - Network error detection and user-friendly messages
- **Dependencies:**
  - `./lib/generative-ai.js` - Bundled Gemini SDK
  - Chrome Storage API - API key persistence
  - Chrome Tabs API - screenshot and navigation
  - Chrome Scripting API - message passing to content script

#### **content.js** (Content Script)
- **Type:** Content script (injected into all web pages)
- **Purpose:** DOM manipulation and web automation on target pages
- **Key Responsibilities:**
  1. **Action Execution**
     - `handleClick(target)` - Find and click elements
     - `handleType(target, text)` - Type into input fields
     - `handleScroll(target)` - Scroll page or to element
  2. **Element Finding Strategy** (in order of priority):
     - Exact text match on interactive elements
     - Partial text match
     - `aria-label` attribute match
     - `placeholder` attribute match
     - `title` attribute match
     - CSS selector
     - `name` attribute match
  3. **Visual Feedback**
     - Highlights clicked elements with blue outline (3px solid #4f9eff)
  4. **Page Information**
     - `getPageInfo()` - Returns title, URL, form/input/button presence
     - `getInteractiveElements()` - Returns list of clickable/typeable elements
- **Message Handling:**
  - Listens to `chrome.runtime.onMessage` from background script
  - Returns success/failure results to caller
- **Dependencies:** None (pure DOM manipulation)

#### **sidepanel.js** (Side Panel UI Logic)
- **Type:** Side panel script (ES module)
- **Purpose:** User interface logic for voice/text interaction
- **Key Responsibilities:**
  1. **Voice Input (Deepgram)**
     - Push-to-talk interface (mousedown/mouseup, touch events, spacebar)
     - Connects to Deepgram WebSocket: `wss://api.deepgram.com/v1/listen?model=nova-2`
     - Streams audio chunks via MediaRecorder (250ms chunks, webm/opus)
     - Accumulates real-time transcription, sends final transcript on socket close
  2. **Text Input**
     - Manual text entry via input field + send button
     - Enter key support (shift+enter for multiline)
  3. **Message Handling**
     - Sends user messages to background via `chrome.runtime.sendMessage()`
     - Displays loading state ("...") while processing
     - Renders assistant responses in chat UI
  4. **Text-to-Speech**
     - Uses Web Speech API (`speechSynthesis`)
     - Prefers voices: Samantha, Google, Microsoft
     - Mute toggle persisted in storage
  5. **Quick Actions**
     - Pre-defined prompts for common tasks:
       - "Describe Page" - detailed screen description
       - "Summarize" - key content extraction
       - "Is This Safe?" - scam/trustworthiness analysis
  6. **Accessibility Features**
     - ARIA live regions for screen reader announcements
     - Semantic HTML with proper roles
     - Keyboard navigation support
- **Dependencies:**
  - Deepgram WebSocket API
  - Web Speech API (TTS)
  - Chrome Storage API
  - Chrome Runtime Messaging API

#### **sidepanel.html**
- **Type:** UI markup
- **Purpose:** Side panel user interface
- **Key Components:**
  - Header with status display (`aria-live="polite"`)
  - Messages container (`role="log"`, scrollable chat history)
  - Voice button (push-to-talk with mic icon)
  - Text input field with send button
  - Quick action buttons (Describe, Summarize, Safety Check)
  - Settings button (opens options page)
  - Mute toggle button
- **Accessibility:**
  - All interactive elements have `aria-label`
  - Screen reader only text (`.sr-only` class)
  - Semantic HTML5 elements (`header`, `footer`, `main`)

#### **options.js** (Settings Page Logic)
- **Type:** Options page script
- **Purpose:** API key configuration management
- **Key Responsibilities:**
  1. **Load Settings**
     - Reads API keys from `chrome.storage.local` on page load:
       - `geminiApiKey` (required)
       - `deepgramApiKey` (required for voice)
       - `twelveLabsApiKey` (optional, currently unused)
  2. **Save Settings**
     - Persists API keys to `chrome.storage.local`
     - Notifies background script via `config_updated` message
     - Triggers Gemini client re-initialization
  3. **UI Feedback**
     - Shows success/error status messages
     - Temporary status display (3 second auto-hide)
- **Dependencies:**
  - Chrome Storage API
  - Chrome Runtime Messaging API

#### **options.html**
- **Type:** Settings page UI
- **Purpose:** API key input form
- **Components:**
  - Gemini API Key input (password field, required)
  - Deepgram API Key input (password field, required for voice)
  - Twelve Labs API Key input (password field, optional)
  - Save button
  - Status message display
  - Help links to API key generation pages

---

## Data Flow Architecture

### Message Flow Diagram

```
┌─────────────────┐
│   User Input    │
│ (Voice or Text) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│   sidepanel.js          │
│ ┌─────────────────────┐ │
│ │ Voice: Deepgram WS  │ │ ← Streams audio to Deepgram API
│ │ Text: Input field   │ │
│ └─────────────────────┘ │
│         │               │
│         │ sendMessage({ type: 'message', content })
│         ▼               │
└─────────────────────────┘
         │
         │ chrome.runtime.sendMessage
         ▼
┌─────────────────────────────────────────────────┐
│              background.js                      │
│  (Service Worker - Central Intelligence)       │
│                                                 │
│  handleUserMessage(content)                     │
│  ┌───────────────────────────────────────────┐ │
│  │ 1. Analyze intent                         │ │
│  │    ├─ Action? (navigate, click, type)     │ │
│  │    ├─ Screen question? (see, page)        │ │
│  │    └─ General chat?                       │ │
│  └───────────────┬───────────────────────────┘ │
│                  │                             │
│     ┌────────────┼──────────────┐              │
│     ▼            ▼              ▼              │
│  ┌─────┐  ┌───────────┐  ┌─────────────┐      │
│  │Chat │  │ Describe  │  │   Action    │      │
│  └──┬──┘  │  Screen   │  │   Request   │      │
│     │     └─────┬─────┘  └──────┬──────┘      │
│     │           │                │             │
│     │           │ Capture        │ Plan with  │
│     │           │ Screenshot     │ Gemini     │
│     │           ▼                ▼             │
│     │     ┌──────────────┐ ┌──────────────┐   │
│     │     │ Gemini Vision│ │ Gemini       │   │
│     │     │ + Image      │ │ + Screenshot │   │
│     └────►│ Analysis     │ │ → JSON Plan  │   │
│           └──────┬───────┘ └──────┬───────┘   │
│                  │                │            │
│           Return │         Parse  │ Execute    │
│           desc   │         actions│ actions    │
│                  │                ▼            │
│                  │         chrome.tabs         │
│                  │         .sendMessage({      │
│                  │           type: 'click',    │
│                  │           target: ...       │
│                  │         })                  │
└──────────────────┼────────────────┼────────────┘
                   │                │
                   │                ▼
                   │        ┌───────────────┐
                   │        │  content.js   │
                   │        │  (Web Page)   │
                   │        │               │
                   │        │ findElement() │
                   │        │ element.click()│
                   │        │ element.value │
                   │        │ scrollTo()    │
                   │        └───────┬───────┘
                   │                │
                   │         Return success
                   │                │
                   ◄────────────────┘
                   │
                   │ Return response
                   ▼
           ┌──────────────┐
           │ sidepanel.js │
           │  - Display   │
           │  - Speak     │
           └──────────────┘
```

### Configuration Flow

```
options.html
     │
     │ User enters API keys
     ▼
options.js
     │
     │ chrome.storage.local.set({ geminiApiKey, deepgramApiKey })
     │ chrome.runtime.sendMessage({ type: 'config_updated' })
     ▼
background.js
     │
     │ updateConfig() → initGemini()
     ▼
Gemini Client Ready
     │
     │ chrome.storage.onChanged
     ▼
sidepanel.js
     │
     │ Deepgram API key updated
     ▼
Voice Input Ready
```

---

## Technology Stack

### AI/ML APIs

1. **Google Gemini 2.0 Flash (via @google/generative-ai)**
   - **Location:** `background.js`
   - **Models Used:**
     - `gemini-2.0-flash-exp` (primary model for chat & vision)
   - **Use Cases:**
     - Text chat with conversation history
     - Screenshot analysis (vision)
     - Action planning (vision + planning)
   - **Input:** Text prompts + optional PNG image (base64)
   - **Output:** Streaming text responses

2. **Deepgram Nova-2 (WebSocket API)**
   - **Location:** `sidepanel.js`
   - **Endpoint:** `wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&smart_format=true`
   - **Authentication:** WebSocket subprotocol `['token', apiKey]`
   - **Input:** Audio chunks (webm/opus, 250ms intervals)
   - **Output:** Real-time JSON transcription events
   - **Features:** Punctuation, smart formatting, final vs interim results

3. **Web Speech API (Browser Native)**
   - **Location:** `sidepanel.js`
   - **API:** `speechSynthesis.speak(utterance)`
   - **Voice Selection:** Prefers Samantha, Google, or Microsoft voices
   - **Parameters:** rate=1.0, pitch=1.0, volume=1.0
   - **Use Case:** Text-to-speech output for assistant responses

### Chrome Extension APIs

1. **chrome.runtime**
   - `onMessage` - Inter-component messaging
   - `sendMessage` - Send messages between contexts
   - `onInstalled` - Extension installation/update events
   - `openOptionsPage` - Open settings

2. **chrome.storage.local**
   - API key persistence
   - User preferences (mute state)
   - `onChanged` - Watch for storage updates

3. **chrome.tabs**
   - `query({ active: true, currentWindow: true })` - Get current tab
   - `captureVisibleTab(windowId, { format: 'png' })` - Screenshot
   - `update(tabId, { url })` - Navigate
   - `sendMessage(tabId, message)` - Send to content script

4. **chrome.sidePanel**
   - `setPanelBehavior({ openPanelOnActionClick: true })` - Auto-open behavior

5. **chrome.scripting** (implicit via content scripts)
   - Content script injection defined in manifest

### Web APIs

1. **MediaRecorder API**
   - Audio recording from microphone
   - Format: `audio/webm;codecs=opus`
   - Chunk interval: 250ms

2. **WebSocket API**
   - Real-time audio streaming to Deepgram
   - Binary data transmission

3. **MediaDevices API**
   - `getUserMedia({ audio: {...} })` - Microphone access
   - Audio constraints: mono, 16kHz sample rate

---

## Action Execution Pipeline

### Step-by-Step Action Flow

When user says: **"Click the login button"**

1. **sidepanel.js → background.js**
   ```javascript
   chrome.runtime.sendMessage({
     type: 'message',
     content: 'Click the login button'
   })
   ```

2. **background.js: Intent Detection**
   ```javascript
   const lowerInput = 'click the login button';
   const isAction = lowerInput.includes('click'); // TRUE
   // Route to handleActionRequest()
   ```

3. **background.js: Screenshot Capture**
   ```javascript
   const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
     format: 'png'
   });
   const base64 = dataUrl.split(',')[1];
   ```

4. **background.js: Gemini Vision Planning**
   ```javascript
   const prompt = `You are a web automation agent...
   User instruction: Click the login button
   Output JSON:
   {
     "understood": true,
     "explanation": "...",
     "actions": [{
       "type": "click",
       "target": "login",
       "description": "Click login button"
     }]
   }`;

   const result = await geminiClient.model.generateContent([
     prompt,
     { inlineData: { data: base64, mimeType: 'image/png' } }
   ]);

   const plan = JSON.parse(result.response.text());
   ```

5. **background.js: Execute Action**
   ```javascript
   const result = await chrome.tabs.sendMessage(tab.id, {
     type: 'click',
     target: 'login'
   });
   ```

6. **content.js: Find & Click Element**
   ```javascript
   // Receives: { type: 'click', target: 'login' }
   const element = findElement('login');
   // Tries: text match, aria-label, placeholder, CSS selector

   element.scrollIntoView({ behavior: 'smooth' });
   highlightElement(element); // Blue outline
   element.click();

   return { success: true };
   ```

7. **Response Chain**
   ```
   content.js → background.js → sidepanel.js
   { success: true } → "Clicked login button" → Display + Speak
   ```

---

## Element Finding Algorithm (content.js)

**Priority Order:**
1. Exact text match on interactive elements (a, button, input, select, textarea, [role="button"])
2. Partial text match on interactive elements
3. `[aria-label*="target" i]` (case-insensitive)
4. `[placeholder*="target" i]`
5. `[title*="target" i]`
6. CSS selector (try-catch for invalid selectors)
7. `[name*="target" i]`
8. Fallback: text match on all visible elements (checks direct text nodes only)

**Visibility Check:**
- `display !== 'none'`
- `visibility !== 'hidden'`
- `opacity !== '0'`
- `offsetParent !== null`

---

## Conversation History Management

**Location:** `background.js`

```javascript
let conversationHistory = [
  { role: 'user', content: 'What is this page?' },
  { role: 'assistant', content: 'This is a login page...' },
  // ...grows with conversation
];
```

**Usage:**
- Converted to Gemini chat format: `{ role, parts: [{ text }] }`
- Maintains context across multiple interactions
- No automatic pruning (resets on extension reload)

---

## API Key Management

### Storage Schema
```javascript
{
  geminiApiKey: 'AIzaSy...',      // Required
  deepgramApiKey: '...',          // Required for voice
  twelveLabsApiKey: '...',        // Optional (not currently used)
  voiceMuted: false               // User preference
}
```

### Access Pattern
1. **Initialization:** Loaded on extension install/reload
2. **Update:** Via options page → broadcasts to all contexts
3. **Persistence:** Chrome Storage API (local, encrypted by browser)

---

## Error Handling Patterns

### 1. Missing API Keys
```javascript
// background.js - Enhanced with specific messages
if (!geminiClient || !geminiClient.visionModel) {
  console.error('[describeActiveTab] Gemini client not initialized');
  return {
    type: 'error',
    message: "AI service not initialized. Please check your Gemini API key in settings."
  };
}

// sidepanel.js (voice)
if (!deepgramApiKey) {
  addMessage('assistant', 'Please set up Deepgram key...');
  speak('Please set up your Deepgram API key in settings.');
  return;
}
```

### 2. Rate Limiting ⭐ NEW
```javascript
// background.js - Pre-emptive rate limiting
function checkRateLimit() {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);

  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    const waitSeconds = Math.ceil((RATE_LIMIT_WINDOW - (now - requestTimestamps[0])) / 1000);
    return {
      allowed: false,
      waitSeconds: waitSeconds
    };
  }

  requestTimestamps.push(now);
  return { allowed: true };
}

// Used in chat(), describeActiveTab(), handleActionRequest()
const rateLimitCheck = checkRateLimit();
if (!rateLimitCheck.allowed) {
  return {
    type: 'error',
    message: `Please slow down. You've made too many requests. Wait ${rateLimitCheck.waitSeconds} seconds before trying again. (Free tier limit: 15 requests/minute)`
  };
}
```

### 3. Protected Pages ⭐ NEW
```javascript
// background.js - Validates tab URL before screenshot
if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
  console.error('[describeActiveTab] Cannot capture protected page:', tab.url);
  return {
    type: 'error',
    message: "I can't capture screenshots of Chrome's internal pages. Please navigate to a regular website (like google.com) and try again."
  };
}
```

### 4. Action Execution Failures
```javascript
// content.js
if (!element) {
  return { success: false, error: `Could not find element: ${target}` };
}

// background.js - propagates to user
response += result.message + '\n'; // "Failed: Could not find element"
```

### 5. API Errors ⭐ ENHANCED
```javascript
try {
  const result = await geminiClient.model.generateContent(...);
} catch (error) {
  console.error('[describeActiveTab] ERROR:', error);
  console.error('[describeActiveTab] Error name:', error.name);
  console.error('[describeActiveTab] Error message:', error.message);

  // Provide specific error messages based on error type
  let userMessage = "I couldn't see your screen. ";

  if (error.message && error.message.includes('API key')) {
    userMessage += "There's an issue with your Gemini API key. Please check it in settings.";
  } else if (error.message && error.message.includes('quota')) {
    userMessage += "You've hit the API rate limit. Please wait a minute and try again.";
  } else if (error.message && error.message.includes('network')) {
    userMessage += "Network error. Please check your internet connection.";
  } else {
    userMessage += `Error: ${error.message || 'Unknown error'}. Check the console for details.`;
  }

  return { type: 'error', message: userMessage };
}
```

### 6. Logging System ⭐ NEW
All functions now include detailed logging with prefixes:
```javascript
console.log('[functionName] Action description...');
console.error('[functionName] Error description:', error);
console.warn('[functionName] Warning message');
```

Examples:
- `[loadConfig] Loading API keys from storage...`
- `[initGemini] ✓ Gemini initialized successfully`
- `[describeActiveTab] Getting active tab...`
- `[RateLimit] Requests in last minute: 10/14`

---

## Quick Action Prompts

Defined in `sidepanel.js`:

```javascript
const prompts = {
  describe: `Describe what's on my screen right now.
             What website is this and what are the main elements
             I can interact with?`,

  summary: `Give me a brief summary of the main content on this page.
            What are the key takeaways?`,

  scam: `Analyze this website for trustworthiness.
         Are there any red flags that suggest this might be a scam?
         Look for suspicious elements, hidden fees, or misleading information.`
};
```

These are sent directly to `handleUserInput()` as if the user typed them.

---

## System Prompts

### Chat System Prompt (background.js)
```
You are a friendly, helpful AI assistant designed specifically
to help blind and low-vision users navigate the internet.

Your personality:
- Warm, patient, and encouraging
- Clear and concise in your responses
- Proactive in offering help
- Natural conversational tone

Keep responses brief but friendly - remember the user is listening,
not reading.
```

### Screen Description Prompt (background.js)
```
You are an accessibility assistant for blind and low-vision users.
Describe this screen in a clear, concise way that helps the user understand:

1. What website or application is shown
2. The main content and purpose of the current view
3. Any interactive elements (buttons, links, forms) and their locations
4. Any important notifications or status messages

Be conversational but efficient. Prioritize actionable information.
```

### Action Planning Prompt (background.js)
```
You are a web automation agent. Given the user's instruction
and the current screen, output a JSON action plan.

User instruction: {instruction}

Output a JSON object with this structure:
{
  "understood": true/false,
  "explanation": "Brief explanation of what you'll do",
  "actions": [
    {
      "type": "navigate" | "click" | "type" | "scroll",
      "target": "URL or selector or text",
      "description": "What this action does"
    }
  ],
  "needsMoreInfo": "Question to ask if unclear, or null"
}

Only output valid JSON, no markdown.
```

---

## Accessibility Features

### Screen Reader Support
1. **ARIA Live Regions**
   - Status updates: `aria-live="polite"`
   - Message log: `role="log"`
   - Announcements: Dynamic `role="status"` elements

2. **Semantic HTML**
   - `<header>`, `<footer>`, `<main>` landmarks
   - `role="form"`, `role="button"` explicit roles

3. **Keyboard Navigation**
   - Voice button: Spacebar to activate
   - Text input: Enter to send
   - All interactive elements keyboard-accessible

### Voice Features
1. **Push-to-Talk Design**
   - Prevents accidental activation
   - Clear "Listening..." feedback
   - Multi-modal: mouse, touch, keyboard

2. **Text-to-Speech**
   - Automatic reading of responses
   - Mute toggle for silent mode
   - Voice preference (Samantha, Google, Microsoft)

3. **Visual Feedback**
   - Blue outline on clicked elements (1 second duration)
   - Loading indicators ("...")
   - Status text updates

---

## Development Notes for Claude Code Agents

### When Modifying This Codebase

1. **Message Type Contract**
   - Always send `{ type: string, ...data }` in `chrome.runtime.sendMessage()`
   - Background script expects: `message`, `describe`, `screenshot`, `config_updated`
   - Content script expects: `click`, `type`, `scroll`, `getPageInfo`, `getInteractiveElements`

2. **Async Message Handlers**
   - Always return `true` from `onMessage.addListener()` if using async/await
   - Otherwise, `sendResponse()` won't work

3. **Screenshot Timing**
   - Screenshots are captured BEFORE actions execute
   - Page may change between screenshot and action (race condition)
   - Add delays (`await sleep(ms)`) if needed

4. **Element Finding**
   - Case-insensitive by default
   - Partial matches increase success rate
   - Always check visibility before returning element

5. **API Rate Limits**
   - Gemini: ~15 RPM on free tier
   - Deepgram: Pay-per-use (no hard limit)
   - Add error handling for quota exceeded

6. **Storage Updates**
   - Use `chrome.storage.local.set()` to persist
   - Broadcast changes via `chrome.runtime.sendMessage({ type: 'config_updated' })`
   - Listen to `chrome.storage.onChanged` in UI components

7. **Content Script Lifecycle**
   - Injected per-page, survives navigation on same origin
   - May not exist if page just loaded (add error handling)
   - Use `chrome.scripting.executeScript()` for manual injection if needed

8. **Service Worker Limitations**
   - No persistent state (resets every ~30s of inactivity)
   - Use `chrome.storage` for persistence
   - Conversations will reset on worker wake

### Testing Checklist

- [ ] Load unpacked extension in `chrome://extensions/`
- [ ] Enter API keys in options page
- [ ] Test voice input (check microphone permissions)
- [ ] Test text input
- [ ] Test quick actions (Describe, Summarize, Safety Check)
- [ ] Test web automation (navigate, click, type, scroll)
- [ ] Test mute toggle
- [ ] Check console logs in:
  - Extension service worker (`chrome://serviceworker-internals/`)
  - Side panel (right-click → Inspect)
  - Options page (right-click → Inspect)
  - Target webpage console (for content script logs)

### File Locations Reference

```
/manifest.json              - Extension config
/background.js              - Service worker (AI brain)
/content.js                 - DOM manipulation (injected per page)
/sidepanel.html             - Side panel UI markup
/sidepanel.css              - Side panel styles
/sidepanel.js               - Side panel logic (voice/text)
/options.html               - Settings page markup + inline CSS
/options.js                 - Settings page logic
/lib/generative-ai.js       - Bundled Gemini SDK
/icons/                     - Extension icons (SVG)
/README.md                  - User documentation
/WORKFLOW.md                - This file
```

---

## Common Troubleshooting

### "AI service not initialized" ⭐ UPDATED
- **Cause:** Gemini API key not loaded or invalid
- **Console:** `[initGemini] No API key provided` or `[describeActiveTab] Gemini client not initialized`
- **Fix:** Open options page, add valid Gemini API key from https://aistudio.google.com/apikey
- **Verification:** Check service worker console for `[initGemini] ✓ Gemini initialized successfully`

### "I can't capture screenshots of Chrome's internal pages" ⭐ NEW
- **Cause:** Attempting to screenshot protected pages (chrome://, chrome-extension://)
- **Console:** `[describeActiveTab] Cannot capture protected page: chrome://extensions/`
- **Fix:** Navigate to regular website (google.com, github.com, etc.)
- **Protected URLs:** chrome://, chrome-extension://, file://, Chrome Web Store

### "Please slow down. You've made too many requests. Wait X seconds" ⭐ NEW
- **Cause:** Hit client-side rate limit (14 requests/minute)
- **Console:** `[RateLimit] Rate limit reached! Wait Xs`
- **Fix:** Wait the specified time (shown in error message)
- **Prevention:** Wait 5 seconds between requests during testing
- **See:** `claude_files/RATE_LIMITING.md` for full details

### "You've hit the API rate limit" (from Gemini API)
- **Cause:** Exceeded Gemini free tier limit (15 RPM)
- **Console:** Error message includes "quota" or "429"
- **Fix:** Wait 60 seconds, then retry
- **Long-term:** Upgrade to paid tier or implement request throttling
- **Note:** Client-side rate limiter (above) should prevent this

### Voice input not working
- **Cause:** Missing Deepgram API key or microphone permission denied
- **Fix:** Add Deepgram key in options, check browser microphone permissions
- **Verification:** Check side panel console for Deepgram connection logs

### "Could not find element"
- **Cause:** Element not visible, ambiguous description, or doesn't exist
- **Fix:** Try more specific wording (e.g., "login button" instead of "button")
- **Console:** Check content script console for element finding logs

### Actions not executing
- **Cause:** Content script not loaded on page
- **Fix:** Reload target page, check for CSP errors in console
- **Verification:** Look for "Vision Agent content script loaded" in webpage console

---

## Additional Documentation

For more detailed guides and troubleshooting, see these files in `claude_files/`:

### **RATE_LIMITING.md**
- Complete guide to rate limiting system
- How it works (rolling window, request tracking)
- Testing scenarios and examples
- How to upgrade API tier
- FAQ and troubleshooting

### **SCREENSHOT_DEBUGGING.md**
- Deep dive into screenshot capture architecture
- All failure points explained in detail
- Step-by-step debugging instructions
- Console log examples (good vs bad)
- Advanced diagnostic commands
- Common error patterns with fixes

### **TESTING_GUIDE.md**
- Comprehensive test scenarios (10+ tests)
- Expected results for each test
- Performance benchmarks
- Test coverage checklist
- Success criteria
- Common issues and solutions

### **HOW_TO_CHECK_ERRORS.md**
- How to open service worker console
- How to open side panel console
- How to open content script console
- What to look for in each console
- How to share error info for debugging

### **WORKFLOW.md** (this file)
- Architecture overview
- File responsibilities
- Data flow diagrams
- Technology stack details
- Development notes

---

## Implemented Enhancements ✅

1. **Client-Side Rate Limiting** - Pre-emptive request blocking (14/minute) with helpful wait messages
2. **Enhanced Error Handling** - Specific error messages for all failure points
3. **Protected Page Detection** - Validates URLs before screenshot attempts
4. **Comprehensive Logging** - Tagged console logs for all functions
5. **Service Worker Startup Loading** - Config loads on startup, not just install

## Future Enhancement Areas

1. **Twelve Labs Video Analysis** - Currently configured but unused
2. **Conversation Persistence** - Save history across service worker restarts
3. **Custom Voice Settings** - Speed, pitch, voice selection in UI
4. **Multi-tab Support** - Track conversations per tab
5. **Advanced Action Chaining** - Multi-step workflows without re-prompting
6. **OCR Fallback** - For inaccessible images without alt text
7. **Keyboard Shortcuts** - Global hotkeys for quick activation
8. **History/Logs** - Conversation history viewer
9. **Adaptive Rate Limiting** - Detect paid tier and adjust limits automatically
10. **Request Queue** - Queue excess requests instead of blocking

---

## License

MIT License - See README.md

---

**End of Workflow Documentation**
