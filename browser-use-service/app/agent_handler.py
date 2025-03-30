"""
Agent handler module to integrate browser-use's Agent for browser automation.
"""
from browser_use.agent.service import Agent
from browser_use.browser.browser import Browser, BrowserConfig
from browser_use.controller.service import Controller
from typing import Dict, Any, List, Optional
import asyncio
import os
import json
from datetime import datetime
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
import logging # Import logging
import re # Import regex for parsing

# --- Helper Task Function --- 
# Define this outside the handler class to avoid complex scoping/self issues
async def _push_sse_update_task(task_id: str, sse_event_data: dict):
    try:
        # Import here to avoid potential top-level circular imports if main imports handler
        from .main import push_sse_update 
        await push_sse_update(task_id, sse_event_data)
    except Exception as e:
        print(f"[_push_sse_update_task Error] Failed to push update for task {task_id}: {e}")
# --- End Helper Task Function --- 

# --- Custom Log Handler for SSE Updates --- 
class SSELogHandler(logging.Handler):
    def __init__(self, task_id, max_steps):
        super().__init__()
        self.task_id = task_id
        self.max_steps = max_steps
        self.current_step = 0 # Track the current step parsed

    def emit(self, record):
        try:
            log_message = self.format(record) # This should contain only the raw message now
            # --- Simplified Regex Patterns (matching raw message) --- 
            # Match lines like: 📍 Step 2
            step_match = re.search(r"^📍 Step (\d+)", log_message)
            # Match lines like: 🛠️  Action 1/1: {"search_google":...}
            action_match = re.search(r"^🛠️\s+Action \d+/\d+:\s+(.*)", log_message)
            # Match lines like: 📄 Result: The best deal...
            result_match = re.search(r"^📄 Result: (.*)", log_message)
            # Match lines like: 🚀 Starting task: ...
            start_match = re.search(r"^🚀 Starting task: (.*)", log_message)
            # --- End Simplified Regex --- 

            sse_event_data = None
            
            if start_match: # Handle start message for initial total_steps
                 self.current_step = 0
                 sse_event_data = {
                     "type": "agent_step",
                     "step": 0,
                     "message": log_message, # Send the full start message
                     "total_steps": self.max_steps
                 }
            elif step_match:
                self.current_step = int(step_match.group(1))
                sse_event_data = {
                    "type": "agent_step",
                    "step": self.current_step,
                    "message": f"Processing Step {self.current_step}...",
                    "total_steps": self.max_steps 
                }
            elif action_match:
                action_detail = action_match.group(1).strip()
                sse_event_data = {
                    "type": "history_update", 
                    "step": self.current_step, 
                    "message": f"Action: {action_detail[:100]}...",
                    "total_steps": self.max_steps
                }
            elif result_match: 
                final_result = result_match.group(1).strip()
                sse_event_data = {
                    "type": "history_update",
                    "step": self.current_step, 
                    "message": f"Result: {final_result[:100]}...",
                    "total_steps": self.max_steps
                }

            if sse_event_data:
                # print(f"[SSELogHandler DEBUG {self.task_id}] Pushing: {sse_event_data}") # Uncomment for intense debug
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(_push_sse_update_task(self.task_id, sse_event_data))
                except RuntimeError: 
                    print(f"[SSELogHandler Warning] No running event loop to push update for {self.task_id}")

        except Exception as e:
            print(f"[SSELogHandler Error] Exception in emit: {e}")
# --- End Custom Log Handler ---

class AgentHandler:
    """Handler for browser-use Agent integration."""
    
    def __init__(self, browser: Browser, task_id: str):
        """
        Initialize the agent handler.
        
        Args:
            browser: Browser instance to use for automation
            task_id: The ID of the task being run, for SSE updates
        """
        self.browser = browser
        self.task_id = task_id
        self.controller = None
        self.agent = None
        self.history = []
        
    async def initialize_agent(self, task: str, config: Dict[str, Any], max_steps: int = 50):
        """
        Initialize a new Browser-Use agent with the given task and config.
        
        Args:
            task: The task description
            config: Agent configuration
            max_steps: Maximum steps for agent to execute
            
        Returns:
            Agent instance
        """
        if not config or not config.get('llm'):
            raise ValueError("LLM configuration is required")
            
        llm_config = config.get('llm', {})
        provider = llm_config.get('provider', 'openai')
        model = llm_config.get('model', 'gpt-4')
        
        # Initialize Controller for custom actions if needed
        self.controller = Controller()
        
        # Initialize the correct chat model using langchain based on provider
        if provider == 'openai':
            llm = ChatOpenAI(
                model=model,
                temperature=0,
                max_tokens=llm_config.get('max_tokens', 1000),
                timeout=None,
                max_retries=2,
                api_key=os.getenv("OPENAI_API_KEY")
            )
        elif provider == 'anthropic':
            llm = ChatAnthropic(
                model=model,
                temperature=0,
                max_tokens=llm_config.get('max_tokens', 1000),
                timeout=None,
                max_retries=2,
                api_key=os.getenv("ANTHROPIC_API_KEY")
            )
        else:
            raise ValueError(f"Unsupported LLM provider: {provider}")
        
        # Initialize Agent with task, browser, and controller
        self.agent = Agent(
            task=task,
            browser=self.browser,
            controller=self.controller,
            llm=llm,
        )

        # --- Add Custom Log Handler --- 
        try:
            agent_logger = logging.getLogger('agent') 
            agent_logger.setLevel(logging.INFO) 
            
            # Pass max_steps when creating the handler
            self.sse_log_handler = SSELogHandler(self.task_id, max_steps)
            formatter = logging.Formatter('%(message)s') 
            self.sse_log_handler.setFormatter(formatter)
            # Avoid adding duplicate handlers if initialize_agent is called multiple times
            if not any(isinstance(h, SSELogHandler) for h in agent_logger.handlers):
                 agent_logger.addHandler(self.sse_log_handler)
                 print(f"[AgentHandler] Added SSELogHandler to logger 'agent' for task {self.task_id}")
            else:
                 print(f"[AgentHandler] SSELogHandler already present for logger 'agent' task {self.task_id}")
        except Exception as e:
            print(f"[AgentHandler Error] Failed to add SSELogHandler: {e}")
        # --- End Log Handler Setup ---
        
        return self.agent
        
    async def run_agent(self, task: str, config: Dict[str, Any], max_steps: int = 50) -> Dict[str, Any]:
        """
        Run the browser-use agent with the given task.
        
        Args:
            task: The task description
            config: Agent configuration
            max_steps: Maximum steps for agent to execute
            
        Returns:
            Dict with execution results and history
        """
        self.history = [] # Reset history
        print(f"[AgentHandler] run_agent called for task: {task}") 
        
        # Initialize the agent (this will now also add the log handler)
        print("[AgentHandler] Initializing agent...") 
        await self.initialize_agent(task, config, max_steps)
        print("[AgentHandler] Agent initialized.") 
        
        # --- Remove the previous listener logic as it's not supported --- 
        # async def push_update_task(event_data): ...
        # async def history_listener(event_type, data): ...
        # if hasattr(self.agent, "add_listener"): ...
        # --- End Removal --- 

        # Run the agent
        try:
            print("[AgentHandler] Running agent...") 
            result = await self.agent.run(max_steps=max_steps)
            print(f"[AgentHandler] Agent run finished. Result: {result}") 
            
            # --- Remove Log Handler After Run --- 
            try:
                if hasattr(self, 'sse_log_handler') and self.sse_log_handler:
                    agent_logger = logging.getLogger('agent')
                    agent_logger.removeHandler(self.sse_log_handler)
                    print(f"[AgentHandler] Removed SSELogHandler for task {self.task_id}")
                    self.sse_log_handler = None # Clear reference
            except Exception as e:
                 print(f"[AgentHandler Error] Failed to remove SSELogHandler: {e}")
            # --- End Handler Removal --- 
            
            return {
                "success": True,
                "result": result,
                "history": self.history, # History is now populated by logs, not listener
                "steps_completed": len(self.history), # This might be inaccurate now
                "task": task
            }
        except Exception as e:
            print(f"[AgentHandler] Exception during agent run: {str(e)}") 
            # --- Remove Log Handler on Error --- 
            try:
                if hasattr(self, 'sse_log_handler') and self.sse_log_handler:
                    agent_logger = logging.getLogger('agent')
                    agent_logger.removeHandler(self.sse_log_handler)
                    print(f"[AgentHandler] Removed SSELogHandler on error for task {self.task_id}")
                    self.sse_log_handler = None # Clear reference
            except Exception as e_rem:
                 print(f"[AgentHandler Error] Failed to remove SSELogHandler on error: {e_rem}")
            # --- End Handler Removal --- 
            return {
                "success": False,
                "error": str(e),
                "history": self.history,
                "steps_completed": len(self.history),
                "task": task
            }
            
    async def stop_agent(self):
        """Stop the currently running agent."""
        if self.agent and hasattr(self.agent, "stop"):
            await self.agent.stop()
            return True
        return False
        
    async def extract_content(self, selector: Optional[str] = None) -> Dict[str, Any]:
        """
        Extract content from the current page.
        
        Args:
            selector: Optional CSS selector to extract from
            
        Returns:
            Dict with extracted content
        """
        if not self.agent or not self.browser:
            raise ValueError("Agent and browser must be initialized")
            
        try:
            page = await self.browser.get_current_page()
            
            if selector:
                element = await page.query_selector(selector)
                if element:
                    text = await element.text_content()
                    return {"success": True, "content": text}
                else:
                    return {"success": False, "error": f"Element not found: {selector}"}
            else:
                # Extract full page content
                content = await page.content()
                
                # Use the browser-use agent's extraction capability if available
                if hasattr(self.agent, "extract_content"):
                    extracted = await self.agent.extract_content()
                    return {"success": True, "content": extracted}
                    
                return {"success": True, "content": content}
        except Exception as e:
            return {"success": False, "error": str(e)} 