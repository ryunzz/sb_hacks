# Quick Start Cheat Sheet

## First Time Setup (5 minutes)

```bash
# 1. Create virtual environment
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
python3 -m venv venv

# 2. Activate and install
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# 3. Add your API key (get from https://aistudio.google.com/app/apikey)
echo "your_api_key_here" > gemini_api_key
```

---

## Run Every Time (2 terminals)

### Terminal 1: Chrome
```bash
killall "Google Chrome" 2>/dev/null || true
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

### Terminal 2: Backend
```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
source venv/bin/activate
python websocket_server.py
```

**Or use the script:**
```bash
cd /Users/zixiangzheng/ryunzz/sb_hacks/backend
./start.sh
```

---

## Test It

1. Click extension icon in Chrome
2. Type: `Go to github.com`
3. Press Enter

Should navigate to GitHub automatically! ✓

---

## Stop

- Terminal 1 & 2: Press `Ctrl+C`

---

## Common Issues

**"Failed to connect to Chrome"**
→ Check http://localhost:9222/json shows tabs

**"Connection refused"**
→ Backend not running or wrong port

**"Missing API key"**
→ Create file: `echo "key" > gemini_api_key`

**"ModuleNotFoundError"**
→ Activate venv: `source venv/bin/activate`

---

See **INSTRUCTIONS.md** for detailed setup guide.
