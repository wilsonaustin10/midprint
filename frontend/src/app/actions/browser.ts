'use server'

import { chromium, Page } from 'playwright';
import { BrowserPool, getBrowserPool } from '@/lib/browser-pool';
import { DEFAULT_FALLBACK_TIMEOUT, DEFAULT_NETWORK_IDLE_TIMEOUT, defaultLogPrefix } from './constants';
import { formatUrl } from '@/lib/utils';
import { getBrowserHistory } from './browser-history';
import { BrowserActions } from '../api/computer-use/actions';
import { PageInfo } from '@/types/prompts';
import { extractInteractiveElements } from '../api/processing/getProcessedText';

const SCREENSHOT_QUALITY = 100;
const SCREENSHOT_TYPE = 'jpeg';
const IS_SCREENSHOT_FULL_PAGE = true;

export type ActionResult = PageInfo & {
  success: boolean;
}

export async function navigateTo(url: string, sessionId: string): Promise<ActionResult> {
  try {
    const browserPool = await getBrowserPool();
    const { page } = await browserPool.getBrowser(sessionId);
    const formattedUrl = formatUrl(url)
    console.log(`[navigateTo] Before navigation - Current URL: ${await page.url()}`);
    console.log(`[navigateTo] Attempting to navigate to: ${formattedUrl}`);
    
    await page.goto(formattedUrl, {
      waitUntil: "load"
    });
    
    console.log(`[navigateTo] After navigation - Current URL: ${await page.url()}`);
    
    await waitForPageStability(page, {
      logPrefix: `${sessionId}`
    })

    await browserPool.updateBrowserState(sessionId);
    
    const screenshot = await page.screenshot({
      type: SCREENSHOT_TYPE,
      quality: SCREENSHOT_QUALITY,
      fullPage: IS_SCREENSHOT_FULL_PAGE
    });
    const content = await safeGetPageContent(page, `${sessionId}`)
    const title = await page.title();

    const {formElements, clickableElements} = await extractInteractiveElements(content);

    const historyState = await getBrowserHistory(page);

    return {
      success: true,
      screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
      content,
      url: page.url(),
      title,
      formElements,
      clickableElements,
      historyState
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
    const browserPool = await getBrowserPool();
    const { page } = await browserPool.getBrowser(sessionId);
    const title = await page.title();
    const content = await safeGetPageContent(page, `${sessionId}`)

    // Extract form elements
    const {formElements, clickableElements} = await extractInteractiveElements(content);

    console.debug(`${sessionId}: Performing: ${action}`)

    switch (action) {
      case BrowserActions.MOUSE_CLICK:
        if (value) {
          const [x, y] = value.split(",").map(Number);
          console.debug(`Attempting mouse click event on x-y coordinates (${x}, ${y})`)
          if (!isNaN(x) && !isNaN(y)) {
            await page.mouse.move(x, y)
            await page.mouse.click(x, y)

            await waitForPageStability(page, { logPrefix: `${sessionId}` });
          }
        }
        break;
      case BrowserActions.CLICK_ELEMENT:
      case BrowserActions.CLICK:
        console.debug(`Attempting to click element with selector: ${selector}`);
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          await page.click(selector);
          await waitForPageStability(page, { logPrefix: `${sessionId}` });
        } catch (error) {
          console.error(`Failed to click element with selector ${selector}:`, error);
          throw error;
        }
        break;
      case BrowserActions.FILL_INPUT:
        if (value) {
          await page.fill(selector, value);
          await waitForPageStability(page, { logPrefix: `${sessionId}` });
        }
        break;
      case BrowserActions.PRESS:
        if (value) {
          if (selector) {
            await page.focus(selector)
          }
          await page.keyboard.press(value)  
          await waitForPageStability(page, { logPrefix: `${sessionId}` });
        }
        break;
      case BrowserActions.EXTRACT:
        const text = await page.textContent(selector);
        const screenshot = await page.screenshot({
          type: SCREENSHOT_TYPE,
          quality: SCREENSHOT_QUALITY,
          fullPage: IS_SCREENSHOT_FULL_PAGE
        });
        const historyState = await getBrowserHistory(page);
        return {
          success: true,
          title,
          content: content,
          screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
          url: page.url(),
          formElements,
          clickableElements,
          historyState
        };
      case BrowserActions.BACK:
        await page.goBack();
        await waitForPageStability(page, { logPrefix: `${sessionId}` });
        break;
      case BrowserActions.FORWARD:
        await page.goForward();
        await waitForPageStability(page, { logPrefix: `${sessionId}` });
        break;
      case BrowserActions.RELOAD:
        await page.reload();
        await waitForPageStability(page, { logPrefix: `${sessionId}` });
        break;
      case BrowserActions.REFRESH:
        await waitForPageStability(page, { logPrefix: `${sessionId}` });
        break;
      default:
        console.warn(`Unhandled function: ${action}`);
        throw new Error(`Unhandled action: ${action}`);
    }

    const screenshot = await page.screenshot({
      type: SCREENSHOT_TYPE,
      quality: SCREENSHOT_QUALITY,
      fullPage: IS_SCREENSHOT_FULL_PAGE
    });

    const historyState = await getBrowserHistory(page);

    return {
      success: true,
      title: title,
      screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
      content: content,
      url: page.url(),
      formElements,
      clickableElements,
      historyState
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


type PageStabilityOptions = {
  networkIdleTimeout?: number;
  fallbackTimeout?: number;
  logPrefix?: string;
}

async function waitForPageStability(page: Page, options: PageStabilityOptions) {
  const defaults: PageStabilityOptions = {
    networkIdleTimeout: DEFAULT_NETWORK_IDLE_TIMEOUT,
    fallbackTimeout: DEFAULT_FALLBACK_TIMEOUT,
    logPrefix: ''
  }
  const settings = {
    ...defaults,
    ...options
  }

  try {
    // Configure page to ignore certain errors
    await page.route('**/*', async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      
      // Allow main document and essential resources
      if (resourceType === 'document' || resourceType === 'xhr' || resourceType === 'fetch') {
        await route.continue();
        return;
      }

      // Block or ignore problematic resources
      if (resourceType === 'script' || resourceType === 'stylesheet') {
        const url = request.url();
        if (url.includes('openai.com/_next/static/chunks/')) {
          await route.abort();
          return;
        }
      }

      await route.continue();
    });

    // Wait for network idle with a timeout
    await page.waitForLoadState('networkidle', { timeout: settings.networkIdleTimeout });
  } catch (error) {
    console.warn(`${settings.logPrefix}: Network didn't reach idle state, continuing anyway`);
  }

  // Ensure we don't wait indefinitely
  await new Promise(resolve => setTimeout(resolve, 100));
}


/**
 * utility function to safely get page content because sometimes page content isn't available 
 * */ 
async function safeGetPageContent(page: Page, logPrefix = '') {
  try {
    return await page.content();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`${logPrefix}: Could not get page content: ${errorMessage}`);
    return '';
  }
}