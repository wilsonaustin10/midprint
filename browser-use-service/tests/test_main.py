from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "service": "browser-use"}

def test_run_agent():
    task_data = {
        "task": "Test task",
        "max_steps": 10,
        "config": {}
    }
    response = client.post("/run-agent", json=task_data)
    assert response.status_code == 200
    assert "status" in response.json() 