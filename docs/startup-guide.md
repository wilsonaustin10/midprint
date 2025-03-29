# AutonoM3 Application Startup Guide

This document outlines the proper procedure for starting both the browser-use-service (backend) and the frontend application.

## Prerequisites

- Python 3.10+ (with pip and venv)
- Node.js and npm
- Browser-use library installed (`pip install browser-use==0.1.36`)
- Required API keys in .env files

## Step 1: Check for Running Processes

Before starting any services, check if there are processes already running on the required ports:

```bash
# Check for processes on port 8003 (browser-use-service)
lsof -i :8003

# Check for processes on port 3000 (frontend)
lsof -i :3000
```

If any processes are found, you'll need to kill them:

```bash
# Kill by PID (replace PID with the actual process ID)
kill -9 <PID>

# Or kill all processes on a specific port
sudo lsof -i :8003 | grep LISTEN | awk '{print $2}' | xargs kill -9
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9
```

Sometimes processes may appear as CLOSED but still block the port:
```bash
# Find all processes on port 8003, even those marked as CLOSED
sudo lsof -i :8003
# Then kill them with
kill -9 <PID>
```

## Step 2: Install or Update Dependencies

Before starting the services, make sure you have the correct dependencies installed:

```bash
# Navigate to the browser-use-service directory
cd /path/to/Autonomi/browser-use-service

# Install the correct version of browser-use and required packages
pip install browser-use==0.1.36 langchain==0.3.14
```

## Step 3: Start the Browser-Use Service (Backend)

The browser-use-service is a Python FastAPI application. It needs to be started from its directory using the proper Python module approach:

```bash
# Navigate to the browser-use-service directory
cd /path/to/Autonomi/browser-use-service

# Start the service with uvicorn (correct way)
python -m uvicorn app.main:app --host 0.0.0.0 --port 8003
```

### Troubleshooting the Backend

If you encounter the error `from .browser_patch import patch_browser` or `ImportError: attempted relative import with no known parent package`:
- **Cause**: This happens when using `python app/main.py` directly, as it doesn't recognize the module structure.
- **Solution**: Use `python -m uvicorn app.main:app` instead.

If you encounter `ModuleNotFoundError: No module named 'browser_use.agent.agent'`:
- **Cause**: Import path mismatch in the code or incorrect browser-use version.
- **Solutions**: 
  1. Update the import in `app/agent_handler.py` to use `from browser_use.agent.service import Agent` instead
  2. Install the correct version: `pip install browser-use==0.1.36`

If you encounter `Can't instantiate abstract class BaseChatModel without an implementation for abstract methods '_generate', '_llm_type'`:
- **Cause**: Missing implementation from the LangChain library.
- **Solution**: Install the full langchain package: `pip install langchain==0.3.14`

If you see `[Errno 48] Address already in use`:
- **Cause**: Another process is still using port 8003.
- **Solution**: Find and kill all Python processes running on port 8003:
  ```bash
  sudo lsof -i :8003
  # Then kill the processes by ID
  kill -9 <PID1> <PID2>
  ```

If the service starts but doesn't respond:
- **Verify**: Try `curl http://localhost:8003/health` to check if it's responding.
- **Check**: Look for any background processes that might be interfering.

## Step 4: Start the Frontend

The frontend is a Next.js application and requires npm to start:

```bash
# Navigate to the frontend directory
cd /path/to/Autonomi/frontend

# Install dependencies if needed
npm install

# Start the development server
npm run dev
```

The frontend should now be running on http://localhost:3000 and will connect to the backend at http://localhost:8003.

### Troubleshooting the Frontend

If you encounter module-related errors like `Module not found: Can't resolve '@radix-ui/progress'`:
- **Solution**: Install the missing module:
  ```bash
  npm install @radix-ui/react-progress
  ```

If after installing, you still have path-related errors:
- **Cause**: Incorrect import paths in component files.
- **Solution**: Update imports to use the correct package name. For example:
  ```typescript
  // Change this:
  import * as ProgressPrimitive from "@radix-ui/progress"
  // To this:
  import * as ProgressPrimitive from "@radix-ui/react-progress"
  ```

## Step 5: Verify Everything Is Working

1. Check that the backend is running:
   ```bash
   curl http://localhost:8003/health
   # Should return: {"status":"healthy","service":"browser-use"}
   ```

2. Open http://localhost:3000 in your browser
   - You should see the AutonoM3 Agent Building interface
   - If the browser preview shows a Google homepage, it's working correctly

## Testing Browser Agent

To test if the browser agent is working correctly with an API call:

```bash
curl -X POST "http://localhost:8003/run-agent" \
  -H "Content-Type: application/json" \
  -d '{"task": "Navigate to example.com", "max_steps": 10, "config": {"llm": {"provider": "openai", "model": "gpt-4"}}, "browser_info": {"headless": true}}'
```

## Common Issues and Solutions

### Multiple Python Processes

Sometimes multiple Python processes can be running the same application but in different states. To find and clean up:

```bash
# Find all Python processes related to app.main
ps aux | grep python | grep app.main

# Kill all of them
pkill -f "python -m app.main"
pkill -f "python -m uvicorn app.main"
```

### Relative Import Issues

Python relative imports only work when the application is run as a module. Always use:
- `python -m uvicorn app.main:app` instead of
- `python app/main.py` or `python -m app.main`

### Browser-use Library Path Issues

If there are issues with the browser-use library paths:
1. Check the installed version: `pip list | grep browser-use`
2. Check the available modules: `python -c "import browser_use; print(dir(browser_use))"`
3. Update any import paths in your code to match the actual structure

### Port Still in Use After Killing Processes

If a port is still shown as in use after killing processes:
1. Try to kill the processes again
2. Check for processes in CLOSED state: `sudo lsof -i :8003`
3. Restart your terminal
4. As a last resort, restart your computer

## Maintaining the Services

- To stop services, press Ctrl+C in the terminal where they're running
- If you've started services in the background, find and kill the processes using the commands in Step 1 