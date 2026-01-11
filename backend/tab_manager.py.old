"""
Tab Manager - Handles multi-tab scenarios
Dynamically detects and switches between browser tabs
"""

from typing import List, Tuple, Optional
from playwright.async_api import Page, BrowserContext


class TabManager:
    """Manages multiple browser tabs for the agent"""

    def __init__(self, context: BrowserContext):
        """
        Initialize tab manager

        Args:
            context: Playwright BrowserContext with existing tabs
        """
        self.context = context
        self.active_page: Optional[Page] = None

    async def get_active_page(self) -> Page:
        """
        Get currently active tab (or create one if none exist)

        Returns:
            Page: The active browser tab

        Note:
            If multiple tabs are open, returns the most recently created/used tab.
            This heuristic works well for most scenarios where new tabs are
            opened by clicks.
        """
        pages = self.context.pages

        if not pages:
            # No tabs open, create a new one
            print("[TabManager] No tabs found, creating new tab")
            self.active_page = await self.context.new_page()
        else:
            # Return most recently created page (last in list)
            # This works because Playwright maintains pages in creation order
            self.active_page = pages[-1]

            # Debug info
            print(f"[TabManager] Active tab: {self.active_page.title()[:50]}... ({self.active_page.url})")

        return self.active_page

    def get_all_tabs(self) -> List[Tuple[int, str, str]]:
        """
        Get list of all open tabs

        Returns:
            List of tuples: (index, url, title) for each tab
        """
        pages = self.context.pages
        tabs = []

        for i, page in enumerate(pages):
            try:
                url = page.url
                title = page.title()
            except Exception:
                url = "unknown"
                title = "Error loading tab info"

            tabs.append((i, url, title))

        return tabs

    async def switch_to_tab(self, index: int) -> bool:
        """
        Switch to specific tab by index

        Args:
            index: Zero-based tab index

        Returns:
            bool: True if successful, False if index out of range
        """
        pages = self.context.pages

        if 0 <= index < len(pages):
            self.active_page = pages[index]
            try:
                await self.active_page.bring_to_front()
                print(f"[TabManager] Switched to tab {index}: {self.active_page.title()}")
                return True
            except Exception as e:
                print(f"[TabManager] Error bringing tab to front: {e}")
                return False
        else:
            print(f"[TabManager] Invalid tab index {index} (only {len(pages)} tabs open)")
            return False

    def get_tab_count(self) -> int:
        """
        Get number of open tabs

        Returns:
            int: Number of tabs
        """
        return len(self.context.pages)

    def get_tab_context_string(self) -> str:
        """
        Get human-readable string describing current tab context

        Returns:
            str: Tab context for inclusion in agent prompts/screenshots

        Example:
            "Current tab: GitHub - Profile (https://github.com/user)
             Open tabs: 3"
        """
        if not self.active_page:
            self.get_active_page()

        try:
            title = self.active_page.title()
            url = self.active_page.url
            tab_count = self.get_tab_count()

            context = f"Current tab: {title} ({url})\n"
            context += f"Open tabs: {tab_count}"

            if tab_count > 1:
                context += f" [Tab {len(self.context.pages)}]"

            return context
        except Exception as e:
            return f"Error getting tab context: {e}"

    async def close_current_tab(self) -> bool:
        """
        Close the currently active tab

        Returns:
            bool: True if successful, False otherwise

        Note:
            After closing, switches to the most recent remaining tab
        """
        if not self.active_page:
            return False

        try:
            await self.active_page.close()
            print(f"[TabManager] Closed tab")

            # Switch to new active tab
            if self.get_tab_count() > 0:
                self.active_page = self.context.pages[-1]
                await self.active_page.bring_to_front()
            else:
                self.active_page = None

            return True
        except Exception as e:
            print(f"[TabManager] Error closing tab: {e}")
            return False

    async def handle_new_tab(self, page: Page):
        """
        Handle a new tab being opened

        Args:
            page: The newly created Page object

        Note:
            This can be used as a callback for context.on("page", ...)
            to track when links open new tabs
        """
        print(f"[TabManager] New tab detected: {page.url}")
        self.active_page = page

        try:
            await page.bring_to_front()
        except Exception as e:
            print(f"[TabManager] Error bringing new tab to front: {e}")
