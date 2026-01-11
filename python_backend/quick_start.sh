#!/bin/bash
# Quick Start Script for Vision Agent Backend
# Automates setup and provides helpful guidance

set -e  # Exit on error

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Vision Agent - Quick Start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3.8+"
    exit 1
fi
echo "✅ Python 3 found: $(python3 --version)"

# Check if venv exists
if [ ! -d "venv" ]; then
    echo ""
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
fi

# Activate venv
echo ""
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Check if dependencies are installed
if ! python -c "import google.generativeai" 2>/dev/null; then
    echo ""
    echo "📦 Installing Python dependencies..."
    pip install -q -r requirements.txt
    echo "✅ Dependencies installed"

    echo ""
    echo "📦 Installing Playwright browsers..."
    playwright install chromium
    echo "✅ Playwright browsers installed"
else
    echo "✅ Dependencies already installed"
fi

# Check .env file
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  .env file not found"
    echo "📝 Creating .env from template..."
    cp .env.template .env
    echo "✅ .env file created"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚠️  IMPORTANT: You need to add your Gemini API key!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "1. Get your API key from: https://ai.google.dev/"
    echo "2. Edit .env file and replace 'your_gemini_api_key_here'"
    echo "3. Run this script again"
    echo ""
    exit 0
fi

# Check if API key is set
if grep -q "your_gemini_api_key_here" .env; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚠️  Gemini API key not configured!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Please edit .env file and add your Gemini API key:"
    echo "  GEMINI_API_KEY=your_actual_api_key_here"
    echo ""
    echo "Get your API key from: https://ai.google.dev/"
    echo ""
    exit 1
fi

echo "✅ .env file configured"

# Check if Chrome with CDP is running
if ! curl -s http://localhost:9222/json > /dev/null 2>&1; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚠️  Chrome with CDP is not running"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Starting Chrome with CDP in 3 seconds..."
    echo "(You can Ctrl+C to cancel and run ./launch_chrome.sh manually)"
    sleep 3

    ./launch_chrome.sh

    echo ""
    echo "Waiting for Chrome to start..."
    sleep 2
fi

echo "✅ Chrome with CDP is running"

# All checks passed
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All prerequisites ready!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Load the Vision Agent extension in the CDP Chrome window:"
echo "   - Go to chrome://extensions/"
echo "   - Enable 'Developer mode'"
echo "   - Click 'Load unpacked'"
echo "   - Select the extension directory"
echo ""
echo "2. Configure extension API keys:"
echo "   - Click extension icon"
echo "   - Click settings/gear icon"
echo "   - Add Gemini API key"
echo "   - Add Deepgram API key (for voice)"
echo "   - Click 'Save Settings'"
echo ""
echo "3. Start the backend:"
echo "   python main.py"
echo ""
echo "Press Enter to start the backend now, or Ctrl+C to cancel..."
read -r

# Start the backend
echo ""
python main.py
