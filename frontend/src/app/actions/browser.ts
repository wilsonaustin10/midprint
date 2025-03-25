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

type ActionResult = PageInfo & {
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

    // const testurl = await page.url();
    // console.log(`Updating browser state for ${sessionId} with url ${testurl}`)
    await browserPool.updateBrowserState(sessionId);
    
    const screenshot = await page.screenshot({
      type: SCREENSHOT_TYPE,
      quality: SCREENSHOT_QUALITY,
      fullPage: IS_SCREENSHOT_FULL_PAGE
    });
    const content = await safeGetPageContent(page, `${sessionId}`)
    const title = await page.title();

    // Extract form elements
    // TODO: Figure out if including this is event helpful in the first place
    const {formElements, clickableElements} = await extractInteractiveElements(content);

    const historyState = await getBrowserHistory(page);

    return {
      success: true,
      screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
      content,  // Still send content for potential parsing
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
      error: error.message
    };
  }
}

export async function performAction(action: string, selector: string, value: string | undefined, sessionId: string): Promise<ActionResult> {
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
        await page.click(selector);
        // Wait for navigation or network idle
        // Use a more flexible waiting approach with timeout
        // Either wait for navigation or timeout after a reasonable period
        await waitForPageStability(page, { logPrefix: `${sessionId}` });
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
        // Take a screenshot after the action
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
          // Re-extract clickable elements
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
        // This is just a screenshot refresh without any page action
        // No need to do anything here, we'll just take a new screenshot below
        await waitForPageStability(page, { logPrefix: `${sessionId}` });
        break;

    }

    // Take a screenshot after the action
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
      error: error.message
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
    console.warn(`${logPrefix}: Could not get page content: ${error.message}`);
    return '';
  }
}