# Vision Agent - Local Testing Guide

## Initial Setup Checklist

- [ ] Extension loaded in `chrome://extensions/` with Developer mode enabled
- [ ] Gemini API key configured in settings
- [ ] Deepgram API key configured in settings
- [ ] Microphone permissions granted (for voice input)

---

## Test Scenarios

### 1. **Test Text Input**
1. Navigate to any website (e.g., https://google.com)
2. Click the Vision Agent extension icon to open side panel
3. Type in the text input: `"Describe this page"`
4. Press Enter or click Send
5. **Expected:** Assistant should analyze the page and describe it
6. **Check:** Message appears in chat, TTS voice reads response

### 2. **Test Voice Input (Push-to-Talk)**
1. Open side panel on any website
2. **Hold down** the "Hold to Speak" button (mouse/touch)
3. While holding, speak: "What is on my screen?"
4. Release the button
5. **Expected:**
   - Button shows "Listening..." while held
   - After release, shows "Processing..."
   - Transcription appears as user message
   - Assistant responds with page description

### 3. **Test Quick Actions**

#### Describe Page
1. Navigate to https://news.ycombinator.com
2. Click "👁️ Describe Page" button
3. **Expected:** Detailed description of Hacker News layout and main stories

#### Summarize
1. Navigate to any article (e.g., Wikipedia article)
2. Click "📝 Summarize" button
3. **Expected:** Key takeaways from the article

#### Is This Safe?
1. Navigate to https://amazon.com
2. Click "⚠️ Is This Safe?" button
3. **Expected:** Analysis confirming Amazon is legitimate

### 4. **Test Web Automation - Navigation**
1. Open side panel
2. Say or type: `"Go to google.com"`
3. **Expected:** Browser navigates to Google

### 5. **Test Web Automation - Clicking**
1. Navigate to https://google.com
2. Say or type: `"Click the search box"`
3. **Expected:**
   - Element highlighted with blue outline
   - Search box receives focus
   - Assistant confirms action

### 6. **Test Web Automation - Typing**
1. After clicking search box (above)
2. Say or type: `"Type hello world in the search box"`
3. **Expected:**
   - Text appears in search box character by character
   - Assistant confirms action

### 7. **Test Web Automation - Scrolling**
1. Navigate to long page (e.g., Wikipedia article)
2. Say or type: `"Scroll down"`
3. **Expected:** Page scrolls down 500px smoothly

### 8. **Test Mute Toggle**
1. Open side panel
2. Send any message to get a response
3. Observe voice output
4. Click "🔊 Voice On" button
5. Send another message
6. **Expected:**
   - Button changes to "🔇 Voice Off"
   - No voice output (text still appears)
7. Click again to re-enable

### 9. **Test Conversation Context**
1. Ask: "What is the capital of France?"
2. Wait for response
3. Ask: "What is its population?"
4. **Expected:** Assistant understands "its" refers to Paris

### 10. **Test Multi-Step Action**
1. Navigate to https://duckduckgo.com
2. Say: "Search for cat videos"
3. **Expected:**
   - Clicks search box
   - Types "cat videos"
   - May click search button (depending on Gemini's plan)

---

## Common Issues & Solutions

### "Please configure your API keys in settings"
- **Cause:** Missing Gemini API key
- **Fix:** Go to settings, add Gemini key from https://aistudio.google.com/apikey

### Voice input says "Please set up your Deepgram API key"
- **Cause:** Missing Deepgram API key
- **Fix:** Go to settings, add Deepgram key from https://console.deepgram.com/

### Microphone access denied
- **Fix:**
  1. Go to `chrome://settings/content/microphone`
  2. Allow microphone access for `chrome-extension://[extension-id]`
  3. Or click the microphone icon in Chrome's address bar and allow

### "Could not find element: [element name]"
- **Cause:** Element doesn't exist, not visible, or description is ambiguous
- **Fix:**
  - Try more specific description ("login button" instead of "button")
  - Check element is visible on screen
  - Try CSS selector if you know it

### Actions not executing on certain websites
- **Cause:** Content Security Policy (CSP) blocking content script
- **Fix:** Check browser console for CSP errors
- **Note:** Some sites (chrome://, file://) block extensions by design

### Extension disappeared after Chrome restart
- **Cause:** Unpacked extensions must be manually re-enabled sometimes
- **Fix:** Go to `chrome://extensions/`, find Vision Agent, click toggle to re-enable

### Quota/Rate limit errors
- **Cause:** Gemini free tier limit (15 requests per minute)
- **Fix:** Wait 1 minute between rapid requests, or upgrade to paid tier

---

## Debugging Tools

### View Service Worker Console
1. Go to `chrome://extensions/`
2. Find Vision Agent
3. Click "service worker" link (under "Inspect views")
4. Opens DevTools for background.js

### View Side Panel Console
1. Open side panel
2. Right-click anywhere in the panel
3. Click "Inspect"
4. Opens DevTools for sidepanel.js

### View Content Script Console
1. Navigate to any webpage
2. Open DevTools (F12 or right-click → Inspect)
3. Go to Console tab
4. Look for "Vision Agent content script loaded"

### Check Messages Flow
In service worker console:
```javascript
// See all messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('Message:', msg, 'from:', sender);
});
```

### Monitor Storage
In any DevTools console:
```javascript
// Check API keys (they're saved as-is, be careful!)
chrome.storage.local.get(null, (data) => console.log(data));
```

---

## Performance Testing

### Screenshot Capture Speed
- Typical: 100-300ms
- Slow: >500ms (large/complex pages)

### Gemini Response Time
- Chat: 1-3 seconds
- Vision (screenshot): 2-5 seconds
- Action planning: 3-6 seconds

### Deepgram Transcription
- Real-time streaming
- Final transcript: <500ms after stopping

### Element Finding Speed
- Simple elements: <50ms
- Complex searches: 100-500ms

---

## Test Coverage Checklist

- [ ] Text input works
- [ ] Voice input works
- [ ] All 3 quick actions work
- [ ] Navigate action works
- [ ] Click action works
- [ ] Type action works
- [ ] Scroll action works
- [ ] Mute toggle works
- [ ] Settings save and persist
- [ ] Conversation context maintained
- [ ] TTS voice output works
- [ ] Error messages display correctly
- [ ] Extension works after browser restart

---

## Success Criteria

The extension is working correctly if:

1. ✅ You can interact via voice OR text
2. ✅ Screenshot descriptions are accurate and helpful
3. ✅ Web automation actions execute correctly
4. ✅ Voice output is clear and understandable
5. ✅ Settings persist across browser restarts
6. ✅ No console errors in normal operation
7. ✅ All quick actions return relevant information

---

## Next Steps After Testing

If everything works:
- Test on real-world accessibility scenarios
- Gather feedback from visually impaired users
- Monitor API usage and costs
- Consider implementing rate limiting
- Add error recovery mechanisms
- Implement conversation history persistence

If issues found:
- Check console logs in all contexts
- Verify API keys are correct
- Test in incognito mode (with extension enabled)
- Try different websites
- Check Chrome version compatibility (requires Manifest V3 support)

---

**Happy Testing! 🎉**
