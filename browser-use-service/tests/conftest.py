import pytest
import os
import json
from pathlib import Path
from typing import Dict, Any
from dotenv import load_dotenv
from browser_use.browser.browser import Browser, BrowserConfig
from app.session_manager import LinkedInSessionManager
from app.linkedin_actions import LinkedInActions
import asyncio
from datetime import datetime
from fastapi.testclient import TestClient
from app.main import app
from browser_use.controller.service import Controller
from browser_use.agent.views import ActionResult
import pytest_asyncio

# Load test environment variables
load_dotenv(".env.test")

# Set test mode flag for mock handling
os.environ["TEST_MODE"] = "true"

class MockBrowser:
    """Mock Browser class for testing."""
    def __init__(self, config=None):
        self.config = config
        self.current_url = None
        self.context = MockContext()
        self.is_logged_in = False
        self.page = MockPage()
        # Track if this is an expired session
        self.has_expired_session = False
        # Track if this is an invalid credentials situation
        self.has_invalid_credentials = False

    async def goto(self, url):
        self.current_url = url
        # Simulate redirect to login page if not logged in
        if not self.is_logged_in and "linkedin.com" in url:
            self.current_url = "https://www.linkedin.com/login"
        return True

    async def wait_for_selector(self, selector, timeout=5000):
        # Return None for expired sessions to simulate elements not found
        if self.has_expired_session:
            return None
        return MockElement()

    async def fill(self, selector, value):
        # Track invalid credentials in username field
        if selector == "#username" and value == "invalid@example.com":
            self.has_invalid_credentials = True
        return True

    async def click(self, selector):
        # Simulate successful login
        if selector == "#signin-submit" or selector == 'button[type="submit"]':
            # Don't login if credentials are invalid
            if not self.has_invalid_credentials:
                self.is_logged_in = True
        return True

    async def close(self):
        self.current_url = None
        self.is_logged_in = False
        return True
        
    async def get_current_page(self):
        return self.page

class MockContext:
    """Mock browser context for testing."""
    def __init__(self):
        self._cookies = [{"name": "test_cookie", "value": "test_value", "domain": "linkedin.com"}]
        self._is_expired = False
    
    async def cookies(self):
        return self._cookies

    async def add_cookies(self, cookies):
        self._cookies = cookies
        # Check if this is an expired session
        if cookies and isinstance(cookies, list) and len(cookies) > 0:
            # If cookies contain expired flag, track it
            if any(isinstance(c, dict) and c.get("expired") for c in cookies):
                self._is_expired = True
        return True

    async def new_page(self):
        return MockPage()

    async def close(self):
        return True

class MockPage:
    """Mock page for testing."""
    async def goto(self, url):
        return True

    async def wait_for_selector(self, selector, timeout=5000):
        return MockElement()

    async def fill(self, selector, value):
        return True

    async def click(self, selector):
        return True

    async def close(self):
        return True
        
    async def press(self, key):
        return True

class MockElement:
    """Mock element for testing."""
    async def click(self):
        return True

    async def fill(self, value):
        return True

    async def type(self, value):
        return True

    async def text_content(self):
        return "Mock text content"
        
    async def press(self, key):
        return True

@pytest.fixture
def test_credentials() -> Dict[str, str]:
    """Fixture to provide test LinkedIn credentials."""
    return {
        "username": "test_user@example.com",
        "password": "test_password"
    }

@pytest.fixture
def test_browser_info() -> Dict[str, Any]:
    """Fixture to provide test browser configuration."""
    return {
        "browser_type": "chromium",
        "headless": True
    }

@pytest_asyncio.fixture
async def browser():
    """Provide a mock browser instance for testing."""
    browser = MockBrowser(config=BrowserConfig(headless=True))
    yield browser
    await browser.close()

@pytest.fixture
def controller(browser):
    """Provide a controller instance for testing."""
    mock_controller = Controller(exclude_actions=[])
    
    # Add a mock execute_action method to the controller
    async def execute_action(action_description, params):
        """Mock execute_action method for testing."""
        # Extract action name from description for easier matching
        action_lower = action_description.lower()
        
        # Check if the profile identifier is invalid and action is for profile saving
        if "save a linkedin profile" in action_lower and "invalid" in params.get('profile_identifier', '').lower():
            return ActionResult(error="Invalid profile URL")
        # Simulate successful results for different actions
        elif "sales navigator search" in action_lower:
            return ActionResult(extracted_content=f"Searched for '{params.get('query')}' in Sales Navigator")
        elif "save a linkedin profile" in action_lower:
            return ActionResult(extracted_content=f"Saved profile {params.get('profile_identifier')} to list")
        elif "connection request" in action_lower:
            return ActionResult(extracted_content=f"Sent connection request to {params.get('profile_identifier')}")
        elif "message" in action_lower:
            return ActionResult(extracted_content=f"Sent message to {params.get('profile_identifier')}")
        else:
            return ActionResult(extracted_content="Action executed successfully")
    
    # Attach the execute_action method to the controller instance
    mock_controller.execute_action = execute_action
    return mock_controller

@pytest_asyncio.fixture
async def session_manager(browser):
    """Provide a session manager instance for testing."""
    manager = LinkedInSessionManager(storage_dir="test_sessions")
    manager.browser = browser  # Set the browser attribute separately
    return manager

@pytest.fixture
def linkedin_actions(controller):
    """Fixture to provide LinkedIn actions instance."""
    actions = LinkedInActions(controller=controller)
    actions.register_actions()
    return actions

class MetricsCollector:
    """Collect metrics during tests."""
    def __init__(self):
        self.operations = {}

    def start_operation(self, name: str):
        self.operations[name] = {"start_time": asyncio.get_event_loop().time()}

    def end_operation(self, name: str, success: bool):
        if name in self.operations:
            start_time = self.operations[name]["start_time"]
            duration = asyncio.get_event_loop().time() - start_time
            self.operations[name].update({
                "duration": duration,
                "success": success
            })

@pytest.fixture
def metrics_collector():
    """Provide a metrics collector instance."""
    return MetricsCollector()

class PerformanceLogger:
    """Log performance metrics."""
    def __init__(self):
        self.logs = []

    def log_performance(self, operation: str, duration: float, success: bool):
        self.logs.append({
            "operation": operation,
            "duration": duration,
            "success": success,
            "timestamp": asyncio.get_event_loop().time()
        })

@pytest.fixture
def performance_logger():
    """Provide a performance logger instance."""
    return PerformanceLogger()

@pytest.fixture
async def api_client():
    """Provide an API client for testing."""
    async with TestClient(app) as client:
        yield client

@pytest.fixture
def api_base_url():
    """Provide the base URL for API testing."""
    return "http://localhost:8002" 