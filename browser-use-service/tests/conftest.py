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

    async def goto(self, url):
        self.current_url = url
        return True

    async def wait_for_selector(self, selector, timeout=5000):
        return MockElement()

    async def fill(self, selector, value):
        return True

    async def click(self, selector):
        if selector == "#signin-submit" or selector == 'button[type="submit"]':
            self.is_logged_in = True
        return True

    async def close(self):
        self.current_url = None
        self.is_logged_in = False
        return True
        
    async def get_current_page(self):
        return MockPage()

class MockContext:
    """Mock browser context for testing."""
    async def cookies(self):
        return [{"name": "test_cookie", "value": "test_value", "domain": "linkedin.com"}]

    async def add_cookies(self, cookies):
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

@pytest.fixture
async def browser():
    """Provide a mock browser instance for testing."""
    browser = MockBrowser(config=BrowserConfig(headless=True))
    yield browser
    await browser.close()

@pytest.fixture
def controller(browser):
    """Provide a controller instance for testing."""
    return Controller(browser)

@pytest.fixture
async def session_manager(browser):
    """Provide a session manager instance for testing."""
    manager = LinkedInSessionManager(browser)
    return manager

@pytest.fixture
def linkedin_actions():
    """Fixture to provide LinkedIn actions instance."""
    return LinkedInActions()

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