from browser_use.browser.browser import Browser as BrowserUse, BrowserConfig
from typing import Optional, Dict, Any
import base64
from playwright.async_api import Page, Browser as PlaywrightBrowser, BrowserContext


class BrowserContext:
    """Wrapper for browser context to handle missing methods."""
    
    def __init__(self, context: BrowserContext, page: Page):
        self.context = context
        self.page = page
        
    async def get_current_page(self) -> Page:
        """Get the current page."""
        return self.page
        
    async def take_screenshot(self) -> str:
        """Take a screenshot of the current page and return as base64."""
        screenshot_bytes = await self.page.screenshot()
        return base64.b64encode(screenshot_bytes).decode('utf-8')


class Browser:
    """Wrapper class for browser-use Browser to handle missing methods."""
    
    def __init__(self, config: BrowserConfig):
        """Initialize with the browser-use Browser."""
        self.browser_use = BrowserUse(config=config)
        self._browser: Optional[PlaywrightBrowser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        
    async def new_context(self) -> BrowserContext:
        """Create a new browser context with a page."""
        if not self._browser:
            # Get the underlying Playwright browser
            self._browser = await self.browser_use.browser
            
        # Create a new context
        playwright_context = await self._browser.new_context()
        
        # Create a new page in the context
        playwright_page = await playwright_context.new_page()
        
        # Wrap the context with our wrapper
        self._context = BrowserContext(playwright_context, playwright_page)
        return self._context
    
    async def close(self):
        """Close the browser."""
        if self._browser:
            await self._browser.close()
            self._browser = None
            self._context = None
            self._page = None
        
        # Also try to close the browser-use browser
        try:
            await self.browser_use.close()
        except:
            pass 