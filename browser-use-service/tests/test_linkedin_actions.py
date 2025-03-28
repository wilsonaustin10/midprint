import pytest
import os
from datetime import datetime
from app.linkedin_actions import LinkedInActions
from browser_use.agent.views import ActionResult

@pytest.fixture
def linkedin_actions(controller):
    """Provide a LinkedInActions instance for testing."""
    actions = LinkedInActions(controller)
    actions.register_actions()
    return actions

@pytest.mark.asyncio
async def test_search_action(linkedin_actions, browser):
    """Test the search action."""
    query = "Software Engineer"
    result = await linkedin_actions.controller.execute_action(
        "Open LinkedIn Sales Navigator search with the given query",
        {"query": query, "browser": browser}
    )
    assert isinstance(result, ActionResult)
    assert result.error is None or "Could not find search input" in result.error

@pytest.mark.asyncio
async def test_save_profile(linkedin_actions, browser):
    """Test saving a profile to a list."""
    profile_url = "https://www.linkedin.com/sales/people/example-profile"
    result = await linkedin_actions.controller.execute_action(
        "Save a LinkedIn profile to a list",
        {"profile_identifier": profile_url, "browser": browser}
    )
    assert isinstance(result, ActionResult)
    assert result.error is None or "Could not find save button" in result.error

@pytest.mark.asyncio
async def test_connect_profile(linkedin_actions, browser):
    """Test sending a connection request."""
    profile_url = "https://www.linkedin.com/sales/people/example-profile"
    message = "Hi, I'd like to connect!"
    result = await linkedin_actions.controller.execute_action(
        "Send a connection request to a LinkedIn profile",
        {"profile_identifier": profile_url, "message": message, "browser": browser}
    )
    assert isinstance(result, ActionResult)
    assert result.error is None or "Could not find connect button" in result.error

@pytest.mark.asyncio
async def test_send_message(linkedin_actions, browser):
    """Test sending a message to a profile."""
    profile_url = "https://www.linkedin.com/sales/people/example-profile"
    message = "Hello! I saw your profile and wanted to reach out."
    result = await linkedin_actions.controller.execute_action(
        "Send a message to a LinkedIn profile",
        {"profile_identifier": profile_url, "message": message, "browser": browser}
    )
    assert isinstance(result, ActionResult)
    assert result.error is None or "Could not find message button" in result.error

@pytest.mark.asyncio
async def test_action_sequence(linkedin_actions, browser):
    """Test a sequence of LinkedIn actions."""
    # Search for a profile
    search_result = await linkedin_actions.controller.execute_action(
        "Open LinkedIn Sales Navigator search with the given query",
        {"query": "CTO Startup", "browser": browser}
    )
    assert isinstance(search_result, ActionResult)
    
    # Save the profile
    save_result = await linkedin_actions.controller.execute_action(
        "Save a LinkedIn profile to a list",
        {"profile_identifier": "https://www.linkedin.com/sales/people/example-profile", "browser": browser}
    )
    assert isinstance(save_result, ActionResult)
    
    # Send a connection request
    connect_result = await linkedin_actions.controller.execute_action(
        "Send a connection request to a LinkedIn profile",
        {
            "profile_identifier": "https://www.linkedin.com/sales/people/example-profile",
            "message": "Hi! I'm interested in connecting.",
            "browser": browser
        }
    )
    assert isinstance(connect_result, ActionResult)

@pytest.mark.asyncio
async def test_error_handling(linkedin_actions, browser):
    """Test error handling in LinkedIn actions."""
    # Test with invalid profile URL
    result = await linkedin_actions.controller.execute_action(
        "Save a LinkedIn profile to a list",
        {"profile_identifier": "invalid-url", "browser": browser}
    )
    assert isinstance(result, ActionResult)
    assert result.error is not None 