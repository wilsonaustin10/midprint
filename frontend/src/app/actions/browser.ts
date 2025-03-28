'use server'

import { BrowserActions, SERVICE_BASE_URL, ENDPOINTS, BrowserServiceResponse } from '../api/browser-service/actions';
import { PageInfo } from '@/types/prompts';

export type ActionResult = PageInfo & {
  success: boolean;
}

export async function navigateTo(url: string, sessionId: string): Promise<ActionResult> {
  try {
    console.log(`[navigateTo] Attempting to navigate to: ${url}`);
    
    // Call the browser-use-service API
    const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.RUN_AGENT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task: `Navigate to ${url}`,
        max_steps: 1,
        config: {
          llm: {
            provider: 'openai',
            model: 'gpt-4'
          }
        },
        browser_info: {
          headless: true
        },
        action: BrowserActions.CLICK,
        url: url,
        sessionId: sessionId
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to navigate: ${response.statusText}`);
    }

    const data = await response.json();
    
    // For testing, skip the task polling and return mock data
    if (process.env.NODE_ENV === 'development') {
      return {
        success: true,
        screenshot: '',
        content: '',
        url: url,
        title: 'Page Title',
        formElements: [],
        clickableElements: [],
        historyState: {
          canGoBack: false,
          canGoForward: false,
          currentIndex: 0,
          length: 0
        }
      };
    }
    
    // Poll for task completion
    const taskResult = await pollTaskCompletion(data.task_id);
    
    return {
      success: true,
      screenshot: taskResult.screenshot || '',
      content: taskResult.content || '',
      url: taskResult.url || url,
      title: taskResult.title || '',
      formElements: taskResult.formElements || [],
      clickableElements: taskResult.clickableElements || [],
      historyState: taskResult.historyState || {
        canGoBack: false,
        canGoForward: false,
        currentIndex: 0,
        length: 0
      }
    };
  } catch (error) {
    console.error('Navigation error:', error);
    return {
      success: false,
      title: "",
      content: "",
      url: "",
      formElements: [],
      clickableElements: [],
      historyState: {
        canGoBack: false,
        canGoForward: false,
        currentIndex: 0,
        length: 0
      }
    };
  }
}

export async function performAction(action: string, selector: string, value: string | null | undefined, sessionId: string): Promise<ActionResult> {
  try {
    console.debug(`${sessionId}: Performing: ${action}`);

    // For testing, return mock data
    if (process.env.NODE_ENV === 'development') {
      return {
        success: true,
        title: 'Page Title',
        screenshot: '',
        content: '',
        url: '',
        formElements: [],
        clickableElements: [],
        historyState: {
          canGoBack: false,
          canGoForward: false,
          currentIndex: 0,
          length: 0
        }
      };
    }

    // Call the browser-use-service API
    const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.RUN_AGENT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task: `Perform ${action} ${selector ? `on ${selector}` : ''} ${value ? `with value ${value}` : ''}`,
        max_steps: 1,
        config: {
          llm: {
            provider: 'openai',
            model: 'gpt-4'
          }
        },
        browser_info: {
          headless: true
        },
        action: action,
        selector: selector,
        value: value,
        sessionId: sessionId
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to perform action: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Poll for task completion
    const taskResult = await pollTaskCompletion(data.task_id);
    
    return {
      success: true,
      title: taskResult.title || '',
      screenshot: taskResult.screenshot || '',
      content: taskResult.content || '',
      url: taskResult.url || '',
      formElements: taskResult.formElements || [],
      clickableElements: taskResult.clickableElements || [],
      historyState: taskResult.historyState || {
        canGoBack: false,
        canGoForward: false,
        currentIndex: 0,
        length: 0
      }
    };
  } catch (error) {
    console.error('Action error:', error);
    return {
      success: false,
      title: "",
      content: "",
      url: "",
      formElements: [],
      clickableElements: [],
      historyState: {
        canGoBack: false,
        canGoForward: false,
        currentIndex: 0,
        length: 0
      }
    };
  }
}

// Helper function to poll task completion
async function pollTaskCompletion(taskId: string, maxAttempts = 30): Promise<BrowserServiceResponse> {
  let attempts = 0;
  const delay = 1000; // 1 second delay between attempts
  
  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.TASK_STATUS}/${taskId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch task status: ${response.statusText}`);
      }
      
      const taskStatus = await response.json();
      
      if (taskStatus.status === 'completed') {
        return taskStatus.result || {};
      } else if (taskStatus.status === 'failed') {
        throw new Error(taskStatus.error || 'Task failed');
      }
      
      // Wait before trying again
      await new Promise(resolve => setTimeout(resolve, delay));
      attempts++;
    } catch (error) {
      console.error(`Error polling task completion: ${error}`);
      throw error;
    }
  }
  
  throw new Error('Task polling timed out');
}