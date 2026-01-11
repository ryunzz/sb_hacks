# How to Check Error Logs in Vision Agent

## 1. Service Worker Console (Background Script)

This is where API errors usually show up.

**Steps:**
1. Open `chrome://extensions/` in Chrome
2. Find "Vision Agent" in the list
3. Look for **"service worker"** link (it's blue/clickable)
4. Click it to open DevTools
5. Go to the **Console** tab
6. Look for red error messages

**Common errors here:**
- Gemini API errors (invalid key, quota exceeded)
- "Failed to initialize Gemini"
- Network errors

---

## 2. Side Panel Console

This is where UI and Deepgram errors show up.

**Steps:**
1. Click Vision Agent icon to open side panel
2. Right-click anywhere inside the side panel
3. Select **"Inspect"**
4. Go to the **Console** tab
5. Look for red error messages

**Common errors here:**
- Deepgram API errors (invalid key, connection failed)
- "Microphone access error"
- "Voice recognition failed"

---

## 3. Content Script Console

This is where DOM manipulation errors show up.

**Steps:**
1. Navigate to any webpage (e.g., google.com)
2. Press **F12** or right-click → Inspect
3. Go to the **Console** tab
4. Look for "Vision Agent content script loaded"
5. Look for red error messages

**Common errors here:**
- "Could not find element"
- CSP (Content Security Policy) errors

---

## What to Look For

### ✅ Good Signs
```
Vision Agent installed
Gemini initialized
Vision Agent background worker loaded
Vision Agent content script loaded
Deepgram connected
```

### ❌ Bad Signs
```
Failed to initialize Gemini: [error details]
API key not valid
403 Forbidden
429 Too Many Requests
NetworkError
CORS error
Invalid API key
```

---

## Common Error Patterns

### "API key not valid" or "403 Forbidden"
- **Cause:** Incorrect API key format or invalid key
- **Fix:** Double-check you copied the full key, no extra spaces

### "Failed to initialize Gemini"
- **Cause:** Gemini API key issue
- **Check:** Service worker console for details
- **Fix:** Get new API key from https://aistudio.google.com/apikey

### "Deepgram error" or "WebSocket failed"
- **Cause:** Deepgram API key issue or network problem
- **Check:** Side panel console for details
- **Fix:** Verify Deepgram key from https://console.deepgram.com/

### "429 Too Many Requests"
- **Cause:** Hit rate limit (Gemini free tier: 15 requests/min)
- **Fix:** Wait 1 minute before trying again

### No errors but nothing happens
- **Check:** Are both API keys saved?
- **Check:** Did you see "Settings saved successfully"?
- **Fix:** Try refreshing the extension (toggle off/on in chrome://extensions/)

---

## How to Share Error Info

When asking for help, include:

1. **Exact error message** from console
2. **Which console** it appeared in (service worker, side panel, or content)
3. **What you were doing** when error occurred
4. **Screenshot** if possible

Example good error report:
```
Error in: Service Worker Console
Message: "Failed to initialize Gemini: API key not valid"
When: Right after saving API keys in settings
```
