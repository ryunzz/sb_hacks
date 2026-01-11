"""
Playwright CDP Controller
Controls user's active Chrome tab via Chrome DevTools Protocol
"""
import asyncio
from playwright.async_api import async_playwright, Browser, Page, BrowserContext
from typing import Optional, Tuple
from config import Config


class PlaywrightController:
    """Control Chrome browser via CDP"""

    def __init__(self, cdp_url: str):
        self.cdp_url = cdp_url
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.playwright = None
        self.viewport_width = Config.VIEWPORT_WIDTH
        self.viewport_height = Config.VIEWPORT_HEIGHT

    async def connect_to_chrome(self):
        """Connect to existing Chrome instance via CDP"""
        try:
            print(f'[Playwright] Connecting to Chrome at {self.cdp_url}...')

            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.connect_over_cdp(self.cdp_url)

            print(f'[Playwright] Connected to Chrome')

            # Get all browser contexts
            contexts = self.browser.contexts

            if not contexts:
                raise Exception('No browser contexts found. Please open Chrome with CDP enabled.')

            # Use the first context (usually the default profile)
            self.context = contexts[0]

            # Check if any pages exist
            pages = self.context.pages
            if not pages:
                # Create a new page if none exist
                self.page = await self.context.new_page()
                print(f'[Playwright] Created new page')
                # Set viewport size
                await self.page.set_viewport_size({
                    'width': self.viewport_width,
                    'height': self.viewport_height
                })
            else:
                # Don't set self.page here - let get_active_tab() handle it dynamically
                print(f'[Playwright] Found {len(pages)} open tab(s)')
                print(f'[Playwright] Will detect active tab before each action')

            print(f'[Playwright] ✓ Ready to control browser')
            return True

        except Exception as error:
            print(f'[Playwright] ✗ Connection failed: {error}')
            print(f'[Playwright] Make sure Chrome is running with: --remote-debugging-port={Config.CHROME_CDP_PORT}')
            raise

    async def get_active_tab(self) -> Optional[Page]:
        """Get the currently active tab (the one user is viewing)"""
        try:
            # Get all pages from all contexts
            pages = []
            for context in self.browser.contexts:
                pages.extend(context.pages)

            if not pages:
                print('[Playwright] No pages found')
                return None

            # Try to find the currently visible/focused page
            # Check document.visibilityState to find which tab is visible
            for page in pages:
                try:
                    is_visible = await page.evaluate('() => document.visibilityState === "visible"')
                    if is_visible:
                        self.page = page
                        print(f'[Playwright] Active tab detected: {page.url[:60]}')
                        return page
                except Exception:
                    # Page might be closed or unresponsive, skip it
                    continue

            # Fallback: use the last page (most recently created/used)
            self.page = pages[-1]
            print(f'[Playwright] Using most recent tab: {self.page.url[:60]}')
            return self.page

        except Exception as error:
            print(f'[Playwright] Error getting active tab: {error}')
            return None

    async def capture_screenshot(self) -> bytes:
        """Capture screenshot of current page"""
        try:
            # ALWAYS refresh to get active tab
            await self.get_active_tab()

            if not self.page:
                raise Exception('No active tab found')

            screenshot_bytes = await self.page.screenshot(
                type='png',
                full_page=False  # Only visible viewport
            )

            print(f'[Playwright] Screenshot captured ({len(screenshot_bytes)} bytes)')
            return screenshot_bytes

        except Exception as error:
            print(f'[Playwright] Screenshot failed: {error}')
            raise

    def _normalize_to_pixels(self, normalized_x: int, normalized_y: int) -> Tuple[int, int]:
        """
        Convert Gemini's normalized coordinates (0-1000) to actual pixels

        Args:
            normalized_x: X coordinate on 0-1000 scale
            normalized_y: Y coordinate on 0-1000 scale

        Returns:
            Tuple of (pixel_x, pixel_y)
        """
        pixel_x = int((normalized_x / 1000) * self.viewport_width)
        pixel_y = int((normalized_y / 1000) * self.viewport_height)

        # Clamp to viewport bounds
        pixel_x = max(0, min(pixel_x, self.viewport_width - 1))
        pixel_y = max(0, min(pixel_y, self.viewport_height - 1))

        return (pixel_x, pixel_y)

    async def click_at(self, x: int, y: int):
        """
        Click at coordinates (Gemini uses normalized 0-999 scale)

        Args:
            x: Normalized X coordinate (0-999)
            y: Normalized Y coordinate (0-999)
        """
        try:
            # ALWAYS refresh to get active tab
            await self.get_active_tab()

            if not self.page:
                raise Exception('No active tab found')

            # Convert normalized coordinates to pixels
            pixel_x, pixel_y = self._normalize_to_pixels(x, y)

            print(f'[Playwright] Clicking at ({x}, {y}) -> pixels ({pixel_x}, {pixel_y})')

            # Click at the pixel coordinates
            await self.page.mouse.click(pixel_x, pixel_y)

            # Small delay to allow page to react
            await asyncio.sleep(0.3)

            print(f'[Playwright] ✓ Clicked')

        except Exception as error:
            print(f'[Playwright] Click failed: {error}')
            raise

    async def type_text(self, text: str):
        """
        Type text at current cursor position

        Args:
            text: Text to type
        """
        try:
            # ALWAYS refresh to get active tab
            await self.get_active_tab()

            if not self.page:
                raise Exception('No active tab found')

            print(f'[Playwright] Typing: "{text[:50]}..."')

            # Type the text character by character (more natural)
            await self.page.keyboard.type(text, delay=50)  # 50ms between chars

            # Small delay
            await asyncio.sleep(0.2)

            print(f'[Playwright] ✓ Typed {len(text)} characters')

        except Exception as error:
            print(f'[Playwright] Type failed: {error}')
            raise

    async def scroll(self, direction: str, amount: int = 500):
        """
        Scroll the page

        Args:
            direction: 'up' or 'down'
            amount: Scroll amount in pixels (default: 500)
        """
        try:
            # ALWAYS refresh to get active tab
            await self.get_active_tab()

            if not self.page:
                raise Exception('No active tab found')

            scroll_y = -amount if direction == 'up' else amount

            print(f'[Playwright] Scrolling {direction} by {amount}px')

            await self.page.evaluate(f'window.scrollBy(0, {scroll_y})')

            # Wait for scroll to settle
            await asyncio.sleep(0.3)

            print(f'[Playwright] ✓ Scrolled {direction}')

        except Exception as error:
            print(f'[Playwright] Scroll failed: {error}')
            raise

    async def navigate(self, url: str):
        """
        Navigate to URL

        Args:
            url: URL to navigate to
        """
        try:
            # ALWAYS refresh to get active tab
            await self.get_active_tab()

            if not self.page:
                raise Exception('No active tab found')

            # Ensure URL has protocol
            if not url.startswith(('http://', 'https://')):
                url = f'https://{url}'

            print(f'[Playwright] Navigating to: {url}')

            await self.page.goto(url, wait_until='domcontentloaded')

            print(f'[Playwright] ✓ Navigated to {url}')

        except Exception as error:
            print(f'[Playwright] Navigation failed: {error}')
            raise

    async def press_key(self, key: str):
        """
        Press a keyboard key

        Args:
            key: Key name (e.g., 'Enter', 'Escape', 'Tab')
        """
        try:
            # ALWAYS refresh to get active tab
            await self.get_active_tab()

            if not self.page:
                raise Exception('No active tab found')

            print(f'[Playwright] Pressing key: {key}')

            await self.page.keyboard.press(key)

            await asyncio.sleep(0.2)

            print(f'[Playwright] ✓ Pressed {key}')

        except Exception as error:
            print(f'[Playwright] Key press failed: {error}')
            raise

    async def get_current_url(self) -> str:
        """Get current page URL"""
        try:
            # ALWAYS refresh to get active tab
            await self.get_active_tab()

            if not self.page:
                raise Exception('No active tab found')

            return self.page.url

        except Exception as error:
            print(f'[Playwright] Get URL failed: {error}')
            return ''

    async def close(self):
        """Close CDP connection"""
        try:
            if self.browser:
                # Don't close the browser itself (user's Chrome)
                # Just disconnect from CDP
                await self.browser.close()
                print('[Playwright] Disconnected from Chrome')

            if self.playwright:
                await self.playwright.stop()
                print('[Playwright] Playwright stopped')

        except Exception as error:
            print(f'[Playwright] Close error: {error}')
