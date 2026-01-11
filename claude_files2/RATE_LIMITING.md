# Rate Limiting Guide

## What Just Happened

You hit the **Gemini API free tier rate limit**:
- **Limit:** 15 requests per minute (RPM)
- **What you saw:** "I couldn't see your screen. You've hit the API rate limit."

## Immediate Fix

⏱️ **Wait 60 seconds** and try again. The limit resets every minute.

---

## What I Just Added

I've implemented **client-side rate limiting** to prevent this from happening again:

### New Features:

1. **Pre-emptive blocking** - Stops requests BEFORE hitting the API
2. **Helpful error messages** - Tells you exactly how long to wait
3. **Request tracking** - Logs remaining requests in console
4. **Safe buffer** - Limits to 14/minute (keeps 1 request buffer)

### What You'll See Now:

Instead of hitting the API limit and getting generic errors, you'll get:

```
"Please slow down. You've made too many requests.
Wait 23 seconds before trying again.
(Free tier limit: 15 requests/minute)"
```

### Console Logging:

In the service worker console, you'll see:

```
[RateLimit] Requests in last minute: 5/14
[RateLimit] Requests remaining: 9

[RateLimit] Requests in last minute: 14/14
[RateLimit] Rate limit reached! Wait 43s
```

---

## How It Works

### Request Tracking:
```javascript
// Tracks timestamps of last 60 seconds
requestTimestamps = [
  1704914000000,  // 45 seconds ago
  1704914015000,  // 30 seconds ago
  1704914030000,  // 15 seconds ago
  // ... up to 14 requests
]
```

### Before Each API Call:
```
1. Remove timestamps older than 60 seconds
2. Count remaining timestamps
3. If count >= 14:
   - Calculate wait time
   - Return error with wait time
   - DO NOT call API
4. If count < 14:
   - Add current timestamp
   - Proceed with API call
```

### Automatic Cleanup:
- Old timestamps (>60s) are automatically removed
- Counter resets as time passes
- No manual reset needed

---

## Testing the Rate Limiter

### Test 1: Normal Usage (Should Work)
```
1. Reload extension
2. Wait 60 seconds
3. Ask: "Describe this page"
4. Wait 5 seconds between requests
5. Repeat 5 times
```

**Expected:** All requests succeed

### Test 2: Rapid Requests (Should Block)
```
1. Reload extension
2. Rapid-fire 15 requests:
   - Click "Describe Page" button 15 times quickly
3. On request #15, you should see:
   "Please slow down. You've made too many requests. Wait X seconds..."
```

**Expected:** Blocks before hitting API limit

### Test 3: Recovery (Should Resume)
```
1. After hitting limit (Test 2)
2. Wait the time shown in error message
3. Try again
```

**Expected:** Works again after waiting

---

## Request Budget Examples

### Scenario 1: Light Testing
```
Action                          | Requests Used
--------------------------------|---------------
"Describe this page"            | 1
Wait 5 seconds                  |
"Is this safe?"                 | 1
Wait 5 seconds                  |
"Click the login button"        | 1
Wait 5 seconds                  |
"What is 2+2?"                  | 1
--------------------------------|---------------
Total in 15 seconds:            | 4/14 ✅
```
**Status:** Plenty of headroom, won't hit limit

### Scenario 2: Heavy Testing
```
Action                          | Requests Used
--------------------------------|---------------
Click "Describe Page" 5 times   | 5
Click "Summarize" 3 times       | 3
Click "Is This Safe?" 4 times   | 4
"Click search" action           | 1
"Type hello" action             | 1
--------------------------------|---------------
Total in 30 seconds:            | 14/14 ⚠️
```
**Status:** At limit, next request will be blocked

### Scenario 3: Hitting Limit
```
Action                          | Requests Used
--------------------------------|---------------
Rapid clicking "Describe Page"  | 14 in 10 sec
Try one more time               | BLOCKED ❌
--------------------------------|---------------
Error message:
"Please slow down. You've made too many requests.
Wait 50 seconds before trying again."
```

---

## Which Actions Count as Requests?

### ✅ Counts as 1 Request Each:

**Text Input:**
- Any message you type and send

**Quick Actions:**
- "👁️ Describe Page" button
- "📝 Summarize" button
- "⚠️ Is This Safe?" button

**Web Automation:**
- "Go to google.com"
- "Click the login button"
- "Type hello world"
- "Scroll down"

**Voice Input:**
- Any voice command (same as text)

### ❌ Does NOT Count as Request:

- Opening the side panel
- Clicking the extension icon
- Opening settings
- Saving API keys
- Muting/unmuting voice
- Content script actions (after plan is made)

---

## Long-Term Solutions

### Option 1: Upgrade API Tier (Recommended)

**Free Tier:**
- 15 requests per minute
- 1,500 requests per day
- $0 cost

**Paid Tier:**
- 1,000 requests per minute
- 30,000 requests per day
- ~$0.00015 per request (very cheap)
- **Cost example:** 1,000 requests = $0.15

**How to upgrade:**
1. Go to https://console.cloud.google.com/
2. Create/select project
3. Enable Gemini API
4. Enable billing
5. Generate new API key
6. Replace in extension settings

### Option 2: Optimize Usage

**Tips to reduce requests:**

1. **Batch questions** instead of asking multiple times:
   ```
   ❌ Bad:
   "What is on this page?"
   "Are there any buttons?"
   "What links are available?"

   ✅ Good:
   "What is on this page? List all buttons and links."
   ```

2. **Use voice less frequently** during testing:
   - Type instead of voice for repeated tests
   - Voice transcription doesn't count, but the message does

3. **Wait between tests:**
   - 5 seconds between requests = safe
   - 3 requests per minute = very safe

4. **Cache results** (future enhancement):
   - Remember page descriptions for a few minutes
   - Only re-analyze if page changes

### Option 3: Local Model (Advanced)

For development/testing, consider:
- Ollama with Llama 3.2 Vision (local)
- No rate limits
- Free forever
- Requires powerful computer

---

## Monitoring Your Usage

### In Service Worker Console:

Watch for these logs:
```
[RateLimit] Requests in last minute: 3/14
[RateLimit] Requests remaining: 11
```

### Create a Mental Counter:

Keep track during testing:
- Each action = 1 request
- If you do 10 actions quickly = 10 requests
- If you reach 14 = wait 60 seconds

### Use a Timer:

When testing:
1. Start stopwatch
2. Make requests
3. After 14 requests, wait until timer shows 60s
4. Reset and continue

---

## FAQ

### Q: Why 14 instead of 15?
**A:** Safe buffer. Keeps you under the limit even with slight timing variations.

### Q: Does the limit reset exactly at 60 seconds?
**A:** It's a rolling window. Requests fall off 60 seconds after they were made.

Example:
```
00:00 - Make request #1
00:05 - Make request #2
01:00 - Request #1 falls off (can make new request)
01:05 - Request #2 falls off (can make new request)
```

### Q: Can I disable rate limiting?
**A:** Yes, but not recommended. You'll hit the API limit and get blocked for longer.

To disable (not recommended):
```javascript
// In background.js, change:
const RATE_LIMIT_MAX = 14;
// To:
const RATE_LIMIT_MAX = 999; // Effectively disabled
```

### Q: What if I have a paid tier?
**A:** Update the limit:
```javascript
const RATE_LIMIT_MAX = 999; // For paid tier (1000 RPM)
```

### Q: Does this persist across extension reloads?
**A:** No. Reloading the extension resets the counter to 0.

---

## Troubleshooting

### "I'm still hitting the API rate limit"

**Cause:** You hit the API limit before the client-side limiter kicked in.

**Fix:**
1. Reload the extension (resets counter)
2. Wait 60 seconds
3. The new rate limiter will work now

### "It's blocking me even though I waited"

**Cause:** Service worker might have restarted, lost timestamps.

**Fix:**
1. Check console for: `[onStartup] Vision Agent service worker starting...`
2. If you see this, the counter was reset
3. Your requests should work now

### "I want to test faster"

**Options:**
1. Get a paid API tier (1000 RPM)
2. Temporarily increase limit in code (not recommended)
3. Use multiple API keys (not recommended, against ToS)

---

## Summary

### Before (No Rate Limiting):
```
User makes 15+ rapid requests
    ↓
Hits Gemini API limit
    ↓
Gets generic error
    ↓
All requests fail for 60+ seconds
    ↓
User confused about what happened
```

### After (With Rate Limiting):
```
User makes 14 requests
    ↓
Client blocks request #15
    ↓
Shows: "Wait X seconds"
    ↓
User waits X seconds
    ↓
Request succeeds
    ↓
User understands the limit
```

---

## Next Steps

1. **Right now:** Wait 60 seconds, then test
2. **Reload extension** to load the new rate limiting code
3. **Test normally** - rate limiter will protect you
4. **Consider upgrading** to paid tier if you'll use it heavily

---

**Rate limiting implemented:** 2026-01-10
**Default limit:** 14 requests/minute (Gemini free tier)
