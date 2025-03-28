"""
Module to patch the browser-use Browser class with missing methods.
"""
import asyncio
from typing import Any, Dict, Optional
import base64
from browser_use.browser.browser import Browser as OriginalBrowser


async def new_context(self):
    """
    Add new_context method to the Browser class.
    This method should return a context that can be used to interact with the browser.
    """
    # Get the underlying Playwright browser - note that self.browser is already an awaitable
    # Not self._browser = await self.browser
    browser = self.browser  # This is already an awaitable property
    
    # Create a new context directly from the Browser instance
    # Rather than awaiting a property that doesn't exist
    playwright_context = await browser._context.new_context() if hasattr(browser, '_context') else await browser
    
    # Create a new page in the context
    playwright_page = await playwright_context.new_page()
    
    # Create a wrapper for the context
    return BrowserContextWrapper(playwright_context, playwright_page)


async def get_current_page(self):
    """
    Add get_current_page method to the Browser class.
    This method should return the current page.
    """
    if hasattr(self, '_page') and self._page:
        return self._page
    
    # If there's no page yet, create one
    browser = await self.browser
    if not hasattr(self, '_context') or not self._context:
        self._context = await browser.new_context()
    
    self._page = await self._context.new_page()
    return self._page


class BrowserContextWrapper:
    """
    Wrapper for browser context to handle methods needed by the API.
    """
    def __init__(self, context, page):
        self.context = context
        self.page = page
    
    async def get_current_page(self):
        """Get the current page."""
        return self.page
    
    async def take_screenshot(self):
        """Take a screenshot and return it as base64 string."""
        screenshot_bytes = await self.page.screenshot()
        return base64.b64encode(screenshot_bytes).decode('utf-8')


def patch_browser():
    """
    Patch the browser-use Browser class with missing methods.
    """
    # Add the new_context method
    if not hasattr(OriginalBrowser, 'new_context'):
        OriginalBrowser.new_context = new_context
    
    # Add the get_current_page method
    if not hasattr(OriginalBrowser, 'get_current_page'):
        OriginalBrowser.get_current_page = get_current_page 