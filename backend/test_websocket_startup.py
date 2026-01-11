"""
Quick test to verify WebSocket server can start
"""
import asyncio
import sys

sys.path.insert(0, '/Users/zixiangzheng/ryunzz/sb_hacks/backend')

async def test_startup():
    """Test that server can import and initialize"""
    try:
        from websocket_server import WebSocketServer
        print("✓ Successfully imported WebSocketServer")

        server = WebSocketServer()
        print("✓ Successfully created WebSocketServer instance")
        print(f"  - Host: {server.host}")
        print(f"  - Port: {server.port}")
        print(f"  - Executor: {server.executor}")
        print(f"  - Message queue: {server.message_queue}")

        # Test imports for agent
        from gemini_cua_agent import BrowserAgent
        print("✓ Successfully imported BrowserAgent")

        from computers.playwright_cdp_computer import PlaywrightCDPComputer
        print("✓ Successfully imported PlaywrightCDPComputer")

        print("\n✅ All imports successful - server should start correctly!")
        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    result = asyncio.run(test_startup())
    sys.exit(0 if result else 1)
