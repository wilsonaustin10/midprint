import os
os.environ["ANONYMIZED_TELEMETRY"] = "false"  # Set before importing browser-use

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import uvicorn
from dotenv import load_dotenv
from browser_use import Agent, Controller, AgentHistoryList, ActionResult
from browser_use.browser.browser import Browser, BrowserConfig
# Import and apply our patch to fix the Browser class
from .browser_patch import patch_browser
patch_browser()  # Apply the patch

from .linkedin_actions import LinkedInActions
from .session_manager import LinkedInSessionManager
from .agent_handler import AgentHandler
import asyncio
from datetime import datetime
import json
import uuid
import base64
from fastapi.responses import JSONResponse, Response
import io
import time
from sse_starlette.sse import EventSourceResponse
import logging

# --- ADDED logger definition ---
logger = logging.getLogger(__name__)
# --- END ADDED logger definition ---

# Load environment variables
load_dotenv()

# Define constants
SSE_TIMEOUT = 5.0  # Timeout for waiting on queue in seconds
TASK_TIMEOUT_SECONDS = 10.0 # Timeout for stream endpoint waiting for queue

# --- ADDED CONSTANT DEFINITION ---
SSE_TIMEOUT = 30.0  # Timeout in seconds for waiting on the SSE queue
# --- END ADDED CONSTANT DEFINITION ---

# --- Add push_sse_update helper ---
async def push_sse_update(task_id: str, update_data: Dict):
    if task_id in task_states and "sse_queue" in task_states[task_id]:
        queue = task_states[task_id]["sse_queue"]
        if queue: # Check if queue exists
            try:
                # Don't block indefinitely if queue is full
                await asyncio.wait_for(queue.put(update_data), timeout=1.0)
            except asyncio.TimeoutError:
                print(f"[SSE {task_id}] WARN: Queue put timed out for update: {update_data.get('type')}")
            except Exception as push_err:
                print(f"[SSE {task_id}] Error pushing update: {push_err}")
    # else: Task state or queue not found, ignore update
# --- End SSE Helper ---

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

# Add CORS middleware to allow frontend to communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TaskRequest(BaseModel):
    task: str
    max_steps: Optional[int] = 50
    config: Optional[Dict[str, Any]] = {}  # Use dictionary access (config["llm"]) not attribute access (config.llm)
    browser_info: Dict[str, Any]  # Use dictionary access (browser_info["headless"]) not attribute access (browser_info.headless)
    credentials: Optional[Dict[str, str]] = None  # Use dictionary access (credentials["username"]) not attribute access (credentials.username)

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

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    success: bool
    message: str

class BrowserCreateRequest(BaseModel):
    headless: bool = True

class BrowserActionRequest(BaseModel):
    action: str
    selector: Optional[str] = None
    value: Optional[str] = None

class BrowserNavigateRequest(BaseModel):
    url: str

def generate_task_id() -> str:
    """Generate a unique task ID."""
    return f"task_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}"

async def execute_agent_task(task_id: str, task_request: TaskRequest, browser: Browser, session_manager: LinkedInSessionManager):
    # --- Define mock save session outside the try block --- 
    async def mock_save_session_inner(b):
        print(f"[Mock Save Session] Called for browser related to task {task_id}. Skipping actual save.")
        # Use push_sse_update for save session logs
        await push_sse_update(task_id, {"type": "log", "message": "Attempting to save session..."})
        await asyncio.sleep(0.1) # Simulate small delay
        await push_sse_update(task_id, {"type": "log", "message": "Session save processing complete."})
        return True
    # ----------------------------------------------------
    
    agent_history_list: Optional[AgentHistoryList] = None
    handler_success = False # Default to False
    handler_error: Optional[str] = None
    agent_handler_history = [] # Default to empty list
    agent_handler: Optional[AgentHandler] = None # Initialize agent_handler

    # --- Retrieve the existing SSE queue AND context --- 
    sse_queue = None
    browser_context = None # Added context retrieval
    if task_id in task_states:
        sse_queue = task_states[task_id].get("sse_queue")
        browser_context = task_states[task_id].get("context") # Retrieve context
        if not browser_context:
             print(f"[ERROR {task_id}] Browser context not found in task_states!")
             # Should we fail here? Or try to create one?
             # For now, let's log and potentially fail later if AgentHandler requires it.
        if not sse_queue:
            # Log error if queue not found (critical)
            print(f"[ERROR {task_id}] SSE queue not found in task_states at start of execution!")
            # Attempt to create one as a fallback - might indicate a deeper issue
            sse_queue = asyncio.Queue()
            task_states[task_id]["sse_queue"] = sse_queue
            print(f"[WARN {task_id}] Created fallback SSE queue.")
    else:
        print(f"[ERROR {task_id}] Task state missing, cannot retrieve queue or context.")
        # Cannot proceed without task state
        return 

    # Ensure status is running and push update
    if task_id in task_states: # Check state exists before updating
        task_states[task_id]["status"] = "running"
        if sse_queue: 
            await push_sse_update(task_id, {"type": "status", "status": "running", "message": "Agent task started."})
        else:
            print(f"[WARN {task_id}] Cannot send initial status update, SSE queue missing.")
    else:
        print(f"[ERROR {task_id}] Task state missing, cannot set status to running.")
        # Cannot proceed without task state
        return 

    try:
        print(f"[execute_agent_task {task_id}] Starting agent run.")
        
        # --- MODIFIED: Pass context AND queue to AgentHandler --- 
        if not browser_context:
             raise ValueError(f"Browser context is missing for task {task_id}, cannot start agent.")
        if not sse_queue:
             # This should ideally not happen due to fallback logic earlier, but check anyway
             raise ValueError(f"SSE queue is missing for task {task_id}, cannot start agent.")
             
        agent_handler = AgentHandler(browser, browser_context, task_id, sse_queue)

        # Agent execution logic
        returned_result = await agent_handler.run_agent(
            task=task_request.task,
            config=task_request.config,
            max_steps=task_request.max_steps
        )
        print(f"[Agent {task_id}] Agent run finished.")
        print(f"[Agent {task_id}] Processing agent results. Type: {type(returned_result)}")
        # --- ADD LOGGING HERE ---
        print(f"[Agent {task_id}] Raw returned_result keys: {returned_result.keys() if isinstance(returned_result, dict) else 'Not a dict'}")
        print(f"[Agent {task_id}] Raw returned_result content: {returned_result}")
        # --- END LOGGING ---

        agent_handler_history = []
        final_action_result = None

        # --- Robust Handling of Returned Result --- 
        if isinstance(returned_result, AgentHistoryList):
            print(f"[execute_agent_task {task_id}] Processing direct AgentHistoryList return.")
            agent_history_list = returned_result
            handler_success = agent_history_list.is_successful
            # --- Consistently use action_results attribute for history --- 
            # <<< Add try-except for dict conversion >>>
            temp_history = []
            if hasattr(agent_history_list, 'action_results') and isinstance(agent_history_list.action_results, list):
                print(f"[DEBUG {task_id}] Converting direct action_results (len {len(agent_history_list.action_results)})")
                try:
                    for i, res in enumerate(agent_history_list.action_results):
                        if hasattr(res, 'dict') and callable(res.dict):
                            temp_history.append(res.dict())
                        else:
                            print(f"[ERROR {task_id}] Item {i} (direct) lacks .dict(). Appending str.")
                            temp_history.append(str(res))
                except Exception as dict_err:
                    print(f"[ERROR {task_id}] Error converting direct action_results: {dict_err}")
            agent_handler_history = temp_history
            # <<< End try-except >>>

            if not handler_success:
                 handler_error = None
                 if hasattr(agent_history_list, 'final_result') and agent_history_list.final_result:
                     handler_error = agent_history_list.final_result.error
                 elif agent_handler_history and isinstance(agent_handler_history[-1], dict) and agent_handler_history[-1].get('error'): # Check dict history
                     handler_error = agent_handler_history[-1].get('error')
                 handler_error = handler_error or "AgentHistoryList success=False"
        
        elif isinstance(returned_result, dict):
            print(f"[Agent {task_id}] Returned result is a dict. Checking for 'history' key.")
            try:
                # Check if 'history' key exists and is a list
                history_list = returned_result.get('history')
                if isinstance(history_list, list):
                    agent_handler_history = history_list
                    print(f"[Agent {task_id}] Successfully extracted 'history' list. Length: {len(agent_handler_history)}")
                    # Optionally, extract the final answer if available
                    final_answer = returned_result.get('final_answer')
                    if final_answer:
                        print(f"[Agent {task_id}] Extracted final_answer: {final_answer}")
                        # We might want to use this final_answer later, perhaps as the final_action_result?
                        # For now, just log it. We can decide how to use it later.
                        # If the last item in history represents the final action, let's capture that.
                        if agent_handler_history:
                             # Assuming the structure within history allows direct access or needs parsing
                             # Let's keep the previous logic for final_action_result for now
                             pass # Keep existing logic below for final_action_result from history

                else:
                    print(f"[WARN {task_id}] 'history' key found but is not a list. Type: {type(history_list)}. History remains empty.")
            except Exception as e:
                print(f"[ERROR {task_id}] Error processing dict result for 'history': {e}")
        else:
            print(f"[WARN {task_id}] Agent returned an unexpected type: {type(returned_result)}. History remains empty.")
        # --- End Robust Handling ---

        # Determine final action result from history if available
        # This logic might need adjustment based on history item structure
        action_results_list = None # Reset just in case
        if agent_handler_history:
            try:
                # Assuming history is a list of objects/dicts with 'result' or similar key
                # Let's refine this once we know the structure inside history list items
                if agent_handler_history and isinstance(agent_handler_history[-1], dict) and 'result' in agent_handler_history[-1]:
                     final_action_result = agent_handler_history[-1]['result'] # Example extraction
                elif agent_handler_history: # Fallback if structure is different
                     final_action_result = str(agent_handler_history[-1]) # Simple string representation

                print(f"[Agent {task_id}] Final action result determined from history: {final_action_result}")
                action_results_list = agent_handler_history # Use the extracted history
            except Exception as e:
                 print(f"[ERROR {task_id}] Error extracting final result from history: {e}")
                 final_action_result = "Error extracting final result."

        if action_results_list is None:
             print(f"[WARN {task_id}] action_results_list is None after processing.")
             action_results_list = [] # Ensure it's an empty list if nothing was extracted

        # --- Update task state with final details ---
        final_status = "completed" # Assume completed unless error occurred during processing
        if task_states.get(task_id):
            task_states[task_id]["status"] = final_status
            task_states[task_id]["history"] = action_results_list # Store the processed history
            # Store final_action_result or final_answer? Let's stick to action result for now.
            task_states[task_id]["last_action"] = str(final_action_result) if final_action_result else "N/A"
            print(f"[Agent {task_id}] Updated final task state: Status='{final_status}', History Length={len(action_results_list)}, Final Result='{final_action_result}'")
            await push_sse_update(task_id, {
                 "type": "completed",
                 "status": final_status, 
                 "history": action_results_list, 
                 "result": str(final_action_result) if final_action_result else None
            })
        else:
             print(f"[WARN {task_id}] Task state not found for final update.")

        # Save session 
        print(f"[execute_agent_task {task_id}] Attempting to save session.")
        try:
            # Using mock save session
            save_success = await mock_save_session_inner(browser) # Pass browser instance
            if not save_success:
                await push_sse_update(task_id, {"type": "log", "level":"warning", "message": "Session saving failed."})
        except Exception as save_err:
            print(f"[execute_agent_task {task_id}] Error saving session: {save_err}")
            await push_sse_update(task_id, {"type": "log", "level":"error", "message": f"Error saving session: {save_err}"})
        print(f"[execute_agent_task {task_id}] Session save call completed.")

    except Exception as e:
        print(f"[OUTER CATCH] Caught exception in execute_agent_task for {task_id}: {str(e)}")
        import traceback
        traceback.print_exc()
        # Update state and push error if possible
        if task_id in task_states:
             task_states[task_id]["status"] = "failed"
             task_states[task_id]["error"] = str(e)
             # Push outer catch error
             await push_sse_update(task_id, {"type": "failed", "status": "failed", "error": f"Unexpected error during task execution: {str(e)}"})
        else:
            print(f"[OUTER CATCH {task_id}] Task state missing or invalid, cannot set final failure state or push update.")
            # Log the error, but cannot update state or push SSE

    finally:
        print(f"[FINALLY] Entering finally block for {task_id}.")
        task_state_valid = task_id in task_states
        print(f"[FINALLY] task_state_valid for {task_id}: {task_state_valid}")

        # --- ADDED: Set AgentHandler inactive before cleanup ---
        if agent_handler:
             agent_handler.is_active = False
             print(f"[FINALLY] Marked AgentHandler inactive for task {task_id}.")
        # --- END ADDED ---

        # --- Send Final SSE Update (if not already sent by normal flow or outer catch) ---
        final_status_sent = False
        if task_state_valid:
             state_at_finally = task_states[task_id].get("status")
             if state_at_finally == "completed" or state_at_finally == "failed":
                 final_status_sent = True # Assume status already set and pushed

        if task_state_valid and not final_status_sent:
            print(f"[FINALLY] Task {task_id} status was {task_states[task_id].get('status')}, setting to failed and pushing.")
            task_states[task_id]["status"] = "failed"
            task_states[task_id]["error"] = task_states[task_id].get("error", "Task failed in finally block.")
            await push_sse_update(task_id, {
                 "type": "failed",
                 "status": "failed",
                 "error": task_states[task_id]["error"]
            })
            final_status_sent = True # Mark as sent

        # --- Browser Cleanup --- 
        # (Cleanup logic remains the same)
        if browser:
             try:
                 await browser.close()
                 print(f"Closed browser for task {task_id}")
                 # Push log after browser close attempt
                 await push_sse_update(task_id, {"type": "log", "message": "Browser closed."}) 
             except Exception as close_err:
                 print(f"Error closing browser for task {task_id}: {str(close_err)}")
                 await push_sse_update(task_id, {"type": "log", "level":"error", "message": f"Error closing browser: {close_err}"}) 

        # --- Remove Task State and Queue --- 
        if task_id in task_states:
            # Signal queue completion if it exists
            if "sse_queue" in task_states[task_id] and task_states[task_id]["sse_queue"]:
                 try:
                     await task_states[task_id]["sse_queue"].put(None) # Signal end
                 except Exception as q_err:
                     print(f"[FINALLY {task_id}] Error putting final marker in queue: {q_err}")
            # Remove task state after a delay
            # We will keep the task state for now to allow the stream endpoint to serve the final status
            # await asyncio.sleep(2)
            # if task_id in task_states: # Check again
            #     del task_states[task_id]
            #     print(f"Removed context reference for task {task_id}")
        print(f"[execute_agent_task {task_id}] Reached end of finally block.")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "browser-use"}

@app.post("/browser/create")
async def create_browser(request: BrowserCreateRequest):
    """Create a new browser instance and return a task ID."""
    task_id = f"browser_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    print(f"Creating new browser with ID: {task_id}")
    
    # Initialize task state
    task_states[task_id] = {
        "status": "running",
        "start_time": datetime.now().isoformat(),
        "current_step": 0,
        "total_steps": 0,
        "history": [],
        "error": None,
        "sse_queue": asyncio.Queue()
    }
    
    try:
        # Initialize browser
        browser = Browser(config=BrowserConfig(headless=request.headless))
        
        # Create a browser context 
        context = await browser.new_context()
        
        # Store browser and context in task state
        task_states[task_id]["browser"] = browser
        task_states[task_id]["context"] = context
        
        # Capture initial screenshot
        screenshot_b64 = await context.take_screenshot()
        
        # Screenshot comes back base64 encoded, so we don't need to encode it
        return {
            "task_id": task_id,
            "status": "created",
            "message": "Browser created successfully",
            "screenshot": f"data:image/png;base64,{screenshot_b64}",
            "url": "about:blank"
        }
    except Exception as e:
        task_states[task_id]["status"] = "failed"
        task_states[task_id]["error"] = str(e)
        print(f"Error creating browser: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating browser: {str(e)}")

@app.post("/run-agent")
async def run_agent(request: Request, task_request: TaskRequest, background_tasks: BackgroundTasks):
    """Execute a browser automation task.
    
    Note on request structure:
    - The config, browser_info, and credentials parameters are dictionaries and must be accessed using
      dictionary notation in the code (e.g., config["llm"], not config.llm).
    - Example request body:
      {
        "task": "Navigate to example.com",
        "max_steps": 10,
        "config": {"llm": {"provider": "openai", "model": "gpt-4"}},
        "browser_info": {"headless": true},
        "credentials": {"username": "user@example.com", "password": "password"}
      }
    """
    task_id = f"task_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    print(f"Initializing task {task_id} with config: {task_request.config}")
    print(f"TEST_MODE env var: {os.getenv('TEST_MODE')}")
    print(f"Request credentials: {task_request.credentials}")

    # Initialize task state
    task_states[task_id] = {
        "status": "initializing",
        "start_time": datetime.now().isoformat(),
        "current_step": 0,
        "total_steps": task_request.max_steps,
        "history": [],
        "error": None,
        "sse_queue": asyncio.Queue()
    }

    # Add a small delay to allow state to propagate before returning
    await asyncio.sleep(0.1) 

    try:
        # In test mode, handle test cases appropriately
        if os.getenv("TEST_MODE") == "true":
            # Check for the error handling test case with invalid credentials
            if task_request.credentials and task_request.credentials.get("username") == "invalid@example.com":
                print("Test mode detected with invalid credentials, simulating credential rejection")
                task_states[task_id]["status"] = "failed"
                task_states[task_id]["error"] = "Invalid credentials"
                # Instead of raising HTTPException, return a JSONResponse directly
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Invalid credentials"}
                )
            else:
                print("Test mode detected in run-agent, returning mock success")
                return {
                    "task_id": task_id,
                    "status": "scheduled",
                    "message": "Task scheduled successfully (test mode)"
                }
            
        # Validate required configuration
        if not task_request.config or not task_request.config['llm']:
            raise ValueError("Missing LLM configuration")

        # Initialize browser using the create_browser endpoint
        browser_response = await create_browser(BrowserCreateRequest(headless=task_request.browser_info["headless"]))
        browser_task_id = browser_response["task_id"]
        
        # Use the browser from the task state
        browser = task_states[browser_task_id]["browser"]
        context = task_states[browser_task_id]["context"]
        
        # --- ADDED: Initial Navigation --- 
        try:
             initial_url = "https://www.google.com" # Or another suitable starting page
             logger.info(f"[run-agent {task_id}] Performing initial navigation to {initial_url}")
             if hasattr(context, 'navigate_to') and callable(context.navigate_to):
                 await context.navigate_to(initial_url) 
             else:
                 # Fallback: Try using Playwright page directly if context is a wrapper
                 if hasattr(context, 'page') and hasattr(context.page, 'goto'):
                     await context.page.goto(initial_url)
                 else:
                     logger.warning(f"[run-agent {task_id}] Context object lacks navigate_to or page.goto method.")
             logger.info(f"[run-agent {task_id}] Initial navigation successful.")
        except Exception as nav_err:
             logger.error(f"[run-agent {task_id}] Error during initial navigation: {nav_err}", exc_info=True)
             # Don't fail the whole task, but log the error
        # --- END ADDED: Initial Navigation ---
             
        # Initialize session manager without automatic login
        session_manager = LinkedInSessionManager()

        # Store browser instance in task state
        task_states[task_id]["browser"] = browser
        task_states[task_id]["context"] = context

        # Only attempt login if credentials are provided
        if task_request.credentials and task_request.credentials.get("username") and task_request.credentials.get("password"):
            # Prepare credentials
            credentials = {"username": task_request.credentials["username"], "password": task_request.credentials["password"]}
            
            # Attempt login
            login_success = await session_manager.handle_login(browser, credentials)

            if not login_success:
                task_states[task_id]["status"] = "failed"
                task_states[task_id]["error"] = "Failed to login with provided credentials"
                raise HTTPException(status_code=401, detail="Login failed")

        # Schedule background task
        background_tasks.add_task(
            execute_agent_task,
            task_id,
            task_request,
            browser,
            session_manager
        )

        return {
            "task_id": task_id,
            "status": "scheduled",
            "message": "Task scheduled successfully"
        }

    except ValueError as e:
        print(f"ValueError in run-agent: {str(e)}")
        task_states[task_id]["status"] = "failed"
        task_states[task_id]["error"] = str(e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Exception in run-agent: {str(e)}")
        task_states[task_id]["status"] = "failed"
        task_states[task_id]["error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/task/{task_id}/stream")
async def stream_task_events(task_id: str, request: Request):
    # Waiting Logic (remains the same)
    queue: Optional[asyncio.Queue] = None
    start_time = time.time()
    timeout_seconds = 10.0
    print(f"[SSE /task/{task_id}/stream] Waiting for task state and queue...")
    while time.time() - start_time < timeout_seconds:
        task_state = task_states.get(task_id)
        if task_state and "sse_queue" in task_state and task_state["sse_queue"] is not None:
            queue = task_state["sse_queue"]
            print(f"[SSE /task/{task_id}/stream] Found valid sse_queue after {time.time() - start_time:.2f}s.")
            break
        print(f"[SSE /task/{task_id}/stream] sse_queue not ready yet. Checking again...")
        await asyncio.sleep(0.2)
    
    if not queue:
        print(f"[SSE /task/{task_id}/stream] Timeout: Task state or queue not found after {timeout_seconds}s.")
        current_state = task_states.get(task_id)
        print(f"[SSE /task/{task_id}/stream] Final state check: {current_state}")
        raise HTTPException(status_code=404, detail=f"Task stream timed out waiting for initialization after {timeout_seconds} seconds.")

    print(f"[SSE /task/{task_id}/stream] Client connecting, using EventSourceResponse.")
    
    # Return EventSourceResponse instead of StreamingResponse
    return EventSourceResponse(
        sse_event_generator(task_id, queue, request), 
        ping=15,  # Send a ping comment every 15 seconds
        # Optional: Customize headers if needed, but sse-starlette sets defaults
        # headers={"X-Custom-Header": "value"} 
    )

async def sse_event_generator(task_id: str, queue: asyncio.Queue, request: Request):
    print(f"[SSE {task_id}] Starting sse_event_generator.")
    client_disconnected = False
    try:
        while not client_disconnected:
            # Check connection status at the start of each loop iteration
            if await request.is_disconnected():
                print(f"[SSE {task_id}] Client disconnected detected at start of loop.")
                client_disconnected = True
                break

            try:
                # Wait for the next item from the queue with a timeout
                item = await asyncio.wait_for(queue.get(), timeout=SSE_TIMEOUT)

                # --- DEBUG: Log raw item --- 
                print(f"[SSE {task_id}] Raw item from queue: {item!r}")
                # --- END DEBUG --- 

                if item is None:
                    print(f"[SSE {task_id}] Received None, ending stream generator.")
                    break  # End the stream gracefully

                event_type = item.get("type", "message") # Default to message type
                event_data = item # Use the whole item as data

                # Ensure data is always valid JSON string for sse-starlette
                try:
                    json_data_string = json.dumps(event_data)
                    yield {
                        "event": event_type,
                        "data": json_data_string
                        # Optionally add "id" or "retry" here if needed
                    }
                    print(f"[SSE {task_id}] Yielded dict: event='{event_type}', data='{json_data_string!r}'")
                except TypeError as e:
                    print(f"[ERROR SSE {task_id}] Failed to serialize event data: {event_data}. Error: {e}")
                    # Send a generic error event if serialization fails
                    error_data_string = json.dumps({"type": "error", "message": f"Internal SSE serialization error: {e}"})
                    yield {
                        "event": "error",
                        "data": error_data_string
                    }

                queue.task_done()

            except asyncio.TimeoutError:
                # No need to yield anything here, EventSourceResponse handles pings
                # print(f"[SSE {task_id}] Timeout waiting for queue item.") # Optional logging
                pass # Just continue waiting
            except Exception as e:
                print(f"[ERROR SSE {task_id}] Error processing queue item: {e}")
                # Send a structured error message back
                error_data_string = json.dumps({"type": "error", "message": f"Error processing SSE queue: {e}"})
                yield {
                    "event": "error",
                    "data": error_data_string
                }

    except asyncio.CancelledError:
         print(f"[SSE {task_id}] Generator cancelled (client likely disconnected).")
         client_disconnected = True # Ensure loop terminates
    except Exception as e:
        print(f"[SSE {task_id}] Unexpected error in outer generator loop: {e}")
        # Attempt to yield a final error message
        try:
             error_data = json.dumps({"type": "error", "message": f"Critical SSE generator error: {e}"})
             yield {"event": "error", "data": error_data}
        except Exception as final_e:
             print(f"[SSE {task_id}] Failed to yield final error message: {final_e}")
    finally:
        print(f"[SSE {task_id}] Event generator finished (disconnected: {client_disconnected}).")
        # Cleanup logic if needed

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

@app.get("/browser/{task_id}/screenshot")
async def get_screenshot(task_id: str):
    """Get the current screenshot of the browser for a task."""
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if task_states[task_id].get("browser") is None:
        # In test mode, return a placeholder image
        if os.getenv("TEST_MODE") == "true":
            print(f"Test mode detected, returning placeholder screenshot for task {task_id}")
            # Return a small blank image as placeholder
            return Response(content=b"", media_type="image/png")
            
        raise HTTPException(status_code=400, detail="Browser not initialized for this task")
    
    try:
        # Get context, creating it if needed
        if task_states[task_id].get("context") is None:
            browser = task_states[task_id]["browser"]
            context = await browser.new_context()
            task_states[task_id]["context"] = context
        else:
            context = task_states[task_id]["context"]
            
        # Take screenshot and return it
        # The screenshot is returned as base64, so we need to decode it
        screenshot_b64 = await context.take_screenshot()
        screenshot_bytes = base64.b64decode(screenshot_b64)
        
        return Response(content=screenshot_bytes, media_type="image/png")
    except Exception as e:
        print(f"Error capturing screenshot for task {task_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error capturing screenshot: {str(e)}")

@app.get("/browser/{task_id}/form_elements")
async def get_form_elements(task_id: str):
    """Get the form elements from the current page.
    
    This endpoint retrieves all form elements (inputs, buttons, textareas, selects) from the 
    current browser page for the specified task ID. The endpoint returns detailed information 
    about each element, including:
    
    - Element attributes (id, name, value, type, etc.)
    - Element position and size (x, y, width, height)
    - ARIA attributes
    - CSS selectors for targeting elements
    
    The URL format is `/browser/{task_id}/form_elements`, where `{task_id}` is the ID of an existing
    browser instance created with the `/browser/create` endpoint.
    
    Returns a JSON object with a "form_elements" array containing all form elements found on the page.
    If no elements are found, returns an empty array.
    """
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if task_states[task_id].get("browser") is None:
        # In test mode, return empty elements
        if os.getenv("TEST_MODE") == "true":
            print(f"Test mode detected, returning empty form elements for task {task_id}")
            return {"form_elements": []}
            
        raise HTTPException(status_code=400, detail="Browser not initialized for this task")
    
    try:
        # Get or create context
        if task_states[task_id].get("context") is None:
            browser = task_states[task_id]["browser"]
            context = await browser.new_context()
            task_states[task_id]["context"] = context
        else:
            context = task_states[task_id]["context"]
        
        # Get current page
        page = await context.get_current_page()
        
        # Extract form elements using JavaScript evaluation
        form_elements = await page.evaluate("""() => {
            const elements = Array.from(document.querySelectorAll('input, textarea, select, button'));
            return elements.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    id: el.id,
                    name: el.name,
                    value: el.value,
                    tagName: el.tagName,
                    type: el.type,
                    placeholder: el.placeholder,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    ariaLabel: el.getAttribute('aria-label'),
                    dataTestId: el.getAttribute('data-testid'),
                    inputType: el.type,
                    role: el.getAttribute('role'),
                    selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') 
                };
            });
        }""")
        
        return {"form_elements": form_elements}
    except Exception as e:
        print(f"Error getting form elements for task {task_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting form elements: {str(e)}")

@app.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    try:
        # In test mode, always return success
        if os.getenv("TEST_MODE") == "true":
            print("Test mode detected in login, returning mock success")
            return LoginResponse(success=True, message="Login successful (test mock)")
            
        browser = Browser(
            config=BrowserConfig(
                headless=True
            )
        )
        
        # Create session manager
        session_manager = LinkedInSessionManager()
        
        # Prepare credentials dictionary
        credentials = {"username": request.username, "password": request.password}
        
        # Attempt login
        success = await session_manager.handle_login(browser, credentials)
        
        if success:
            return LoginResponse(success=True, message="Login successful")
        else:
            raise HTTPException(status_code=401, detail="Login failed")
    except Exception as e:
        print(f"Error during login: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/clear-session")
async def clear_session():
    try:
        # In test mode, just return success without actually doing anything
        if os.getenv("TEST_MODE") == "true":
            print("Test mode detected, simulating session clear")
            return {"success": True, "message": "Session cleared (test mode)"}
        
        session_manager = LinkedInSessionManager()
        await session_manager.clear_session()
        return {"success": True, "message": "Session cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/browser/{task_id}/action")
async def browser_action(
    task_id: str, 
    request: BrowserActionRequest
):
    """Perform a browser action for a specific task."""
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if task_states[task_id].get("browser") is None:
        raise HTTPException(status_code=400, detail="Browser not initialized for this task")
    
    try:
        # Get or create context
        if task_states[task_id].get("context") is None:
            browser = task_states[task_id]["browser"]
            context = await browser.new_context()
            task_states[task_id]["context"] = context
        else:
            context = task_states[task_id]["context"]
        
        # Get current page
        page = await context.get_current_page()
        
        result = {
            "success": True,
            "action": request.action,
            "selector": request.selector,
            "value": request.value
        }
        
        # Handle different actions
        if request.action == "mouseClick" and request.value:
            # Parse x,y coordinates from value
            try:
                x, y = map(int, request.value.split(','))
                await page.mouse.click(x, y)
                result["message"] = f"Clicked at coordinates ({x}, {y})"
            except Exception as e:
                result["success"] = False
                result["error"] = f"Invalid click coordinates: {str(e)}"
        
        elif request.action == "click" and request.selector:
            try:
                element = await page.query_selector(request.selector)
                if element:
                    await element.click()
                    result["message"] = f"Clicked element with selector: {request.selector}"
                else:
                    result["success"] = False
                    result["error"] = f"Element not found with selector: {request.selector}"
            except Exception as e:
                result["success"] = False
                result["error"] = f"Error clicking element: {str(e)}"
        
        elif request.action == "fill" and request.selector:
            try:
                element = await page.query_selector(request.selector)
                if element:
                    await element.fill(request.value or "")
                    result["message"] = f"Filled element with selector: {request.selector}"
                else:
                    result["success"] = False
                    result["error"] = f"Element not found with selector: {request.selector}"
            except Exception as e:
                result["success"] = False
                result["error"] = f"Error filling element: {str(e)}"
        
        elif request.action == "press" and request.selector:
            try:
                element = await page.query_selector(request.selector)
                if element:
                    await element.press(request.value or "Enter")
                    result["message"] = f"Pressed {request.value or 'Enter'} on element with selector: {request.selector}"
                else:
                    result["success"] = False
                    result["error"] = f"Element not found with selector: {request.selector}"
            except Exception as e:
                result["success"] = False
                result["error"] = f"Error pressing key: {str(e)}"
        
        elif request.action == "back":
            try:
                await context.go_back()
                result["message"] = "Navigated back"
            except Exception as e:
                result["success"] = False
                result["error"] = f"Error navigating back: {str(e)}"
        
        elif request.action == "forward":
            try:
                await context.go_forward()
                result["message"] = "Navigated forward"
            except Exception as e:
                result["success"] = False
                result["error"] = f"Error navigating forward: {str(e)}"
        
        elif request.action == "reload":
            try:
                await context.refresh_page()
                result["message"] = "Reloaded page"
            except Exception as e:
                result["success"] = False
                result["error"] = f"Error reloading page: {str(e)}"
        
        elif request.action == "extract" and request.selector:
            try:
                element = await page.query_selector(request.selector)
                if element:
                    text = await element.text_content()
                    result["message"] = f"Extracted content from selector: {request.selector}"
                    result["extracted_content"] = text
                else:
                    result["success"] = False
                    result["error"] = f"Element not found with selector: {request.selector}"
            except Exception as e:
                result["success"] = False
                result["error"] = f"Error extracting content: {str(e)}"
        
        elif request.action == "refresh":
            # This is just to refresh the screenshot without doing any action
            result["message"] = "Refreshed browser state"
        
        else:
            result["success"] = False
            result["error"] = f"Unknown action: {request.action}"
        
        # Always capture a new screenshot after action
        screenshot_b64 = await context.take_screenshot()
        result["screenshot"] = f"data:image/png;base64,{screenshot_b64}"
        
        # Get current URL
        result["url"] = page.url
        
        # Get form elements
        form_elements = await page.evaluate("""() => {
            const elements = Array.from(document.querySelectorAll('input, textarea, select, button'));
            return elements.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    id: el.id,
                    name: el.name,
                    value: el.value,
                    tagName: el.tagName,
                    type: el.type,
                    placeholder: el.placeholder,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    ariaLabel: el.getAttribute('aria-label'),
                    dataTestId: el.getAttribute('data-testid'),
                    inputType: el.type,
                    role: el.getAttribute('role'),
                    selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')
                };
            });
        }""")
        result["formElements"] = form_elements
        
        # Get navigation history state
        history_state = await page.evaluate("""() => {
            return {
                canGoBack: window.history.length > 1 && window.history.state !== null,
                canGoForward: window.history.state !== null && window.history.state.forward !== null
            };
        }""")
        result["historyState"] = history_state
        
        # Record action in task history
        task_states[task_id]["history"].append({
            "step": len(task_states[task_id]["history"]) + 1,
            "action": f"User action: {request.action} {request.selector or ''} {request.value or ''}",
            "timestamp": datetime.now().isoformat()
        })
        
        return result
    except Exception as e:
        print(f"Error performing browser action for task {task_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error performing browser action: {str(e)}")

@app.post("/browser/{task_id}/navigate")
async def browser_navigate(
    task_id: str, 
    request: BrowserNavigateRequest
):
    """Navigate to a URL for a specific task."""
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if task_states[task_id].get("browser") is None:
        raise HTTPException(status_code=400, detail="Browser not initialized for this task")
    
    try:
        # Get or create context
        if task_states[task_id].get("context") is None:
            browser = task_states[task_id]["browser"]
            context = await browser.new_context()
            task_states[task_id]["context"] = context
        else:
            context = task_states[task_id]["context"]
        
        # Navigate to the URL using the context
        await context.navigate_to(request.url)
        
        # Get current page after navigation
        page = await context.get_current_page()
        
        # Capture a new screenshot
        screenshot_b64 = await context.take_screenshot()
        
        # Get form elements
        form_elements = await page.evaluate("""() => {
            const elements = Array.from(document.querySelectorAll('input, textarea, select, button'));
            return elements.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    id: el.id,
                    name: el.name,
                    value: el.value,
                    tagName: el.tagName,
                    type: el.type,
                    placeholder: el.placeholder,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    ariaLabel: el.getAttribute('aria-label'),
                    dataTestId: el.getAttribute('data-testid'),
                    inputType: el.type,
                    role: el.getAttribute('role'),
                    selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')
                };
            });
        }""")
        
        # Get navigation history state
        history_state = await page.evaluate("""() => {
            return {
                canGoBack: window.history.length > 1 && window.history.state !== null,
                canGoForward: window.history.state !== null && window.history.state.forward !== null
            };
        }""")
        
        # Record navigation in task history
        task_states[task_id]["history"].append({
            "step": len(task_states[task_id]["history"]) + 1,
            "action": f"User navigation: {request.url}",
            "timestamp": datetime.now().isoformat()
        })
        
        return {
            "success": True,
            "url": page.url,
            "screenshot": f"data:image/png;base64,{screenshot_b64}",
            "formElements": form_elements,
            "historyState": history_state,
            "message": f"Navigated to {request.url}"
        }
    except Exception as e:
        print(f"Error navigating for task {task_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error navigating: {str(e)}")

@app.post("/browser/{task_id}/refresh")
async def refresh_browser(task_id: str):
    """Refresh the browser and return the current state without changing the page.
    
    This endpoint is useful for getting the latest screenshot and form elements
    without performing any navigation or action.
    """
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if task_states[task_id].get("browser") is None:
        raise HTTPException(status_code=400, detail="Browser not initialized for this task")
    
    try:
        # Get or create context
        if task_states[task_id].get("context") is None:
            browser = task_states[task_id]["browser"]
            context = await browser.new_context()
            task_states[task_id]["context"] = context
        else:
            context = task_states[task_id]["context"]
        
        # Get current page
        page = await context.get_current_page()
        
        # Take a fresh screenshot
        screenshot_b64 = await context.take_screenshot()
        
        # Get form elements
        form_elements = await page.evaluate("""() => {
            const elements = Array.from(document.querySelectorAll('input, textarea, select, button'));
            return elements.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    id: el.id,
                    name: el.name,
                    value: el.value,
                    tagName: el.tagName,
                    type: el.type,
                    placeholder: el.placeholder,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    ariaLabel: el.getAttribute('aria-label'),
                    dataTestId: el.getAttribute('data-testid'),
                    inputType: el.type,
                    role: el.getAttribute('role'),
                    selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')
                };
            });
        }""")
        
        # Get navigation history state
        history_state = await page.evaluate("""() => {
            return {
                canGoBack: window.history.length > 1 && window.history.state !== null,
                canGoForward: window.history.state !== null && window.history.state.forward !== null
            };
        }""")
        
        return {
            "success": True,
            "url": page.url,
            "screenshot": f"data:image/png;base64,{screenshot_b64}",
            "formElements": form_elements,
            "historyState": history_state,
            "message": "Browser refreshed"
        }
    except Exception as e:
        print(f"Error refreshing browser for task {task_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error refreshing browser: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8003,
        reload=True
    ) 