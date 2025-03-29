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

class AgentHandler:
    """Handler for browser-use Agent integration."""
    
    def __init__(self, browser: Browser):
        """
        Initialize the agent handler.
        
        Args:
            browser: Browser instance to use for automation
        """
        self.browser = browser
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
        
        # Initialize Agent with task, browser, and controller
        self.agent = Agent(
            task=task,
            browser=self.browser,
            controller=self.controller,
            llm={"provider": provider, "model": model},
            # Any additional configurations from browser-use can go here
        )
        
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
        self.history = []
        
        # Initialize the agent
        await self.initialize_agent(task, config, max_steps)
        
        # Create a listener to capture agent history
        def history_listener(event_type, data):
            timestamp = datetime.now().isoformat()
            self.history.append({
                "timestamp": timestamp,
                "type": event_type,
                "data": data
            })
        
        # Register the listener
        if hasattr(self.agent, "add_listener"):
            self.agent.add_listener(history_listener)
        
        # Run the agent
        try:
            result = await self.agent.run(max_steps=max_steps)
            
            return {
                "success": True,
                "result": result,
                "history": self.history,
                "steps_completed": len(self.history),
                "task": task
            }
        except Exception as e:
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