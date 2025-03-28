# API Documentation: Browser-Use Service

## Overview

The Browser-Use Service provides a REST API for automating browser tasks and interactions. It uses Playwright under the hood and provides endpoints for navigation, task execution, and browser automation.

## Base URL

All API endpoints are relative to the base URL of the browser-use service.

**Base URL:** `{BROWSER_USE_API}`

Default: `http://localhost:8003`

## Authentication

Currently, the API doesn't require authentication for local development. For production deployments, consider implementing proper authentication.

## Endpoints

### Health Check

```
GET /health
```

Returns the health status of the service.

**Response Example:**
```json
{
  "status": "healthy",
  "service": "browser-use"
}
```

### Run Agent

```
POST /run-agent
```

Start a new browser automation task.

**Request Body:**
```json
{
  "task": "Navigate to google.com and search for 'browser automation'",
  "max_steps": 10,
  "config": {
    "llm": {
      "provider": "openai",
      "model": "gpt-4"
    }
  },
  "browser_info": {
    "browser_type": "chromium",
    "headless": true
  }
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| task | string | Description of the task to perform |
| max_steps | integer | Maximum number of steps to execute (default: 50) |
| config | object | Configuration settings including LLM settings |
| browser_info | object | Browser configuration settings |

**Response Example:**
```json
{
  "task_id": "task_20240328_123456_abcdef12",
  "status": "scheduled",
  "message": "Task scheduled successfully"
}
```

### Get Task Status

```
GET /task/{task_id}
```

Retrieve the current state of a task.

**Path Parameters:**
- `task_id`: The ID of the task to retrieve

**Response Example:**
```json
{
  "task_id": "task_20240328_123456_abcdef12",
  "status": "running",
  "start_time": "2024-03-28T12:34:56.789012",
  "current_step": 3,
  "total_steps": 10,
  "last_action": "Navigating to https://google.com",
  "history": [
    {
      "step": 1,
      "action": "Starting browser",
      "timestamp": "2024-03-28T12:34:57.123456"
    },
    {
      "step": 2,
      "action": "Navigating to https://google.com",
      "timestamp": "2024-03-28T12:34:58.234567"
    }
  ]
}
```

## Error Handling

The API returns appropriate HTTP status codes:

- `200 OK`: Request successful
- `400 Bad Request`: Invalid request parameters
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server-side error

Error responses include a detailed message:

```json
{
  "detail": "Error message"
}
```

## Rate Limiting

Currently, no rate limiting is implemented. In production, consider adding rate limiting to prevent abuse.

## Frontend Integration

Frontend applications can integrate with the Browser-Use Service using the endpoints above. See the frontend code examples for implementation details.

```typescript
// Example: Starting a task from the frontend
async function startTask(task: string) {
  const response = await fetch('http://localhost:8003/run-agent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      task,
      max_steps: 50,
      config: {
        llm: {
          provider: 'openai',
          model: 'gpt-4'
        }
      },
      browser_info: {
        browser_type: 'chromium',
        headless: true
      }
    }),
  });

  return response.json();
}
``` 