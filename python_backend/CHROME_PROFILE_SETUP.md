# Using Your Default Chrome Profile with Vision Agent

## The Problem

When you run Chrome with CDP (Chrome DevTools Protocol), you have two options:

1. **Temporary Profile** - Clean slate, no extensions, no logins
2. **Default Profile** - Your normal Chrome with everything you have

The Vision Agent now uses **Option 2 by default** so you get:
- ✅ All your Chrome extensions (Vision Agent stays installed!)
- ✅ All your Google account logins
- ✅ All your bookmarks and browsing history
- ✅ All your saved passwords and autofill data

---

## Quick Start (Using Your Default Profile)

### Step 1: Close ALL Chrome Windows

**IMPORTANT:** You must completely quit Chrome first.

```bash
# Close Chrome completely
pkill -f "Google Chrome"
```

Or manually: Chrome menu → Quit Chrome (⌘Q)

### Step 2: Launch Chrome with CDP

```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/python_backend
./launch_chrome.sh
```

This will:
- ✅ Launch Chrome with your DEFAULT profile
- ✅ Enable CDP on port 9222
- ✅ Keep all your extensions, logins, etc.

### Step 3: Verify Extension is Loaded

1. Open Chrome that just launched
2. Go to `chrome://extensions/`
3. Look for "Vision Agent"

**If Vision Agent is already there:** ✅ You're done!

**If Vision Agent is NOT there:**
1. Enable "Developer mode" (toggle top-right)
2. Click "Load unpacked"
3. Select: `/Users/zixiangzheng/ryunzz/sb_hacks/`

### Step 4: Start Python Backend

```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/python_backend
source venv/bin/activate
python main.py
```

You should see:
```
[Playwright] Found X open tab(s)
[Playwright] Will detect active tab before each action
```

### Step 5: Use It!

1. Click Vision Agent extension icon
2. Say or type: "Go to github.com"
3. ✅ Should work on the active tab!

---

## Why This Works

### The Technical Explanation

Chrome profiles are stored at:
- **macOS:** `~/Library/Application Support/Google/Chrome/Default/`
- **Linux:** `~/.config/google-chrome/Default/`
- **Windows:** `%LOCALAPPDATA%\Google\Chrome\User Data\Default\`

When you launch Chrome:
- **With `--user-data-dir=/tmp/chrome-debug`** → Uses temporary profile (empty)
- **Without `--user-data-dir`** → Uses default profile (your normal Chrome)

### What the Script Does

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222  # Enable CDP
  # No --user-data-dir = use default profile!
```

---

## Troubleshooting

### "Chrome is already running"

**Problem:** You didn't close Chrome completely.

**Solution:**
```bash
pkill -f "Google Chrome"
# Wait 2 seconds
./launch_chrome.sh
```

### "Extension not found after launch"

**Problem:** Extension was never installed in your default profile.

**Solution:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select extension directory
5. Extension now persists in your default profile!

### "Can't connect to CDP"

**Problem:** Chrome didn't launch with CDP enabled.

**Solution:**
```bash
# Verify CDP is running
curl http://localhost:9222/json

# Should return JSON with open tabs
# If error, restart:
pkill -f "remote-debugging-port=9222"
./launch_chrome.sh
```

### "Google account not signed in"

**Problem:** Using temporary profile instead of default.

**Solution:**
- Make sure you're using the updated `launch_chrome.sh`
- Should NOT see `--user-data-dir=/tmp/chrome-debug` in launch command
- Check: `ps aux | grep chrome | grep remote-debugging`

---

## Benefits of Using Default Profile

| Feature | Temporary Profile | Default Profile ✅ |
|---------|------------------|-------------------|
| Chrome extensions | ❌ Need to reload each time | ✅ Already installed |
| Google account | ❌ Need to login each time | ✅ Already logged in |
| Bookmarks | ❌ Empty | ✅ All your bookmarks |
| History | ❌ Empty | ✅ All your history |
| Passwords | ❌ Empty | ✅ Autofill works |
| Settings | ❌ Default | ✅ Your preferences |
| Cookies | ❌ Empty | ✅ Stay logged into sites |

---

## Security Note

**Is it safe to use my default profile?**

✅ **Yes!** This is the same Chrome profile you use every day. The only difference is:
- CDP is enabled (allows programmatic control)
- Only localhost (your computer) can connect
- Port 9222 is not exposed to the internet

**Best practices:**
- Only run this on your local machine
- Don't expose port 9222 to the internet
- Close Chrome CDP when not using Vision Agent
- Your passwords, cookies, and data remain secure

---

## Alternative: Create a Dedicated Profile

If you want a separate profile just for Vision Agent (with extensions but not your personal data):

### Step 1: Create New Profile in Chrome

1. Open regular Chrome
2. Click profile icon (top-right)
3. Click "Add"
4. Create profile named "Vision Agent"
5. Install Vision Agent extension in this profile
6. Sign into Google account if needed

### Step 2: Find Profile Directory

The new profile is at:
```
~/Library/Application Support/Google/Chrome/Profile 1/
```

(Profile numbers start at "Profile 1", "Profile 2", etc.)

### Step 3: Launch with Specific Profile

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --profile-directory="Profile 1"
```

Now you have:
- ✅ Dedicated profile for Vision Agent
- ✅ Extension installed
- ✅ Separate from your personal browsing
- ✅ Can sign into Google with work/test account

---

## Summary

**Recommended Setup:**
1. Use default profile (easiest)
2. Extension persists across launches
3. All your logins and settings available
4. Just close Chrome, run script, use it!

**Command:**
```bash
# Close Chrome
pkill -f "Google Chrome"

# Launch with default profile + CDP
./launch_chrome.sh

# Start backend
python main.py

# Use Vision Agent!
```

🎉 **Done!** Your Chrome with all your stuff + CDP enabled.
