# Browser-Use Service

This service provides a FastAPI-based REST API for executing browser automation tasks using Browser-Use. It's part of the Autonomi project and handles LinkedIn Sales Navigator automation tasks.

## Setup

1. Create a Python virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Install Playwright browsers:
```bash
playwright install chromium
```

4. Create a `.env` file with required environment variables:
```bash
PORT=8003
OPENAI_API_KEY=your_api_key_here
```

## Running the Service

1. Activate the virtual environment:
```bash
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Start the service:
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8003
```

The service will be available at `http://localhost:8003`

## API Endpoints

- `GET /health` - Health check endpoint
- `POST /run-agent` - Execute a browser automation task

## Development

- Run tests: `pytest tests/`
- API documentation available at: `http://localhost:8003/docs`
- ReDoc documentation available at: `http://localhost:8003/redoc` 