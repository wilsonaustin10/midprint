import pytest
import os
import json
import asyncio
import aiohttp
from datetime import datetime
from pathlib import Path
from typing import Dict, Any
from fastapi.testclient import TestClient
import uvicorn
import threading
import time
from app.main import app
import pytest_asyncio

class TestServer(uvicorn.Server):
    """Test server for integration tests."""
    def install_signal_handlers(self):
        pass

    @property
    def should_exit(self):
        return self._should_exit

    @should_exit.setter
    def should_exit(self, value):
        self._should_exit = value

@pytest.fixture(scope="module")
def test_server():
    """Fixture to run the FastAPI server during tests."""
    config = uvicorn.Config(app, host="127.0.0.1", port=8003, log_level="error")
    server = TestServer(config=config)
    
    def run_server():
        server.run()
        
    thread = threading.Thread(target=run_server)
    thread.start()
    time.sleep(1)  # Give the server time to start
    
    yield server
    
    server.should_exit = True
    thread.join()

class TestIntegration:
    """Integration tests for browser-use service with frontend."""
    
    @pytest_asyncio.fixture
    async def api_client(self):
        """Fixture to provide an API client."""
        async with aiohttp.ClientSession() as session:
            yield session
            
    @pytest.fixture
    def api_base_url(self):
        """Fixture to provide the API base URL."""
        return f"http://{os.getenv('TEST_HOST', 'localhost')}:{os.getenv('TEST_PORT', '8003')}"
            
    @pytest.mark.asyncio
    async def test_end_to_end_workflow(self, test_server, api_client, api_base_url, test_credentials, metrics_collector):
        """Test complete end-to-end workflow."""
        metrics_collector.start_operation("end_to_end")
        
        # Execute a simple task
        task_request = {
            "task": "Search for software engineers",
            "max_steps": 2,
            "config": {
                "llm": {
                    "type": "anthropic",
                    "model": "claude-3-opus-20240229"
                }
            },
            "browser_info": {
                "browser_type": "chromium",
                "headless": True
            },
            "credentials": test_credentials
        }
        
        async with api_client.post(f"{api_base_url}/run-agent", json=task_request) as response:
            assert response.status == 200
            data = await response.json()
            assert "status" in data
            
        metrics_collector.end_operation("end_to_end", True)
    
    @pytest.mark.asyncio
    async def test_session_management_integration(self, test_server, api_client, api_base_url, test_credentials, metrics_collector):
        """Test session management integration with frontend."""
        metrics_collector.start_operation("session_management")
        
        # 1. Clear any existing session
        async with api_client.post(f"{api_base_url}/clear-session") as response:
            assert response.status == 200
            
        # 2. Create a new session
        async with api_client.post(f"{api_base_url}/login", json=test_credentials) as response:
            assert response.status == 200
            data = await response.json()
            assert data["success"]
            
        metrics_collector.end_operation("session_management", True)
    
    @pytest.mark.asyncio
    async def test_error_handling_integration(self, test_server, api_client, api_base_url, metrics_collector):
        """Test error handling integration between frontend and backend."""
        metrics_collector.start_operation("error_handling")
        
        # Test with invalid credentials
        task_request = {
            "task": "Search for leads",
            "max_steps": 2,
            "config": {
                "llm": {
                    "type": "anthropic",
                    "model": "claude-3-opus-20240229"
                }
            },
            "browser_info": {
                "browser_type": "chromium",
                "headless": True
            },
            "credentials": {
                "username": "invalid@example.com",
                "password": "wrongpassword"
            }
        }
        
        async with api_client.post(f"{api_base_url}/run-agent", json=task_request) as response:
            assert response.status == 400
            data = await response.json()
            assert "detail" in data
            
        metrics_collector.end_operation("error_handling", True)
    
    @pytest.mark.asyncio
    async def test_performance_metrics(self, test_server, api_client, api_base_url, test_credentials, performance_logger):
        """Test performance metrics collection."""
        start_time = datetime.now()
        
        # Execute a simple task
        task_request = {
            "task": "Quick search for CTO",
            "max_steps": 1,
            "config": {
                "llm": {
                    "type": "anthropic",
                    "model": "claude-3-opus-20240229"
                }
            },
            "browser_info": {
                "browser_type": "chromium",
                "headless": True
            },
            "credentials": test_credentials
        }
        
        async with api_client.post(f"{api_base_url}/run-agent", json=task_request) as response:
            assert response.status in [200, 400]  # Accept both success and expected failure
            
        duration = (datetime.now() - start_time).total_seconds()
        performance_logger.log_performance("agent_execution", duration, response.status == 200) 