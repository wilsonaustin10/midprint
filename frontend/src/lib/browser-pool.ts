import { Message } from '@/types/messages';
import { chromium, Browser, Page } from 'playwright-core';

/**
 * Note: We MUST use this global pattern. A simples singleton pattern like `let browserPool;` will NOT work
 */
declare global {
  // eslint-disable-next-line no-var
  var browserPool: BrowserPool | undefined;
}

/**
 * Returns a singleton instance of the BrowserPool
 * @returns A singleton instance of the BrowserPool
 */
export async function getBrowserPool() {
  if (!global.browserPool) {
    console.log(`[getBrowserPool] Creating new BrowserPool instance`);
    global.browserPool = new BrowserPool();
  }
  return global.browserPool;
}

export class BrowserPool {
  private browsers: Map<string, { browser: Browser, logs: Message[], page: Page, lastUsed: number }> = new Map();
  private maxInstances: number;

  constructor(maxInstances = 10) {
    this.maxInstances = maxInstances;
  }

  /**
   * Gets a browser instance with the specified sessionId if it exists, otherwise creates a new one
   * @param id 
   * @returns 
   */
  async getBrowser(id: string): Promise<{ browser: Browser, page: Page, logs: Message[] }> {
    // Check if browser exists
    const existing = this.browsers.get(id);
    if (existing) {
      console.log(`[BrowserPool] Retrieving existing browser for id ${id}, current URL: ${await existing.page.url()}`);
      
      existing.lastUsed = Date.now();
      return { browser: existing.browser, page: existing.page, logs: existing.logs };
    }
    console.log(`[BrowserPool] Creating new browser for id ${id}`);
    
    // Clean up if needed
    if (this.browsers.size >= this.maxInstances) {
      await this.cleanup(true);
    }

    // Create new browser
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
        '--disable-blink-features=AutomationControlled', // particularly important as it prevents websites from detecting that the browser is being controlled programmatically.
        '--no-sandbox',
        '--window-size=1280,800',

      ]
    });

    // Options are important o bypass security and bot filters
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      hasTouch: false,
      javaScriptEnabled: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { longitude: -73.935242, latitude: 40.730610 }, // New York
      permissions: ['geolocation'],
      colorScheme: 'light',
      httpCredentials: undefined,
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    this.browsers.set(id, { browser, logs: [], page, lastUsed: Date.now() });
    return { browser, page, logs: [] };
  }

  async releaseBrowser(id: string) {
    const instance = this.browsers.get(id);
    if (instance) {
      await instance.browser.close();
      this.browsers.delete(id);
    }
  }

  /**
   * Updates the browser state for the specified sessionId. Playwright automatically updates the state internally, so no need to re-assign
   * @param id 
   * @param logs 
   * @returns 
   */
  async updateBrowserState(id: string, logs?: Message[]): Promise<void> {
    const existing = this.browsers.get(id);
    if (!existing) {
      console.error(`Browser for id ${id} not found`);
      return;
    }
    existing.lastUsed = Date.now();
    console.log(`[updateBrowserState] Updating browser state for id ${id}, current URL: ${await existing.page.url()}`);
    if (logs) {
      existing.logs = logs;
    }
    this.browsers.set(id, existing);
  }

  private async cleanup(force = false) {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [id, { browser, lastUsed }] of this.browsers.entries()) {
      if (force || now - lastUsed > maxAge) {
        await browser.close();
        this.browsers.delete(id);
        if (!force) break;
      }
    }
  }
} 