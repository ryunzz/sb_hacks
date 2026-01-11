# Screenshot Capture Architecture & Debugging Guide

## Overview

The "I couldn't see your screen" error can occur at **multiple failure points** in the screenshot capture pipeline. This guide explains the architecture and how to diagnose each failure point.

---

## Screenshot Capture Flow

```
User Request ("Describe this page")
    ↓
sidepanel.js → chrome.runtime.sendMessage({ type: 'message', content })
    ↓
background.js → handleUserMessage()
    ↓
background.js → describeActiveTab()
    ↓
① chrome.tabs.query({ active: true, currentWindow: true })
    ↓ [Can fail: No active tab, wrong window]
    ↓
② chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    ↓ [Can fail: Protected page, permissions, tab not visible]
    ↓
③ geminiClient.visionModel.generateContent([prompt, imagePart])
    ↓ [Can fail: No API key, invalid key, quota exceeded, network error]
    ↓
Response → sidepanel.js → Display + Speak
```

---

## Failure Point #1: No Active Tab

**Error in Console:**
```
[describeActiveTab] No active tab found
```

**User sees:**
```
"I couldn't find an active tab. Please make sure you have a tab open."
```

**Causes:**
- Extension opened with no tabs
- All tabs closed
- Wrong window context

**Fix:**
- Open a new tab with a website
- Make sure tab is active (clicked/focused)

---

## Failure Point #2: Protected Chrome Page

**Error in Console:**
```
[describeActiveTab] Cannot capture protected page: chrome://extensions/
```

**User sees:**
```
"I can't capture screenshots of Chrome's internal pages.
Please navigate to a regular website (like google.com) and try again."
```

**Causes:**
- Currently on `chrome://` pages
- Currently on `chrome-extension://` pages
- Currently on Chrome Web Store
- Currently on `file://` local files

**Protected URLs:**
```
❌ chrome://extensions/
❌ chrome://settings/
❌ chrome://flags/
❌ chrome-extension://[any-id]/
❌ https://chrome.google.com/webstore/
❌ file:///Users/...
```

**Fix:**
Navigate to a regular website:
```
✅ https://google.com
✅ https://github.com
✅ https://wikipedia.org
✅ Any normal HTTP/HTTPS website
```

---

## Failure Point #3: Screenshot Capture Fails

**Error in Console:**
```
[describeActiveTab] ERROR: [error details]
```

**Possible Causes:**

### A. Missing Permissions
Check manifest.json has:
```json
{
  "permissions": ["activeTab", "tabs"],
  "host_permissions": ["<all_urls>"]
}
```

**Fix:**
- Permissions are already correct in this extension
- If modified, reload extension

### B. Tab Not Visible
Screenshot API only captures VISIBLE tabs.

**Causes:**
- Tab is minimized
- Tab is in background window
- Tab is hidden behind another window

**Fix:**
- Make sure Chrome window is active
- Make sure tab is selected
- Bring Chrome to foreground

### C. CSP (Content Security Policy)
Some websites block extensions.

**Causes:**
- Banking websites
- Government sites
- High-security enterprise sites

**Fix:**
- Try on a different website
- Check browser console for CSP errors

---

## Failure Point #4: Gemini Client Not Initialized

**Error in Console:**
```
[describeActiveTab] Gemini client not initialized
```

**User sees:**
```
"AI service not initialized. Please check your Gemini API key in settings."
```

**Causes:**
- No API key saved
- API key cleared
- Service worker restarted before loading config
- initGemini() failed

**Diagnosis:**
Check service worker console for:
```
[loadConfig] Gemini API key present: false
[initGemini] No API key provided
```

**Fix:**
1. Go to extension options/settings
2. Paste Gemini API key
3. Click Save
4. Check console for:
   ```
   [updateConfig] Configuration saved to storage
   [loadConfig] Gemini API key present: true
   [initGemini] ✓ Gemini initialized successfully
   ```

---

## Failure Point #5: Gemini API Error

**Error in Console:**
```
[describeActiveTab] ERROR: [GoogleGenerativeAI Error]
```

**Possible Error Types:**

### A. Invalid API Key
```
Error: API key not valid
Error: 403 Forbidden
```

**Diagnosis:**
```
[initGemini] Initializing with API key: AIzaSy...
[initGemini] ✗ Failed to initialize Gemini: API key not valid
```

**Fix:**
1. Go to https://aistudio.google.com/apikey
2. Generate NEW API key
3. Copy FULL key (starts with AIzaSy...)
4. Paste in settings (no extra spaces)
5. Save

### B. Quota Exceeded
```
Error: 429 Too Many Requests
Error: quota exceeded
```

**User sees:**
```
"I couldn't see your screen. You've hit the API rate limit.
Please wait a minute and try again."
```

**Causes:**
- Gemini free tier: 15 requests per minute
- Too many rapid requests

**Fix:**
- Wait 60 seconds
- Try again
- Or upgrade to paid tier

### C. Network Error
```
Error: NetworkError
Error: Failed to fetch
```

**User sees:**
```
"I couldn't see your screen. Network error.
Please check your internet connection."
```

**Fix:**
- Check internet connection
- Try again
- Check if Google AI services are down

### D. Model Not Found
```
Error: Model gemini-2.0-flash-exp not found
```

**Causes:**
- Model name changed
- API access not enabled

**Fix:**
- Update model name in background.js
- Check if Gemini 2.0 Flash is available in your region

---

## How to Debug: Step-by-Step

### Step 1: Open Service Worker Console

1. Go to `chrome://extensions/`
2. Find "Vision Agent"
3. Click blue "service worker" link
4. Console opens

### Step 2: Reload Extension

1. In `chrome://extensions/`, click reload ↻ button
2. Watch console output:

**Expected Good Output:**
```
[onInstalled] Vision Agent installed
[loadConfig] Loading API keys from storage...
[loadConfig] Gemini API key present: true
[loadConfig] Deepgram API key present: true
[initGemini] Initializing with API key: AIzaSy...
[initGemini] ✓ Gemini initialized successfully
Vision Agent background worker loaded
```

**Bad Output (No API Key):**
```
[loadConfig] Gemini API key present: false
[loadConfig] No Gemini API key found. Please configure in settings.
```

### Step 3: Navigate to Test Page

1. Open new tab
2. Go to `https://google.com`
3. Make sure tab is active/focused

### Step 4: Try Screenshot

1. Open Vision Agent side panel
2. Type: "Describe this page"
3. Send message
4. Watch console output:

**Expected Good Output:**
```
Received message: message
[describeActiveTab] Getting active tab...
[describeActiveTab] Active tab: https://www.google.com/
[describeActiveTab] Capturing screenshot...
[describeActiveTab] Screenshot captured, size: 123456
[describeActiveTab] Sending to Gemini Vision API...
[describeActiveTab] Got response from Gemini
```

**Bad Output Examples:**

**Protected Page:**
```
[describeActiveTab] Active tab: chrome://extensions/
[describeActiveTab] Cannot capture protected page: chrome://extensions/
```

**No API Key:**
```
[describeActiveTab] Screenshot captured, size: 123456
[describeActiveTab] Gemini client not initialized
```

**API Error:**
```
[describeActiveTab] Sending to Gemini Vision API...
[describeActiveTab] ERROR: Error: API key not valid
[describeActiveTab] Error message: API key not valid
```

### Step 5: Fix Based on Error

See corresponding failure point section above for specific fixes.

---

## Quick Diagnostic Checklist

Run through this checklist when debugging:

- [ ] Service worker console is open (`chrome://extensions/` → service worker)
- [ ] Extension reloaded recently (click reload ↻)
- [ ] Console shows "Gemini initialized successfully"
- [ ] Currently on a regular website (not chrome:// or file://)
- [ ] Chrome window is active (not minimized)
- [ ] Tab is selected (not background tab)
- [ ] API key saved in settings
- [ ] API key is valid (no 403 errors)
- [ ] Not hitting rate limits (no 429 errors)
- [ ] Internet connection working

---

## Advanced Debugging: Manual API Test

In service worker console, run this to test Gemini directly:

```javascript
// Check if client exists
console.log('geminiClient:', geminiClient);

// Test simple text generation (no screenshot)
if (geminiClient) {
  geminiClient.model.generateContent('Say hello')
    .then(result => console.log('✓ Gemini works:', result.response.text()))
    .catch(err => console.error('✗ Gemini error:', err));
}
```

**Good result:**
```
✓ Gemini works: Hello! How can I help you today?
```

**Bad result:**
```
✗ Gemini error: Error: API key not valid
```

---

## Common Error Patterns Summary

| Error Message | Likely Cause | Quick Fix |
|---------------|--------------|-----------|
| "I couldn't find an active tab" | No tabs open | Open a new tab |
| "I can't capture screenshots of Chrome's internal pages" | On chrome:// page | Go to google.com |
| "AI service not initialized" | No API key | Add key in settings |
| "API key" in error | Invalid key | Generate new key |
| "quota" or "429" in error | Rate limit | Wait 60 seconds |
| "network" in error | Connection issue | Check internet |
| Generic error with stack trace | Check console | See detailed error in console |

---

## All Screenshot Capture Locations in Code

### 1. describeActiveTab() - Line 183
**When:** User asks about screen content
**Triggers:** Keywords like "screen", "see", "page"
**Usage:** Screenshot → Gemini Vision → Description

### 2. handleActionRequest() - Line 291
**When:** User requests web action
**Triggers:** Keywords like "click", "type", "navigate", "scroll"
**Usage:** Screenshot → Gemini Vision → Action plan → Execute

### 3. captureActiveTab() - Line 318
**When:** Direct screenshot request
**Triggers:** Message type: 'screenshot'
**Usage:** Returns base64 image (currently unused by UI)

---

## Testing After Fixes

After making changes, test in this order:

1. **Simple chat** (no screenshot):
   ```
   "Hello, how are you?"
   ```
   Expected: Normal chat response

2. **Screen description** on Google:
   ```
   Navigate to google.com
   "Describe this page"
   ```
   Expected: Description of Google homepage

3. **Quick action button**:
   ```
   Click "👁️ Describe Page" button
   ```
   Expected: Same as #2

4. **Web automation**:
   ```
   "Click the search box"
   ```
   Expected: Search box focused, blue outline

If all 4 work → Screenshot capture is fully functional! 🎉

---

## Still Not Working?

If you've tried everything and still getting errors:

1. **Export console logs**:
   - Right-click in console → Save as...
   - Or copy/paste all output

2. **Check API key format**:
   ```javascript
   // In service worker console:
   chrome.storage.local.get(['geminiApiKey'], (data) => {
     console.log('Key length:', data.geminiApiKey?.length);
     console.log('Key starts with:', data.geminiApiKey?.substring(0, 10));
     console.log('Key ends with:', data.geminiApiKey?.substring(data.geminiApiKey.length - 5));
   });
   ```

   Expected:
   ```
   Key length: 39
   Key starts with: AIzaSy...
   Key ends with: ...XYZ
   ```

3. **Try fresh extension load**:
   - Remove extension completely
   - Close Chrome
   - Restart Chrome
   - Load unpacked extension again
   - Configure API keys
   - Test

4. **Test API key externally**:
   Go to Google AI Studio and test your key there:
   https://aistudio.google.com/app/prompts/new_chat

---

**Last Updated:** 2026-01-10
**For:** Vision Agent Debugging
