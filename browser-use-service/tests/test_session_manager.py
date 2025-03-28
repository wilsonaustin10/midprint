import pytest
import os
from datetime import datetime, timedelta
import json
from app.session_manager import LinkedInSessionManager
from browser_use.browser.browser import Browser, BrowserConfig

@pytest.mark.asyncio
async def test_session_creation(session_manager, browser, test_credentials, metrics_collector):
    """Test creating a new session."""
    metrics_collector.start_operation("session_creation")
    
    # Mock successful login for testing
    async def mock_login():
        return True
        
    session_manager._perform_login = mock_login
    success = await session_manager.handle_login(browser, test_credentials)
    
    metrics_collector.end_operation("session_creation", success)
    assert success, "Session creation should succeed"

@pytest.mark.asyncio
async def test_session_loading(session_manager, browser, test_credentials, metrics_collector):
    """Test loading an existing session."""
    # First create a mock session
    async def mock_login():
        return True
        
    session_manager._perform_login = mock_login
    await session_manager.handle_login(browser, test_credentials)
    
    metrics_collector.start_operation("session_loading")
    
    # Mock successful session loading
    async def mock_load():
        return True
        
    session_manager._load_cookies = mock_load
    success = await session_manager.load_session(browser)
    
    metrics_collector.end_operation("session_loading", success)
    assert success, "Session loading should succeed"

@pytest.mark.asyncio
async def test_session_saving(session_manager, browser, test_credentials, metrics_collector):
    """Test saving a session."""
    # Create a mock session first
    async def mock_login():
        return True
        
    session_manager._perform_login = mock_login
    await session_manager.handle_login(browser, test_credentials)
    
    metrics_collector.start_operation("session_saving")
    
    # Save the session
    success = await session_manager.save_session(browser)
    
    metrics_collector.end_operation("session_saving", success)
    assert success, "Session saving should succeed"
    assert os.path.exists(os.path.join(session_manager.storage_dir, "cookies.json")), "Session file should exist"

@pytest.mark.asyncio
async def test_session_persistence(session_manager, browser, test_credentials, performance_logger):
    """Test session persistence across browser restarts."""
    start_time = datetime.now()
    
    # Create initial mock session
    async def mock_login():
        return True
        
    session_manager._perform_login = mock_login
    await session_manager.handle_login(browser, test_credentials)
    
    # Save the session
    await session_manager.save_session(browser)
    
    # Simulate browser restart
    await browser.close()
    new_browser = Browser(
        config=BrowserConfig(
            headless=True
        )
    )
    
    # Mock successful session loading
    async def mock_load():
        return True
        
    session_manager._load_cookies = mock_load
    success = await session_manager.load_session(new_browser)
    
    duration = (datetime.now() - start_time).total_seconds()
    performance_logger.log_performance("session_persistence", duration, success)
    
    assert success, "Session should persist across browser restarts"
    await new_browser.close()

@pytest.mark.asyncio
async def test_session_expiration(session_manager, browser, test_credentials, tmp_path):
    """Test handling of expired sessions."""
    # Create a mock expired session file
    session_file = os.path.join(session_manager.storage_dir, "cookies.json")
    os.makedirs(os.path.dirname(session_file), exist_ok=True)
    with open(session_file, "w") as f:
        f.write('{"expired": true}')
    
    # Mock session loading to simulate expiration
    async def mock_load():
        return False
        
    session_manager._load_cookies = mock_load
    success = await session_manager.load_session(browser)
    
    assert not success, "Expired session should not load"

@pytest.mark.asyncio
async def test_session_clearing(session_manager, browser, test_credentials):
    """Test clearing session data."""
    # Create a mock session first
    async def mock_login():
        return True
        
    session_manager._perform_login = mock_login
    await session_manager.handle_login(browser, test_credentials)
    
    # Clear the session
    await session_manager.clear_session()
    
    # Verify session files are removed
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
    
    async def mock_failed_login():
        return False
        
    session_manager._perform_login = mock_failed_login
    success = await session_manager.handle_login(browser, invalid_credentials)
    
    metrics_collector.end_operation("error_handling", not success)
    assert not success, "Should handle invalid credentials gracefully" 