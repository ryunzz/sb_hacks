# Vision Agent 👁️

**A conversational screen-aware web agent optimized for blind and low-vision users**

Vision Agent is a Chrome extension that helps visually impaired users navigate the internet through natural conversation, screen understanding, and web automation.

## ✨ Features

### 🎤 Voice Interaction
- **Push-to-talk** voice input using Deepgram's Nova-2 model
- **Text-to-speech** responses using Web Speech API
- Natural language conversation with context awareness

### 👁️ Screen Understanding
- **Describe any webpage** - Get a clear understanding of what's on screen
- **Analyze content** - Summarize articles, identify key information
- **Detect scams** - Check if websites are trustworthy, find hidden fees

### 🤖 Web Automation (Agent)
- Navigate to websites by speaking URLs or site names
- Click buttons and links by describing them
- Type into search boxes and forms
- Scroll through pages

## 🚀 Getting Started

### Prerequisites
- Google Chrome browser
- [Gemini API Key](https://aistudio.google.com/apikey) (required)
- [Deepgram API Key](https://console.deepgram.com/) (required for voice)

### Installation

1. **Download the extension**
   ```bash
   git clone <your-repo-url>
   cd sb_hacks
   ```

2. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `sb_hacks` folder

3. **Configure API Keys**
   - Click the Vision Agent icon in Chrome
   - Click "⚙️ Settings" in the side panel
   - Enter your Gemini and Deepgram API keys
   - Click "Save Settings"

4. **Start using**
   - Click the Vision Agent icon to open the side panel
   - Hold the microphone button and speak, or type a message
   - Try "describe this page" to get started!

## 💬 Example Commands

| What to say | What happens |
|-------------|--------------|
| "Describe this page" | Get an overview of the current webpage |
| "What are the main takeaways here?" | Summarize the important content |
| "Is this website safe?" | Analyze for scam indicators |
| "Go to google.com" | Navigate to Google |
| "Click the login button" | Click the login button |
| "Type hello in the search box" | Enter text in search field |
| "Scroll down" | Scroll the page down |

## 🏗️ Project Structure

```
sb_hacks/
├── manifest.json        # Extension configuration
├── background.js        # Service worker (Gemini integration)
├── sidepanel.html/css/js  # Main UI with voice input
├── content.js           # DOM manipulation
├── options.html/js      # Settings page
├── lib/
│   └── generative-ai.js # Bundled Gemini SDK
└── icons/               # Extension icons
```

## 🔧 Tech Stack

- **AI**: Google Gemini 2.0 Flash (vision + chat)
- **Speech-to-Text**: Deepgram Nova-2
- **Text-to-Speech**: Web Speech API
- **Platform**: Chrome Extension Manifest V3

## 🎯 Use Cases

1. **Scam Detection**: "Are there hidden fees on this page?"
2. **Article Summaries**: "What are the key points of this article?"
3. **Form Navigation**: "What form fields are on this page?"
4. **Shopping**: "What are the product details and price?"
5. **General Browsing**: "What links can I click on this page?"

## ⚙️ API Keys

### Gemini API
1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create a new API key
3. Copy and paste into Vision Agent settings

### Deepgram API
1. Go to [Deepgram Console](https://console.deepgram.com/)
2. Create a new project
3. Generate an API key
4. Copy and paste into Vision Agent settings

## 📄 License

MIT License - feel free to modify and distribute!

---

Built with ❤️ for accessibility

blind.CUM

bcum.ai

blind computer use model