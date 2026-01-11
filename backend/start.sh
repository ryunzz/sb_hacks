#!/bin/bash

echo "=== Starting Gemini CUA Agent ==="
echo ""

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "ERROR: Virtual environment not found!"
    echo "Run setup first:"
    echo "  python3 -m venv venv"
    echo "  source venv/bin/activate"
    echo "  pip install -r requirements.txt"
    echo "  playwright install chromium"
    exit 1
fi

# Activate venv
source venv/bin/activate

# Check API key
if [ ! -f "gemini_api_key" ]; then
    echo "ERROR: gemini_api_key file not found!"
    echo ""
    echo "Get your API key from: https://aistudio.google.com/app/apikey"
    echo ""
    echo "Then create the file:"
    echo "  echo 'your_api_key_here' > gemini_api_key"
    echo ""
    exit 1
fi

# Start server
echo "✓ Virtual environment activated"
echo "✓ API key found"
echo ""
echo "Starting WebSocket server..."
echo "Press Ctrl+C to stop"
echo ""
python websocket_server.py
