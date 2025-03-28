from browser_use.browser.browser import Browser
from browser_use.controller.service import Controller
from browser_use.agent.views import ActionResult
from typing import Optional
import time

class LinkedInActions:
    """Custom LinkedIn actions for browser-use automation."""
    
    def __init__(self, controller: Controller):
        self.controller = controller
        self.browser = None

    def register_actions(self):
        """Register all LinkedIn actions with the controller."""
        
        @self.controller.action("Open LinkedIn Sales Navigator search with the given query")
        async def open_sales_nav_search(query: str, browser: Browser) -> ActionResult:
            """
            Navigate to LinkedIn Sales Navigator and perform a search.
            
            Args:
                query: The search query to use
                
            Returns:
                ActionResult: Result of the action
            """
            try:
                # Navigate to Sales Navigator search
                page = await browser.get_current_page()
                await page.goto("https://www.linkedin.com/sales/search/people")
                
                # Wait for the search input field
                search_input = await page.wait_for_selector('input[placeholder*="Search"]', timeout=10000)
                if not search_input:
                    return ActionResult(error="Could not find search input")
                    
                # Clear existing search and type new query
                await search_input.click()
                await search_input.fill("")
                await search_input.fill(query)
                
                # Press Enter to perform search
                await search_input.press("Enter")
                
                # Wait for results to load
                await page.wait_for_selector(".search-results__result-item", timeout=10000)
                
                msg = f"🔍 Searched for '{query}' in Sales Navigator"
                return ActionResult(extracted_content=msg, include_in_memory=True)
            except Exception as e:
                return ActionResult(error=f"Error in open_sales_nav_search: {str(e)}")

        @self.controller.action("Save a LinkedIn profile to a list")
        async def save_profile(profile_identifier: str, browser: Browser) -> ActionResult:
            """
            Save a profile to a LinkedIn list.
            
            Args:
                profile_identifier: URL or unique identifier of the profile
                
            Returns:
                ActionResult: Result of the action
            """
            try:
                page = await browser.get_current_page()
                # Navigate to the profile if a URL is provided
                if profile_identifier.startswith("http"):
                    await page.goto(profile_identifier)
                    
                # Click the save button
                save_button = await page.wait_for_selector('button[aria-label*="Save to list"]', timeout=5000)
                if not save_button:
                    return ActionResult(error="Could not find save button")
                    
                await save_button.click()
                
                # Wait for save dialog and confirm
                save_dialog = await page.wait_for_selector('.artdeco-modal', timeout=5000)
                if not save_dialog:
                    return ActionResult(error="Save dialog did not appear")
                    
                # Click the save/confirm button in the dialog
                confirm_button = await page.wait_for_selector('button[type="submit"]', timeout=5000)
                if confirm_button:
                    await confirm_button.click()
                    
                msg = f"💾 Saved profile {profile_identifier} to list"
                return ActionResult(extracted_content=msg, include_in_memory=True)
            except Exception as e:
                return ActionResult(error=f"Error in save_profile: {str(e)}")

        @self.controller.action("Send a connection request to a LinkedIn profile")
        async def connect_profile(profile_identifier: str, message: Optional[str], browser: Browser) -> ActionResult:
            """
            Send a connection request to a profile.
            
            Args:
                profile_identifier: URL or unique identifier of the profile
                message: Optional connection message
                
            Returns:
                ActionResult: Result of the action
            """
            try:
                page = await browser.get_current_page()
                # Navigate to the profile if a URL is provided
                if profile_identifier.startswith("http"):
                    await page.goto(profile_identifier)
                    
                # Click the connect button
                connect_button = await page.wait_for_selector('button[aria-label*="Connect"]', timeout=5000)
                if not connect_button:
                    return ActionResult(error="Could not find connect button")
                    
                await connect_button.click()
                
                if message:
                    # Wait for the "Add a note" button if available
                    add_note_button = await page.wait_for_selector('button[aria-label*="Add a note"]', timeout=5000)
                    if add_note_button:
                        await add_note_button.click()
                        
                        # Wait for and fill the message input
                        message_input = await page.wait_for_selector('textarea[name="message"]', timeout=5000)
                        if message_input:
                            await message_input.fill(message)
                
                # Click the send/connect button
                send_button = await page.wait_for_selector('button[aria-label*="Send now"]', timeout=5000)
                if send_button:
                    await send_button.click()
                    
                msg = f"🤝 Sent connection request to {profile_identifier}"
                if message:
                    msg += " with message"
                return ActionResult(extracted_content=msg, include_in_memory=True)
            except Exception as e:
                return ActionResult(error=f"Error in connect_profile: {str(e)}")

        @self.controller.action("Send a message to a LinkedIn profile")
        async def send_message(profile_identifier: str, message: str, browser: Browser) -> ActionResult:
            """
            Send a message to a profile.
            
            Args:
                profile_identifier: URL or unique identifier of the profile
                message: The message to send
                
            Returns:
                ActionResult: Result of the action
            """
            try:
                page = await browser.get_current_page()
                # Navigate to the profile if a URL is provided
                if profile_identifier.startswith("http"):
                    await page.goto(profile_identifier)
                    
                # Click the message button
                message_button = await page.wait_for_selector('button[aria-label*="Message"]', timeout=5000)
                if not message_button:
                    return ActionResult(error="Could not find message button")
                    
                await message_button.click()
                
                # Wait for the message input field
                message_input = await page.wait_for_selector('[contenteditable="true"]', timeout=5000)
                if not message_input:
                    return ActionResult(error="Could not find message input")
                    
                # Type the message
                await message_input.fill(message)
                
                # Click the send button
                send_button = await page.wait_for_selector('button[aria-label*="Send"]', timeout=5000)
                if send_button:
                    await send_button.click()
                    
                msg = f"📨 Sent message to {profile_identifier}"
                return ActionResult(extracted_content=msg, include_in_memory=True)
            except Exception as e:
                return ActionResult(error=f"Error in send_message: {str(e)}") 