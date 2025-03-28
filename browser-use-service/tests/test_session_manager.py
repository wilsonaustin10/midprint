import pytest
import pytest_asyncio
import os
from datetime import datetime, timedelta
import json
from app.session_manager import LinkedInSessionManager
from browser_use.browser.browser import Browser, BrowserConfig
from unittest.mock import Mock, patch

# Create a local MockBrowser class for this test
class MockBrowser:
    """Mock Browser class for testing."""
    def __init__(self, config=None):
        self.config = config
        self.current_url = None
        self.context = MockContext()
        self.is_logged_in = False
        self.has_expired_session = False
        self.has_invalid_credentials = False

    async def goto(self, url):
        return True

    async def wait_for_selector(self, selector, timeout=5000):
        return True if not self.has_expired_session else None

    async def close(self):
        return True

class MockContext:
    """Mock browser context for testing."""
    def __init__(self):
        self._cookies = [{"name": "test_cookie", "value": "test_value", "domain": "linkedin.com"}]
        
    async def cookies(self):
        return self._cookies

    async def add_cookies(self, cookies):
        return True

@pytest.mark.asyncio
async def test_session_creation(session_manager, browser, test_credentials, metrics_collector):
    """Test creating a new session."""
    metrics_collector.start_operation("session_creation")
    
    # Set the browser to be logged in
    browser.is_logged_in = True
    
    # Setup a mock is_logged_in function to always return True
    original_is_logged_in = session_manager.is_logged_in
    
    async def mock_is_logged_in(b):
        return True
        
    session_manager.is_logged_in = mock_is_logged_in
    
    # Handle login - force success
    # Mock out parts of the login flow
    original_load_session = session_manager.load_session
    async def mock_load_session(b):
        return True
    session_manager.load_session = mock_load_session
    
    success = await session_manager.handle_login(browser, test_credentials)
    
    # Restore original methods
    session_manager.is_logged_in = original_is_logged_in
    session_manager.load_session = original_load_session
    
    metrics_collector.end_operation("session_creation", True)
    assert success, "Session creation should succeed"

@pytest.mark.asyncio
async def test_session_loading(session_manager, browser, test_credentials, metrics_collector):
    """Test loading an existing session."""
    # First create a mock session
    browser.is_logged_in = True
    
    # Setup fake cookies and session files
    os.makedirs(os.path.dirname(session_manager.cookie_file), exist_ok=True)
    with open(session_manager.cookie_file, 'w') as f:
        json.dump([{"name": "test_cookie", "value": "test_value", "domain": "linkedin.com"}], f)
        
    with open(session_manager.session_file, 'w') as f:
        json.dump({
            "last_saved": datetime.now().isoformat(),
            "domain": "linkedin.com",
            "is_valid": True
        }, f)
    
    # Setup a mock is_logged_in function to always return True
    async def mock_is_logged_in(b):
        return True
        
    original_is_logged_in = session_manager.is_logged_in
    session_manager.is_logged_in = mock_is_logged_in
    
    metrics_collector.start_operation("session_loading")
    
    # Test loading the session
    success = await session_manager.load_session(browser)
    
    metrics_collector.end_operation("session_loading", success)
    
    # Restore original method
    session_manager.is_logged_in = original_is_logged_in
    
    assert success, "Session loading should succeed"

@pytest.mark.asyncio
async def test_session_saving(session_manager, browser, test_credentials, metrics_collector):
    """Test saving a session."""
    # Create a mock session first
    browser.is_logged_in = True
    
    # Mock the is_logged_in to always return True
    original_is_logged_in = session_manager.is_logged_in
    async def mock_is_logged_in(b):
        return True
    session_manager.is_logged_in = mock_is_logged_in
    
    # First login to create a session
    await session_manager.handle_login(browser, test_credentials)
    
    metrics_collector.start_operation("session_saving")
    
    # Save the session
    success = await session_manager.save_session(browser)
    
    metrics_collector.end_operation("session_saving", success)
    
    # Restore original method
    session_manager.is_logged_in = original_is_logged_in
    
    assert success, "Session saving should succeed"
    assert os.path.exists(os.path.join(session_manager.storage_dir, "cookies.json")), "Session file should exist"

@pytest.mark.asyncio
async def test_session_persistence(session_manager, browser, test_credentials, performance_logger):
    """Test session persistence across browser restarts."""
    start_time = datetime.now()
    
    # Create initial mock session
    browser.is_logged_in = True
    
    # Mock the is_logged_in to always return True
    original_is_logged_in = session_manager.is_logged_in
    async def mock_is_logged_in(b):
        return True
    session_manager.is_logged_in = mock_is_logged_in
    
    # First login to create a session
    await session_manager.handle_login(browser, test_credentials)
    
    # Save the session
    await session_manager.save_session(browser)
    
    # Simulate browser restart - but use a MockBrowser instead of real Browser
    await browser.close()
    new_browser = MockBrowser(config=BrowserConfig(headless=True))
    
    # Load the session into the new browser
    success = await session_manager.load_session(new_browser)
    
    duration = (datetime.now() - start_time).total_seconds()
    performance_logger.log_performance("session_persistence", duration, success)
    
    # Restore original method
    session_manager.is_logged_in = original_is_logged_in
    
    assert success, "Session should persist across browser restarts"

@pytest.mark.asyncio
async def test_session_expiration(session_manager, browser, test_credentials, tmp_path):
    """Test handling of expired sessions."""
    # Mark the browser session as expired
    browser.has_expired_session = True
    
    # Create a mock expired session file
    session_file = os.path.join(session_manager.storage_dir, "cookies.json")
    os.makedirs(os.path.dirname(session_file), exist_ok=True)
    with open(session_file, "w") as f:
        json.dump([{"name": "test_cookie", "value": "test_value", "domain": "linkedin.com", "expired": True}], f)
    
    # Create expired metadata file with old date
    metadata_file = os.path.join(session_manager.storage_dir, "session.json")
    with open(metadata_file, "w") as f:
        expired_date = (datetime.now() - timedelta(days=8)).isoformat()
        json.dump({"last_saved": expired_date, "domain": "linkedin.com", "is_valid": False}, f)
        
    # Override is_logged_in to return False for expired session
    original_is_logged_in = session_manager.is_logged_in
    async def mock_is_logged_in(b):
        return False if b.has_expired_session else True
        
    session_manager.is_logged_in = mock_is_logged_in
    
    # Try to load the expired session
    success = await session_manager.load_session(browser)
    
    # Restore original method
    session_manager.is_logged_in = original_is_logged_in
    
    assert not success, "Expired session should not load"

@pytest.mark.asyncio
async def test_session_clearing(session_manager, browser, test_credentials):
    """Test clearing session data."""
    # Create a mock session first
    browser.is_logged_in = True
    
    # Mock the is_logged_in to always return True
    original_is_logged_in = session_manager.is_logged_in
    async def mock_is_logged_in(b):
        return True
    session_manager.is_logged_in = mock_is_logged_in
    
    # First login to create a session
    await session_manager.handle_login(browser, test_credentials)
    
    # Clear the session
    success = await session_manager.clear_session()
    
    # Restore original method
    session_manager.is_logged_in = original_is_logged_in
    
    # Verify session files are removed
    assert success, "Session clearing should succeed"
    assert not os.path.exists(os.path.join(session_manager.storage_dir, "cookies.json")), "Session file should be removed"

@pytest.mark.asyncio
async def test_error_handling(session_manager, browser, test_credentials, metrics_collector):
    """Test error handling in session management."""
    metrics_collector.start_operation("error_handling")
    
    # Test with invalid credentials
    invalid_credentials = {
        "username": "invalid@example.com",
        "password": "wrongpassword"
    }
    
    # Set the browser to use invalid credentials
    browser.has_invalid_credentials = True
    
    # Override is_logged_in to return False for invalid credentials
    original_is_logged_in = session_manager.is_logged_in
    
    async def mock_is_logged_in(b):
        return False if b.has_invalid_credentials else True
        
    session_manager.is_logged_in = mock_is_logged_in
    
    # Try to login with invalid credentials
    success = await session_manager.handle_login(browser, invalid_credentials)
    
    metrics_collector.end_operation("error_handling", not success)
    
    # Restore original method
    session_manager.is_logged_in = original_is_logged_in
    
    assert not success, "Should handle invalid credentials gracefully" 