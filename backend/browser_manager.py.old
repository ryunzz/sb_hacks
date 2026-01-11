"""
Browser Manager - Handles Chrome DevTools Protocol (CDP) connection
Connects to existing Chrome instance with remote debugging enabled
"""

from playwright.async_api import async_playwright


class BrowserManager:
    """Manages connection to Chrome via CDP for preserving logged-in sessions"""

    def __init__(self, cdp_url="http://127.0.0.1:9222"):
        """
        Initialize browser manager

        Args:
            cdp_url: Chrome DevTools Protocol URL (default: http://127.0.0.1:9222)
        """
        self.cdp_url = cdp_url
        self.playwright = None
        self.browser = None
        self.context = None

    async def connect(self):
        """
        Connect to existing Chrome instance via CDP

        Returns:
            BrowserContext: The existing Chrome session context with all tabs

        Raises:
            RuntimeError: If Chrome is not running with remote debugging enabled
        """
        print(f"[BrowserManager] Connecting to Chrome at {self.cdp_url}...")

        try:
            self.playwright = await async_playwright().start()

            # Connect to Chrome with remote debugging
            self.browser = await self.playwright.chromium.connect_over_cdp(self.cdp_url)

            # Get default context (existing Chrome session with all tabs and logged-in state)
            if len(self.browser.contexts) > 0:
                self.context = self.browser.contexts[0]
                print(f"[BrowserManager] Connected! Found {len(self.context.pages)} open tabs")
                return self.context
            else:
                raise RuntimeError(
                    "No browser context found. "
                    "Is Chrome running with --remote-debugging-port=9222?"
                )

        except Exception as e:
            error_msg = f"Failed to connect to Chrome: {str(e)}"
            print(f"[BrowserManager] ❌ {error_msg}")
            print(
                "\nMake sure Chrome is running with remote debugging enabled:"
                "\n  macOS: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222"
                "\n  Linux: google-chrome --remote-debugging-port=9222"
                "\n  Windows: \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --remote-debugging-port=9222"
                "\n\nYou can verify Chrome is running by visiting: http://localhost:9222/json"
            )
            raise RuntimeError(error_msg)

    async def disconnect(self):
        """
        Disconnect from browser (does not close Chrome)

        Chrome continues running with all tabs and sessions intact
        """
        print("[BrowserManager] Disconnecting from Chrome...")

        if self.browser:
            try:
                await self.browser.close()
            except Exception as e:
                print(f"[BrowserManager] Warning: Error disconnecting browser: {e}")

        if self.playwright:
            try:
                await self.playwright.stop()
            except Exception as e:
                print(f"[BrowserManager] Warning: Error stopping playwright: {e}")

        print("[BrowserManager] Disconnected (Chrome still running)")

    def is_connected(self):
        """
        Check if currently connected to Chrome

        Returns:
            bool: True if connected, False otherwise
        """
        return self.browser is not None and self.context is not None
