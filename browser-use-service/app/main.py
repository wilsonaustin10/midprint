import os
os.environ["ANONYMIZED_TELEMETRY"] = "false"  # Set before importing browser-use

from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import uvicorn
from dotenv import load_dotenv
from browser_use import Agent, Controller
from browser_use.browser.browser import Browser, BrowserConfig
import asyncio
from datetime import datetime
import json

# Load environment variables
load_dotenv()

# Validate required environment variables
def validate_environment():
    required_vars = {
        'ANTHROPIC_API_KEY': 'Anthropic API key is required for Claude models',
        'OPENAI_API_KEY': 'OpenAI API key is required for GPT models',
    }
    
    missing_vars = []
    for var, message in required_vars.items():
        if not os.getenv(var) or os.getenv(var) == f"your_{var.lower()}_here":
            missing_vars.append(f"{var}: {message}")
    
    if missing_vars:
        print("WARNING: Missing environment variables:")
        for msg in missing_vars:
            print(f"  - {msg}")
        print("Some functionality may be limited.")

validate_environment()

# Global state management
task_states: Dict[str, Dict[str, Any]] = {}

app = FastAPI(
    title="Browser-Use Service",
    description="Service for executing browser automation tasks using Browser-Use",
    version="0.1.0"
)

class TaskRequest(BaseModel):
    task: str
    max_steps: Optional[int] = 50
    config: Optional[Dict[str, Any]] = {}
    browser_info: Dict[str, Any]  # Information about the Playwright browser instance

class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str

class TaskState(BaseModel):
    task_id: str
    status: str
    start_time: datetime
    current_step: int
    total_steps: int
    last_action: Optional[str] = None
    error: Optional[str] = None
    history: List[Dict[str, Any]] = []

def generate_task_id() -> str:
    """Generate a unique task ID."""
    return f"task_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}"

async def execute_agent_task(task_id: str, task: str, max_steps: int, config: Dict[str, Any], browser_info: Dict[str, Any]):
    """Execute the Browser-Use agent task and update state."""
    try:
        # Initialize task state
        task_states[task_id] = {
            "status": "initializing",
            "start_time": datetime.now(),
            "current_step": 0,
            "total_steps": max_steps,
            "history": [],
            "error": None
        }

        print(f"Initializing task {task_id} with config: {config}")  # Debug log

        # Validate LLM configuration and API keys
        llm_config = config.get("llm", {})
        if not llm_config:
            raise ValueError("LLM configuration is required")
        
        llm_type = llm_config.get("type", "").lower()
        if llm_type == "anthropic" and (not os.getenv("ANTHROPIC_API_KEY") or 
            os.getenv("ANTHROPIC_API_KEY") == "your_anthropic_api_key_here"):
            raise ValueError("Anthropic API key not configured")
        elif llm_type == "openai" and (not os.getenv("OPENAI_API_KEY") or 
            os.getenv("OPENAI_API_KEY") == "your_openai_api_key_here"):
            raise ValueError("OpenAI API key not configured")
        elif not llm_type:
            raise ValueError("LLM type must be specified in config")

        # Initialize Browser-Use components with the existing Playwright browser
        browser = Browser(
            config=BrowserConfig(
                headless=False,  # Since we're using the visible Autonomi browser
                existing_browser=browser_info  # Pass the existing browser info
            )
        )
        controller = Controller(browser)
        
        agent = Agent(
            task=task,
            llm=llm_config,
            controller=controller
        )

        # Update state to running
        task_states[task_id]["status"] = "running"
        print(f"Task {task_id} is now running")  # Debug log

        # Run the agent
        result = []
        steps = await agent.run(max_steps=max_steps)
        for step in steps:
            print(f"Step completed: {step}")  # Debug log
            step_info = {
                "step": getattr(step, 'step_number', 0),
                "action": getattr(step, 'action', None),
                "timestamp": datetime.now().isoformat()
            }
            result.append(step_info)
            
            # Update task state with step information
            task_states[task_id].update({
                "current_step": step_info["step"],
                "last_action": step_info["action"],
                "history": result
            })

        # Update final state
        task_states[task_id]["status"] = "completed"
        print(f"Task {task_id} completed successfully")  # Debug log

    except ValueError as e:
        print(f"Configuration error in task {task_id}: {str(e)}")  # Debug log
        task_states[task_id].update({
            "status": "failed",
            "error": f"Configuration error: {str(e)}"
        })
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Error in task {task_id}: {str(e)}")  # Debug log
        task_states[task_id].update({
            "status": "failed",
            "error": str(e)
        })
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Don't close the browser since it's managed by Autonomi
        pass

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "browser-use"}

@app.post("/run-agent", response_model=TaskResponse)
async def run_agent(task_request: TaskRequest, background_tasks: BackgroundTasks):
    try:
        # Generate task ID
        task_id = generate_task_id()

        # Schedule task execution
        background_tasks.add_task(
            execute_agent_task,
            task_id,
            task_request.task,
            task_request.max_steps,
            task_request.config,
            task_request.browser_info
        )

        return TaskResponse(
            task_id=task_id,
            status="scheduled",
            message="Task scheduled for execution"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/task/{task_id}", response_model=TaskState)
async def get_task_state(task_id: str):
    """Get the current state of a task."""
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        state = task_states[task_id]
        return TaskState(
            task_id=task_id,
            status=state["status"],
            start_time=state["start_time"],
            current_step=state.get("current_step", 0),
            total_steps=state.get("total_steps", 0),
            last_action=state.get("last_action"),
            error=state.get("error"),
            history=state.get("history", [])
        )
    except Exception as e:
        print(f"Error retrieving task state for {task_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving task state: {str(e)}"
        )

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8001")),
        reload=True
    ) 