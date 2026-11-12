import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { getInjectedBridgeScript, type DiscoveredTool } from './bridge-injected.js';
import { findChromiumExecutable } from './browser-utils.js';
import { validateToolCall, validateTargetUrl } from './validation.js';

/**
 * Resolves a URL or local file path into an absolute file:// or http(s):// URL.
 */
export function resolveTargetUrl(target: string): string {
  const validated = validateTargetUrl(target);
  if (
    validated.startsWith('http://') ||
    validated.startsWith('https://') ||
    validated.startsWith('file://') ||
    validated.startsWith('about:') ||
    validated.startsWith('data:')
  ) {
    return validated;
  }
  const resolved = path.resolve(validated);
  return pathToFileURL(resolved).href;
}

export interface BrowserOpenOptions {
  timeout?: number;
  waitRegistrationMs?: number;
  noSandbox?: boolean;
}

export class BrowserBridge {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  /**
   * Returns the current active Page instance, or null if not open.
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Opens Chromium in headless mode, injects the WebMCP bridge runtime,
   * navigates to targetUrl, and waits for tool registration.
   */
  async open(targetUrl: string, options?: BrowserOpenOptions): Promise<void> {
    if (this.browser) {
      await this.close();
    }

    try {
      const executablePath = findChromiumExecutable();

      const enableNoSandbox =
        options?.noSandbox ??
        (process.env.WEBMCP_NO_SANDBOX === '1');

      const launchArgs = [
        '--enable-features=WebMCP',
        '--enable-blink-features=WebMCP',
        '--allow-file-access-from-files',
      ];

      if (enableNoSandbox) {
        launchArgs.push('--no-sandbox');
      }

      this.browser = await chromium.launch({
        headless: true,
        executablePath,
        args: launchArgs,
      });

      this.context = await this.browser.newContext();

      // Inject bridge script before page scripts run
      await this.context.addInitScript({ content: getInjectedBridgeScript() });

      this.page = await this.context.newPage();

      // Pipe console messages to stderr to keep stdout pristine for JSON communication
      this.page.on('console', (msg) => {
        process.stderr.write(`[page console] [${msg.type()}] ${msg.text()}\n`);
      });

      this.page.on('pageerror', (err) => {
        process.stderr.write(`[page error] ${err.message || err}\n`);
      });

      const resolvedUrl = resolveTargetUrl(targetUrl);
      await this.page.goto(resolvedUrl, {
        waitUntil: 'load',
        timeout: options?.timeout ?? 30000,
      });

      // Wait a brief tick for async tool registrations
      const waitMs = options?.waitRegistrationMs ?? 500;
      if (waitMs > 0) {
        await this.page.waitForTimeout(waitMs);
      }

      const nativeSupported = await this.isNativeSupported();
      if (!nativeSupported) {
        process.stderr.write(
          '[webmcp-bridge] Note: Native WebMCP is not active in this Chromium build. DevTrial flag required: chrome://flags/#enable-webmcp-testing or launch flag --enable-features=WebMCP (Chrome 146+). Injected polyfill active.\n'
        );
      }
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  /**
   * Checks if native WebMCP is supported in the current page context.
   */
  async isNativeSupported(): Promise<boolean> {
    if (!this.page) {
      return false;
    }
    return await this.page.evaluate(() => {
      return Boolean(window.__webmcp_bridge__?.isNativeSupported());
    });
  }

  /**
   * Discovers all registered WebMCP tools from the page.
   */
  async discoverTools(): Promise<DiscoveredTool[]> {
    if (!this.page) {
      throw new Error('Browser is not open. Call open() before discovering tools.');
    }
    return await this.page.evaluate(async () => {
      if (!window.__webmcp_bridge__) {
        throw new Error('WebMCP bridge is not initialized in the page context.');
      }
      return await window.__webmcp_bridge__.getTools();
    });
  }

  /**
   * Invokes a registered WebMCP tool in the browser page context.
   */
  async callTool(name: string, input?: unknown): Promise<unknown> {
    if (!this.page) {
      throw new Error('Browser is not open. Call open() before calling a tool.');
    }
    const { name: validName, args: validArgs } = validateToolCall(name, input);
    try {
      return await this.page.evaluate(
        async ({ toolName, toolInput }) => {
          if (!window.__webmcp_bridge__) {
            throw new Error('WebMCP bridge is not initialized in the page context.');
          }
          return await window.__webmcp_bridge__.callTool(toolName, toolInput);
        },
        { toolName: validName, toolInput: validArgs }
      );
    } catch (err) {
      const msg = (err as Error).message || String(err);
      const cleanMsg = msg.replace(/^page\.evaluate:\s*(?:Error:\s*)?/, '').split('\n')[0];
      throw new Error(cleanMsg || msg, { cause: err });
    }
  }

  /**
   * Closes browser context and browser cleanly.
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.page = null;
  }
}
