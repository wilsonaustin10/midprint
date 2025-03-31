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
import base64 # Add this import at the top

# Define the logger
logger = logging.getLogger(__name__)

# --- Custom Log Handler Updated --- 
class SSELogHandler(logging.Handler):
    def __init__(self, task_id: str, sse_queue: asyncio.Queue, max_steps: int, agent_handler: Optional['AgentHandler']):
        super().__init__()
        self.task_id = task_id
        self.sse_queue = sse_queue # Store the queue
        self.max_steps = max_steps
        self.current_step = 0 
        self.agent_handler = agent_handler # Store agent_handler instance again
        self.setFormatter(logging.Formatter('%(message)s'))

    # --- ADDED: Method to trigger state capture via agent_handler ---
    def _trigger_state_capture(self):
        # --- MODIFIED: Check if agent_handler exists AND is active ---
        if self.agent_handler and self.agent_handler.is_active:
            # --- CORRECTED: Use 'trigger' instead of 'trigger_event' ---
            asyncio.create_task(self.agent_handler.capture_and_push_browser_state(trigger="SSELogHandler"))
        elif self.agent_handler and hasattr(self.agent_handler, 'is_active') and not self.agent_handler.is_active:
            # Use print to avoid logger recursion if agent is inactive
            print(f"[SSELogHandler INFO {self.task_id}] Skipping state capture trigger: AgentHandler is inactive.")
        else:
            # Use print to avoid logger recursion for other errors
            print(f"[SSELogHandler ERROR {self.task_id}] Cannot trigger state capture: AgentHandler reference missing, invalid, or lacks 'is_active' flag.")
    # --- END MODIFIED ---
            
    def emit(self, record):
        # logger.info(f"[SSELogHandler DEBUG {self.task_id}] Received log record. Name: '{record.name}', Level: {record.levelname}, Raw Message: '{record.getMessage()}'") # DEBUG
        raw_message = record.getMessage()
        sse_event_data = None
        event_type = None

        # Check for start message first to initialize total_steps if needed
        # Using raw_message which doesn't have the INFO [agent] prefix
        start_match = re.match(r"🚀 Starting task: (.*)", raw_message)
        if start_match:
            task_description = start_match.group(1).strip()
            # Update state, maybe send a specific 'start' event or initial step?
            self.current_step = 1 # Assume step 1 starts immediately after
            sse_event_data = {
                "type": "agent_step", # Treat start as step 1 initiation
                "current_step": self.current_step,
                "total_steps": self.max_steps,
                "message": f"Starting task: {task_description}"
            }
            event_type = "agent_step"
            # --- Trigger state capture on step change --- 
            self._trigger_state_capture()
            # --- End Trigger --- 

        # Check for step update
        step_match = re.match(r"📍 Step (\d+)", raw_message)
        if step_match:
            self.current_step = int(step_match.group(1))
            sse_event_data = { # This overwrites the event if start_match was also true (unlikely)
                "type": "agent_step",
                "current_step": self.current_step,
                "total_steps": self.max_steps,
                "message": f"Starting step {self.current_step}"
            }
            event_type = "agent_step"
            # --- Trigger state capture on step change --- 
            self._trigger_state_capture()
            # --- End Trigger --- 

        # Check for other relevant messages to send as history updates
        # These patterns match the raw message content
        action_match = re.match(r"🛠️  Action \d+/\d+: (.*)", raw_message)
        memory_match = re.match(r"🧠 Memory: (.*)", raw_message)
        eval_match = re.match(r"(?:👍|👎|🤷) Eval: (.*)", raw_message) # Match success/fail/unknown eval
        result_match = re.match(r"📄 Result: (.*)", raw_message)
        goal_match = re.match(r"🎯 Next goal: (.*)", raw_message)
        task_complete_match = re.match(r"✅ Task completed", raw_message)

        # Prioritize step updates over history updates if both match? No, let both send if needed.
        # If it's not a step change, check if it's a history item
        if not step_match and not start_match: # Avoid duplicating step messages
             if action_match or memory_match or eval_match or result_match or goal_match or task_complete_match:
                # Use the raw message as the content for the history update
                message_content = raw_message
                sse_event_data = {
                    "type": "history_update",
                    "current_step": self.current_step, # Include current step context
                    "total_steps": self.max_steps,
                    "message": message_content,
                    # You could add more structured data here if needed, e.g., parse action details
                }
                event_type = "history_update"
                # --- Trigger state capture on step change --- 
                self._trigger_state_capture()
                # --- End Trigger --- 

        # --- MODIFIED: Use put_nowait --- 
        if sse_event_data and event_type:
            # --- REMOVED internal logger.info calls to prevent recursion ---
            # logger.info(f"[SSELogHandler {self.task_id}] Matched log: '{raw_message}'. Preparing event: {event_type}, Data: {sse_event_data}") # DEBUG
            try:
                # Directly put into the queue (non-blocking)
                self.sse_queue.put_nowait(sse_event_data)
                # logger.info(f"[SSELogHandler {self.task_id}] Put event type: {event_type} into queue.") # DEBUG
            except asyncio.QueueFull:
                # Use print for critical errors within handler to avoid recursion
                print(f"[SSELogHandler ERROR {self.task_id}] SSE queue is full. Failed to put event: {event_type}")
            except Exception as e:
                print(f"[SSELogHandler ERROR {self.task_id}] Error putting event type {event_type} into queue: {e}")

# --- Custom Controller Updated --- 
class CustomController(Controller):
    def __init__(self, agent_handler: 'AgentHandler', sse_queue: asyncio.Queue):
        super().__init__()
        self.agent_handler = agent_handler
        self.sse_queue = sse_queue # Store the queue
        # Use the same logger as the rest of AgentHandler for consistency
        self.logger = logging.getLogger(__name__) 

    async def _capture_and_push_state(self, event_prefix: str):
        # Use self.logger consistently
        self.logger.info(f"[CustomController {self.agent_handler.task_id}] {event_prefix} action. Attempting state capture.") 
        try:
            browser_state = await self.agent_handler._get_current_browser_state()
            if not browser_state or browser_state.get("screenshot") is None:
                 self.logger.warning(f"[CustomController {self.agent_handler.task_id}] State capture failed or incomplete. Skipping SSE push.")
                 return # Avoid pushing invalid state
                 
            sse_event_data = {
                "type": "browser_update",
                "data": browser_state
            }
            self.sse_queue.put_nowait(sse_event_data)
            self.logger.info(f"[CustomController {self.agent_handler.task_id}] Successfully put browser_update event into queue ({event_prefix} action).")
        except asyncio.QueueFull:
            self.logger.error(f"[CustomController {self.agent_handler.task_id}] SSE queue FULL. Failed to put browser_update ({event_prefix} action).")
        except Exception as e:
            # Log the exception with traceback
            self.logger.error(f"[CustomController {self.agent_handler.task_id}] Error capturing/pushing state ({event_prefix} action): {e}", exc_info=True)

    async def on_action_start(self, action: Dict[str, Any]):
        """Hook called before an agent action is executed."""
        # --- ADDED ENTRY LOG --- 
        self.logger.info(f"[CustomController {self.agent_handler.task_id}] ENTERING on_action_start")
        # -----------------------
        await self._capture_and_push_state("Before")
        # --- ADDED EXIT LOG ---
        self.logger.info(f"[CustomController {self.agent_handler.task_id}] EXITING on_action_start")
        # ----------------------

    async def on_action_end(self, action: Dict[str, Any], result: str):
        """Hook called after an agent action is executed."""
        # --- ADDED ENTRY LOG --- 
        self.logger.info(f"[CustomController {self.agent_handler.task_id}] ENTERING on_action_end")
        # -----------------------
        await self._capture_and_push_state("After")
        # --- ADDED EXIT LOG ---
        self.logger.info(f"[CustomController {self.agent_handler.task_id}] EXITING on_action_end")
        # ----------------------

# --- End Custom Controller ---

class AgentHandler:
    """Handler for browser-use Agent integration."""
    
    def __init__(self, browser: Browser, context: Any, task_id: str, sse_queue: asyncio.Queue):
        """
        Initialize the agent handler.
        
        Args:
            browser: Browser instance to use for automation
            context: Browser context instance (e.g., BrowserContextWrapper)
            task_id: The ID of the task being run, for logging/context
            sse_queue: The queue for sending Server-Sent Events
        """
        self.browser = browser
        self.context = context # Store context
        self.task_id = task_id
        self.sse_queue = sse_queue # Store the SSE queue
        self.controller = None # Will be initialized later
        self.agent = None
        self.history = []
        self.agent_logger = logging.getLogger('agent') # Keep logger if agent uses it internally
        self.agent_task: Optional[asyncio.Task] = None
        self.max_steps = 50 # Default max steps
        self.is_active = True # <<< ADDED: Flag to indicate if the handler/task is active
        
        # --- ADDED: Setup logging handler here ---
        self.setup_agent_logging()
        # --- END ADDED ---

    # --- Method to setup logging MODIFIED --- 
    def setup_agent_logging(self):
        """Sets up the custom SSE log handler directly on the browser_use.agent.service logger."""
        # --- Target the CORRECT logger --- 
        target_logger_name = 'browser_use.agent.service' 
        target_logger = logging.getLogger(target_logger_name)
        target_logger.setLevel(logging.INFO) # Ensure logger is processing INFO level
        # We rely on the library setting propagate=False on 'browser_use', so messages shouldn't reach root anyway.

        # Remove existing SSE handlers from the TARGET logger to avoid duplicates on reload
        for handler in target_logger.handlers[:]:
            if isinstance(handler, SSELogHandler) and getattr(handler, 'task_id', None) == self.task_id:
                 logger.info(f"[AgentHandler {self.task_id} LOGGING_SETUP] Removing existing SSE handler from '{target_logger_name}' logger: {handler}")
                 target_logger.removeHandler(handler)

        # Create and add our custom SSE handler to the TARGET logger
        if self.sse_queue: # Ensure queue exists
            sse_handler = SSELogHandler(
                task_id=self.task_id, 
                sse_queue=self.sse_queue, 
                max_steps=self.max_steps,
                agent_handler=self # Pass self (the AgentHandler instance)
            )
            target_logger.addHandler(sse_handler)
            logger.info(f"[AgentHandler {self.task_id} LOGGING_SETUP] Custom SSELogHandler added to '{target_logger_name}' logger (with handler ref). ")
            # --- REMOVED test log --- 
            # our_logger.info(f"[OUR_LOGGER_TEST {self.task_id}] This is a test message directly from '{__name__}'.")
        else:
            logger.warning(f"[AgentHandler {self.task_id} LOGGING_SETUP] SSE queue not available, cannot add SSELogHandler to '{target_logger_name}' logger.")
            
    # --- END Method to setup logging ---

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
        logger.info(f"[AgentHandler] Initializing agent for task: {self.task_id}")
        self.max_steps = max_steps
        try:
            if not config or not config.get('llm'):
                raise ValueError("LLM configuration is required")
            
            llm_config = config.get('llm', {})
            provider = llm_config.get('provider', 'openai')
            model = llm_config.get('model', 'gpt-4')
            
            # --- MODIFIED: Use CustomController with the passed SSE Queue --- 
            if not self.sse_queue:
                 logger.error(f"[AgentHandler {self.task_id}] SSE queue is missing! Cannot initialize CustomController.")
                 raise ValueError("SSE queue is required for CustomController")
            self.controller = CustomController(agent_handler=self, sse_queue=self.sse_queue)
            # --- END MODIFICATION ---
            
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
            
            # Initialize Agent with our custom controller
            self.agent = Agent(
                task=task,
                browser=self.browser,
                controller=self.controller, # Pass custom controller
                llm=llm,
            )

            logger.info(f"[AgentHandler] Agent initialized for task {self.task_id}.")

        except Exception as e:
            logger.error(f"[AgentHandler] Failed to initialize agent for task {self.task_id}: {e}", exc_info=True)
            raise
        
        return self.agent
        
    async def _get_current_browser_state(self) -> Dict[str, Any]:
        """Helper function to capture the current browser state."""
        # --- ADDED Logging --- 
        logger.info(f"[AgentHandler {self.task_id}] Starting _get_current_browser_state.")
        # --- END ADDED --- 
        state = {
            "url": None,
            "pageTitle": None,
            "screenshot": None,
            "formElements": [],
            "historyState": {"canGoBack": False, "canGoForward": False}
        }
        try:
            if not self.context or not hasattr(self.context, 'get_current_page'):
                 logger.error(f"[AgentHandler {self.task_id}] Browser context (self.context) is missing!")
                 # --- ADDED Logging before returning empty state --- 
                 logger.info(f"[AgentHandler {self.task_id}] Finished _get_current_browser_state early due to missing context.")
                 # --- END ADDED --- 
                 return state
                 
            if not hasattr(self.context, 'get_current_page'):
                 logger.error(f"[AgentHandler {self.task_id}] Browser context object missing 'get_current_page' method!")
                 # --- ADDED Logging before returning empty state --- 
                 logger.info(f"[AgentHandler {self.task_id}] Finished _get_current_browser_state early due to missing get_current_page.")
                 # --- END ADDED --- 
                 return state # Return default state if we can't get the page

            page = await self.context.get_current_page()
            if not page:
                 logger.error(f"[AgentHandler {self.task_id}] Failed to get current page object from context!")
                 # --- ADDED Logging before returning empty state --- 
                 logger.info(f"[AgentHandler {self.task_id}] Finished _get_current_browser_state early due to missing page object.")
                 # --- END ADDED --- 
                 return state

            # --- MODIFIED: Use page object methods/properties ---
            # Use asyncio.gather for concurrent fetching from the page object
            url, screenshot_bytes, elements, title, can_back, can_fwd = await asyncio.gather(
                asyncio.create_task(self._safe_get_url(page)),         # Use page.url property safely
                page.screenshot(),                                     # Use page.screenshot() method
                asyncio.create_task(self._safe_get_elements(page)),    # Use page.evaluate for elements
                page.title(),                                          # Use page.title() method
                asyncio.create_task(self._safe_can_go(page, 'back')),  # Use page.evaluate for history
                asyncio.create_task(self._safe_can_go(page, 'forward')),# Use page.evaluate for history
                return_exceptions=True 
            )

            # Process results, handling potential errors from gather
            state["url"] = url if not isinstance(url, Exception) else None
            state["pageTitle"] = title if not isinstance(title, Exception) else None
            state["historyState"]["canGoBack"] = can_back if not isinstance(can_back, Exception) else False
            state["historyState"]["canGoForward"] = can_fwd if not isinstance(can_fwd, Exception) else False

            if screenshot_bytes and not isinstance(screenshot_bytes, Exception):
                state["screenshot"] = f"data:image/png;base64,{base64.b64encode(screenshot_bytes).decode()}"
            else:
                 logger.warning(f"[AgentHandler {self.task_id}] Failed to get screenshot: {screenshot_bytes}")


            if elements and not isinstance(elements, Exception):
                 state["formElements"] = elements
            else:
                 logger.warning(f"[AgentHandler {self.task_id}] Failed to get interactive elements: {elements}")

            # --- ADDED Logging before returning state --- 
            screenshot_present = state.get("screenshot") is not None
            logger.info(f"[AgentHandler {self.task_id}] Finished _get_current_browser_state. Screenshot present: {screenshot_present}. URL: {state.get('url')}")
            # --- END ADDED --- 

        except Exception as e:
            logger.error(f"[AgentHandler {self.task_id}] Error capturing browser state in _get_current_browser_state: {e}", exc_info=True)
            # --- ADDED Logging before returning empty state on error --- 
            logger.info(f"[AgentHandler {self.task_id}] Finished _get_current_browser_state with exception, returning default state.")
            # --- END ADDED --- 
        
        return state

    # --- ADDED Helper methods for safe state retrieval ---
    async def _safe_get_url(self, page):
        try:
            return page.url
        except Exception as e:
            logger.warning(f"[AgentHandler {self.task_id}] Failed to get page URL: {e}")
            return None

    async def _safe_get_elements(self, page):
        try:
            # MODIFIED: Include anchor tags (<a>) in the querySelectorAll
            return await page.evaluate("""() => {
                const elements = Array.from(document.querySelectorAll('input, textarea, select, button, a'));
                return elements.map(el => {
                    const rect = el.getBoundingClientRect();
                    const safeGetAttribute = (name) => el.hasAttribute(name) ? el.getAttribute(name) : null;
                    const style = window.getComputedStyle(el);
                    
                    // Basic properties, checking for existence to avoid errors
                    const elementInfo = {
                        id: el.id || '', 
                        name: el.name || '', 
                        value: el.value || '', // May not apply to all, but safe
                        tagName: el.tagName || '', 
                        type: el.type || '', // Input type, button type etc.
                        placeholder: el.placeholder || '', 
                        x: rect?.x || 0, 
                        y: rect?.y || 0, 
                        width: rect?.width || 0, 
                        height: rect?.height || 0,
                        ariaLabel: safeGetAttribute('aria-label'),
                        dataTestId: safeGetAttribute('data-testid'),
                        role: safeGetAttribute('role'),
                        // Generate a simple selector as fallback
                        selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''),
                        // Add specific properties based on tag type
                        textContent: el.textContent?.trim() || '',
                        href: el.href || null, // Specifically for <a> tags
                        isVisible: style.visibility !== 'hidden' && style.display !== 'none' && rect?.width > 0 && rect?.height > 0, // Basic visibility check
                        // Input type needs correction for non-inputs
                        inputType: el.tagName === 'TEXTAREA' ? 'textarea' :
                                   el.tagName === 'SELECT' ? 'select' :
                                   el.tagName === 'BUTTON' ? 'button' :
                                   el.tagName === 'A' ? 'link' :
                                   el.type || '' 
                    };
                    return elementInfo;
                });
            }""")
        except Exception as e:
            # Log the full error for better debugging
            logger.warning(f"[AgentHandler {self.task_id}] Failed to evaluate page elements: {e}", exc_info=True) 
            return []
            
    async def _safe_can_go(self, page, direction):
        try:
            if direction == 'back':
                 return await page.evaluate("() => window.history.length > 1 && window.history.state !== null")
            elif direction == 'forward':
                 # Simple check, might need refinement based on how history/state is managed
                 return await page.evaluate("() => false") # Placeholder, forward logic can be complex
            return False
        except Exception as e:
             logger.warning(f"[AgentHandler {self.task_id}] Failed to evaluate history state ({direction}): {e}")
             return False
    # --- End Helper methods ---

    async def run_agent(self, task: str, config: Dict[str, Any], max_steps: int = 50) -> Dict[str, Any]:
        """
        Runs the browser-use agent for the full duration and returns the final result.
        State updates are no longer pushed during execution from this handler.
        """
        logger.info(f"[AgentHandler {self.task_id}] run_agent called for task: {task}")
        from browser_use.agent.views import AgentHistoryList

        final_result_dict = {
            "success": False, "history": [], "error": None, "final_answer": None,
        }
        agent_history_list: Optional[AgentHistoryList] = None

        try:
            if not self.agent:
                await self.initialize_agent(task, config, max_steps)
                if not self.agent:
                     raise RuntimeError("Agent initialization failed.")

            logger.info(f"[AgentHandler {self.task_id}] Starting agent execution (max_steps={max_steps})")

            # --- Let the agent run to completion (or max_steps) --- 
            agent_history_list = await self.agent.run(max_steps=self.max_steps) 

            # --- Add detailed logging of agent_history_list ---
            logger.info(f"[AgentHandler {self.task_id}] Agent execution completed. Inspecting agent_history_list:")
            logger.info(f"[AgentHandler {self.task_id}] Type: {type(agent_history_list)}")
            # --- Call is_successful as a method --- 
            is_successful_val = getattr(agent_history_list, 'is_successful', lambda: None)() # Call directly if possible
            logger.info(f"[AgentHandler {self.task_id}] Is successful: {is_successful_val}")
            logger.info(f"[AgentHandler {self.task_id}] Has action_results attribute/method: {hasattr(agent_history_list, 'action_results')}")
            action_results_list = None
            if hasattr(agent_history_list, 'action_results'):
                action_results_method_or_attr = getattr(agent_history_list, 'action_results')
                if callable(action_results_method_or_attr):
                    # --- Call action_results as a method --- 
                    action_results_list = action_results_method_or_attr()
                    logger.info(f"[AgentHandler {self.task_id}] Called action_results() method.")
                elif isinstance(action_results_method_or_attr, list):
                    action_results_list = action_results_method_or_attr # It's already a list
                    logger.info(f"[AgentHandler {self.task_id}] Accessed action_results attribute (list).")
                else:
                    logger.warning(f"[AgentHandler {self.task_id}] action_results is neither callable nor a list. Type: {type(action_results_method_or_attr)}")

            if action_results_list is not None:
                 logger.info(f"[AgentHandler {self.task_id}] Number of action results: {len(action_results_list)}")
                 for i, result in enumerate(action_results_list):
                     logger.info(f"[AgentHandler {self.task_id}] Action result {i}: Type={type(result)}, Has dict method={hasattr(result, 'dict')}")
            else:
                 logger.info(f"[AgentHandler {self.task_id}] Could not retrieve action results list.")

            logger.info(f"[AgentHandler {self.task_id}] Finished agent execution.")
            
            # --- Process Final Results --- 
            if agent_history_list:
                 # --- Use the stored is_successful_val --- 
                 final_result_dict["success"] = is_successful_val if is_successful_val is not None else False 
                 temp_history = []
                 # --- Use the stored action_results_list --- 
                 if action_results_list is not None and isinstance(action_results_list, list):
                     logger.info(f"[AgentHandler {self.task_id}] Processing {len(action_results_list)} items from action_results_list for history.")
                     for res in action_results_list:
                         try:
                             # Use .dict() if available, otherwise convert to string
                             temp_history.append(res.dict() if hasattr(res, 'dict') else str(res))
                         except Exception as hist_err:
                             logger.warning(f"[AgentHandler {self.task_id}] Error serializing history item: {hist_err}")
                             temp_history.append(str(res))
                 final_result_dict["history"] = temp_history

                 if hasattr(agent_history_list, 'final_result') and agent_history_list.final_result:
                     final_action = agent_history_list.final_result
                     if hasattr(final_action, 'answer'):
                         final_result_dict["final_answer"] = final_action.answer
                     if not final_result_dict["success"] and hasattr(final_action, 'error') and final_action.error:
                         final_result_dict["error"] = str(final_action.error)
                 
                 if not final_result_dict["success"] and not final_result_dict["error"]:
                     final_result_dict["error"] = "Agent task finished without success state."
            else:
                 final_result_dict["error"] = "Agent history unavailable after execution."
                 logger.warning(f"[AgentHandler {self.task_id}] Agent history not found post-execution.")

        except Exception as e:
            logger.error(f"[AgentHandler {self.task_id}] Unhandled exception during agent run: {e}", exc_info=True)
            final_result_dict["error"] = f"Unhandled exception: {e}"
            final_result_dict["success"] = False
        
        # No finally block needed here for SSE pushes
        # Final status will be pushed by execute_agent_task in main.py

        return final_result_dict # Return the processed dict

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

    # --- ADDED: capture_and_push_browser_state method MODIFIED --- 
    async def capture_and_push_browser_state(self, trigger: str = "Unknown"):
        """Captures current browser state and pushes it to the SSE queue."""
        if not self.is_active: # Check if the handler is still active
            logger.warning(f"[AgentHandler {self.task_id}] Skipping state capture (Trigger: {trigger})... Handler is inactive.")
            return

        current_state = await self._get_current_browser_state()
        if not current_state or not current_state.get('screenshot'):
            logger.warning(
                f"[AgentHandler {self.task_id}] Captured state is invalid (Trigger: {trigger}): "
                f"Empty state or missing screenshot. Skipping SSE push for browser_update, sending failure event."
            )
            await self.sse_queue.put({"type": "state_capture_failed", "message": "Failed to capture valid browser state"})
            return

        # ---> ADD LOGGING HERE <---
        page_url = "N/A"
        page_title = "N/A"
        try:
            if self.controller and self.controller.page and not self.controller.page.is_closed():
                page_url = self.controller.page.url
                page_title = await self.controller.page.title()
            else:
                 logger.warning(f"[AgentHandler {self.task_id}] Cannot get URL/Title for state capture (Trigger: {trigger}): Page or controller missing/closed.")
        except Exception as e:
            logger.error(f"[AgentHandler {self.task_id}] Error getting URL/Title for state capture (Trigger: {trigger}): {e}")
            
        logger.info(f"[AgentHandler {self.task_id}] Preparing to push 'browser_update' (Trigger: {trigger}). Current Page URL: {page_url}, Title: \"{page_title}\". Screenshot data length: {len(current_state.get('screenshot', ''))}")
        # ---> END LOGGING <---

        await self.sse_queue.put({"type": "browser_update", "data": current_state})
        logger.info(f"[AgentHandler {self.task_id}] Successfully put 'browser_update' event into queue (Trigger: {trigger}).")
    # --- END MODIFIED --- 