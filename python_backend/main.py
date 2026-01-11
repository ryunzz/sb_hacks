"""
Vision Agent - Python Backend Entry Point

Orchestrates:
- Playwright CDP controller (browser automation)
- Gemini 2.5 Computer Use agent (AI decision making)
- WebSocket server (Extension ↔ Backend communication)
"""
import asyncio
import sys
from config import Config
from playwright_controller import PlaywrightController
from gemini_agent import GeminiAgent
from websocket_server import WebSocketServer


async def main():
    """Main entry point - initialize and start all services"""
    print('[Init] Starting Vision Agent backend...')
    print(f'[Init] WebSocket server: ws://{Config.WEBSOCKET_HOST}:{Config.WEBSOCKET_PORT}')
    print(f'[Init] Chrome CDP: http://localhost:{Config.CHROME_CDP_PORT}')
    print()

    # Validate API key
    if not Config.GEMINI_API_KEY:
        print('❌ ERROR: GEMINI_API_KEY not found in .env file')
        print('   Please copy .env.template to .env and add your API key')
        sys.exit(1)

    # Initialize Playwright controller
    print('[Init] Initializing Playwright CDP controller...')
    cdp_url = f'http://localhost:{Config.CHROME_CDP_PORT}'
    controller = PlaywrightController(cdp_url)

    try:
        # Connect to Chrome via CDP
        await controller.connect_to_chrome()
        print('[Init] ✓ Connected to Chrome via CDP')
    except Exception as error:
        print(f'❌ ERROR: Failed to connect to Chrome via CDP: {error}')
        print()
        print('⚠️  Make sure Chrome is running with CDP enabled:')
        print('   Run: ./launch_chrome.sh')
        print()
        sys.exit(1)

    # Initialize Gemini agent
    print('[Init] Initializing Gemini Computer Use agent...')
    try:
        agent = GeminiAgent(Config.GEMINI_API_KEY, controller)
        print('[Init] ✓ Gemini agent initialized')
    except Exception as error:
        print(f'❌ ERROR: Failed to initialize Gemini agent: {error}')
        sys.exit(1)

    # Initialize WebSocket server
    print('[Init] Initializing WebSocket server...')
    ws_server = WebSocketServer(
        host=Config.WEBSOCKET_HOST,
        port=Config.WEBSOCKET_PORT
    )

    # Wire agent to WebSocket server
    ws_server.agent = agent

    # Start WebSocket server
    print(f'[Init] ✓ WebSocket server starting on port {Config.WEBSOCKET_PORT}')
    print()
    print('=' * 60)
    print('🚀 Vision Agent Backend is READY!')
    print('=' * 60)
    print()
    print('📋 Next steps:')
    print('   1. Ensure Chrome is running (with CDP on port 9222)')
    print('   2. Load the Vision Agent extension in that Chrome window')
    print('   3. Open the extension side panel')
    print('   4. Start using voice or text commands!')
    print()
    print('💡 Try commands like:')
    print('   - "Go to github.com"')
    print('   - "Help me search for Python tutorials"')
    print('   - "Click the login button"')
    print()
    print('Press Ctrl+C to stop the backend')
    print()

    try:
        # Start WebSocket server (runs forever)
        await ws_server.start()
    except KeyboardInterrupt:
        print('\n[Shutdown] Stopping backend...')
        await controller.close()
        print('[Shutdown] ✓ Backend stopped')


if __name__ == '__main__':
    # Run the async main function
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\n[Shutdown] Interrupted by user')
        sys.exit(0)
