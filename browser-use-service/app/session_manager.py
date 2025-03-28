import os
import json
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from browser_use.browser.browser import Browser
import asyncio

class LinkedInSessionManager:
    """Manages LinkedIn authentication sessions and cookie persistence."""
    
    def __init__(self, storage_dir: str = "sessions"):
        """
        Initialize the session manager.
        
        Args:
            storage_dir: Directory to store session data
        """
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.cookie_file = self.storage_dir / "linkedin_cookies.json"
        self.session_file = self.storage_dir / "linkedin_session.json"
        
    async def is_logged_in(self, browser: Browser) -> bool:
        """
        Check if the current browser session is logged into LinkedIn.
        
        Args:
            browser: Browser instance to check
            
        Returns:
            bool: True if logged in, False otherwise
        """
        try:
            # Navigate to Sales Navigator
            await browser.goto("https://www.linkedin.com/sales")
            
            # Check for login page redirect
            current_url = browser.current_url
            if "login" in current_url.lower():
                return False
                
            # Try to find a common authenticated element
            profile_button = await browser.wait_for_selector('[data-control-name="nav_profile_dropdown"]', timeout=5000)
            return profile_button is not None
            
        except Exception as e:
            print(f"Error checking login status: {str(e)}")
            return False
            
    async def save_session(self, browser: Browser) -> bool:
        """
        Save the current browser session cookies and state.
        
        Args:
            browser: Browser instance to save session from
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            # Get cookies from browser
            cookies = await browser.context.cookies()
            
            # Save cookies
            with open(self.cookie_file, 'w') as f:
                json.dump(cookies, f)
                
            # Save session metadata
            session_data = {
                "last_saved": datetime.now().isoformat(),
                "domain": "linkedin.com",
                "is_valid": True
            }
            
            with open(self.session_file, 'w') as f:
                json.dump(session_data, f)
                
            return True
            
        except Exception as e:
            print(f"Error saving session: {str(e)}")
            return False
            
    async def load_session(self, browser: Browser) -> bool:
        """
        Load saved session cookies into the browser.
        
        Args:
            browser: Browser instance to load session into
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            if not self.cookie_file.exists():
                return False
                
            # Check session validity
            if self.session_file.exists():
                with open(self.session_file, 'r') as f:
                    session_data = json.load(f)
                    
                last_saved = datetime.fromisoformat(session_data["last_saved"])
                if datetime.now() - last_saved > timedelta(days=7):  # Session expired after 7 days
                    return False
                    
                if not session_data.get("is_valid", False):
                    return False
            
            # Load cookies
            with open(self.cookie_file, 'r') as f:
                cookies = json.load(f)
                
            # Set cookies in browser
            await browser.context.add_cookies(cookies)
            
            # Verify login status
            return await self.is_logged_in(browser)
            
        except Exception as e:
            print(f"Error loading session: {str(e)}")
            return False
            
    async def clear_session(self) -> bool:
        """
        Clear saved session data.
        
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            if self.cookie_file.exists():
                self.cookie_file.unlink()
            if self.session_file.exists():
                self.session_file.unlink()
            return True
        except Exception as e:
            print(f"Error clearing session: {str(e)}")
            return False
            
    async def handle_login(self, browser: Browser, credentials: Optional[Dict[str, str]] = None) -> bool:
        """
        Handle LinkedIn login process.
        
        Args:
            browser: Browser instance to use for login
            credentials: Optional dictionary with 'username' and 'password'
            
        Returns:
            bool: True if login successful, False otherwise
        """
        try:
            # First try to load existing session
            if await self.load_session(browser):
                return True
                
            # Navigate to login page
            await browser.goto("https://www.linkedin.com/login")
            
            if credentials:
                # Automated login if credentials provided
                username_input = await browser.wait_for_selector('#username')
                password_input = await browser.wait_for_selector('#password')
                
                if not username_input or not password_input:
                    return False
                    
                await username_input.fill(credentials["username"])
                await password_input.fill(credentials["password"])
                
                # Click login button
                login_button = await browser.wait_for_selector('button[type="submit"]')
                if login_button:
                    await login_button.click()
            else:
                # Wait for manual login
                print("Please log in manually in the browser window...")
                
                # Wait up to 5 minutes for login
                timeout = 300
                while timeout > 0:
                    if await self.is_logged_in(browser):
                        break
                    await asyncio.sleep(1)
                    timeout -= 1
                    
                if timeout <= 0:
                    print("Login timeout exceeded")
                    return False
            
            # Verify login success
            if await self.is_logged_in(browser):
                # Save the new session
                await self.save_session(browser)
                return True
                
            return False
            
        except Exception as e:
            print(f"Error during login: {str(e)}")
            return False 