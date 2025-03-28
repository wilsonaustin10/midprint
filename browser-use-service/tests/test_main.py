from fastapi.testclient import TestClient
from app.main import app
import pytest
from datetime import datetime

@pytest.fixture
def client():
    """Fixture to provide a test client."""
    return TestClient(app)

def test_health_check(client):
    """Test the health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "service": "browser-use"}

def test_run_agent(client):
    """Test the run-agent endpoint."""
    task_data = {
        "task": "Test task",
        "max_steps": 10,
        "config": {
            "llm": {
                "type": "anthropic",
                "model": "claude-3-opus-20240229"
            }
        },
        "browser_info": {
            "browser_type": "chromium",
            "headless": True
        }
    }
    response = client.post("/run-agent", json=task_data)
    assert response.status_code == 200
    assert "task_id" in response.json()
    assert "status" in response.json()
    assert response.json()["status"] == "scheduled" 