'use server'

import { BrowserActions, SERVICE_BASE_URL, ENDPOINTS, BrowserServiceResponse } from '../api/browser-service/actions';
import { PageInfo } from '@/types/prompts';

export type ActionResult = PageInfo & {
  success: boolean;
}

export async function navigateTo(url: string, sessionId: string): Promise<ActionResult> {
  try {
    console.log(`[navigateTo] Attempting to navigate to: ${url}`);
    
    // Call the browser-use-service API directly 
    const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.BROWSER_NAVIGATE(sessionId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to navigate: ${response.statusText}`);
    }

    const data = await response.json();
    
    // For testing, return mock data if needed
    if (process.env.NODE_ENV === 'development' && !data) {
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
    
    return {
      success: data.success,
      screenshot: data.screenshot || '',
      content: data.content || '',
      url: data.url || url,
      title: data.title || '',
      formElements: data.formElements || [],
      clickableElements: data.clickableElements || [],
      historyState: data.historyState || {
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
    if (process.env.NODE_ENV === 'development' && !sessionId) {
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

    // Use the refresh endpoint for refresh action
    if (action === BrowserActions.REFRESH) {
      const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.BROWSER_REFRESH(sessionId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        success: data.success,
        title: data.title || '',
        screenshot: data.screenshot || '',
        content: data.content || '',
        url: data.url || '',
        formElements: data.formElements || [],
        clickableElements: data.clickableElements || [],
        historyState: data.historyState || {
          canGoBack: false,
          canGoForward: false,
          currentIndex: 0,
          length: 0
        }
      };
    }

    // Call the browser-use-service API directly using the action endpoint
    const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.BROWSER_ACTION(sessionId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: action,
        selector: selector,
        value: value
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to perform action: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      success: data.success,
      title: data.title || '',
      screenshot: data.screenshot || '',
      content: data.content || '',
      url: data.url || '',
      formElements: data.formElements || [],
      clickableElements: data.clickableElements || [],
      historyState: data.historyState || {
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

export async function createBrowser(): Promise<string> {
  try {
    console.log(`[createBrowser] Creating a new browser session`);
    
    // Call the browser-use-service API to create a browser
    const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.BROWSER_CREATE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        headless: true
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create browser: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Return the task_id from the response which is our browser session ID
    return data.task_id;
  } catch (error) {
    console.error('Browser creation error:', error);
    throw error;
  }
}