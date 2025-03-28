export enum BrowserActions {
  MOUSE_CLICK = 'mouseClick',
  CLICK = 'click',
  CLICK_ELEMENT = 'clickElement',
  FILL_INPUT = 'fill',
  PRESS = 'press',
  EXTRACT = 'extract',
  BACK = 'back',
  FORWARD = 'forward',
  RELOAD = 'reload',
  REFRESH = 'refresh'
}

// Service endpoint URLs
export const SERVICE_BASE_URL = 'http://localhost:8003';
export const ENDPOINTS = {
  RUN_AGENT: '/run-agent',
  TASK_STATUS: '/task',
  LOGIN: '/login',
  HEALTH: '/health',
  // Add direct browser endpoints
  BROWSER_CREATE: '/browser/create',
  BROWSER_NAVIGATE: (sessionId: string) => `/browser/${sessionId}/navigate`,
  BROWSER_ACTION: (sessionId: string) => `/browser/${sessionId}/action`,
  BROWSER_SCREENSHOT: (sessionId: string) => `/browser/${sessionId}/screenshot`,
  BROWSER_FORM_ELEMENTS: (sessionId: string) => `/browser/${sessionId}/form_elements`,
  BROWSER_REFRESH: (sessionId: string) => `/browser/${sessionId}/refresh`
};

export interface BrowserServiceResponse {
  success: boolean;
  title?: string;
  content?: string;
  url?: string;
  screenshot?: string;
  formElements?: any[];
  clickableElements?: any[];
  historyState?: {
    canGoBack: boolean;
    canGoForward: boolean;
    currentIndex: number;
    length: number;
  }
} 