import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { getInjectedBridgeScript } from '../src/bridge-injected.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, 'fixture.html');
const fixtureUrl = pathToFileURL(fixturePath).href;

/**
 * Resolves an existing Chromium or chrome-headless-shell executable from Playwright cache.
 */
export function findChromiumExecutable(): string | undefined {
  try {
    const stdPath = chromium.executablePath();
    if (fs.existsSync(stdPath)) {
      return stdPath;
    }
  } catch {
    // Ignore error and search cache directories
  }

  const localAppData = process.env.LOCALAPPDATA;
  const userProfile = process.env.USERPROFILE || process.env.HOME;
  const candidateDirs = [
    localAppData ? path.join(localAppData, 'ms-playwright') : null,
    userProfile ? path.join(userProfile, 'AppData', 'Local', 'ms-playwright') : null,
    userProfile ? path.join(userProfile, '.cache', 'ms-playwright') : null,
    userProfile ? path.join(userProfile, 'Library', 'Caches', 'ms-playwright') : null,
  ].filter(Boolean) as string[];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const sortedFolders = entries
        .filter(e => e.isDirectory() && (e.name.startsWith('chromium-') || e.name.startsWith('chromium_headless_shell-')))
        .map(e => e.name)
        .sort()
        .reverse();

      for (const folder of sortedFolders) {
        const fullFolder = path.join(dir, folder);
        const subpaths = [
          path.join(fullFolder, 'chrome-win64', 'chrome.exe'),
          path.join(fullFolder, 'chrome-win', 'chrome.exe'),
          path.join(fullFolder, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
          path.join(fullFolder, 'chrome-headless-shell-win', 'chrome-headless-shell.exe'),
          path.join(fullFolder, 'chrome-linux', 'chrome'),
          path.join(fullFolder, 'chrome-linux', 'headless_shell'),
          path.join(fullFolder, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        ];
        for (const candidate of subpaths) {
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // Continue to next directory
    }
  }

  return undefined;
}

describe('WebMCP Test Fixture & Injected Bridge Runtime', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  before(async () => {
    const executablePath = findChromiumExecutable();
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--enable-features=WebMCP', '--enable-blink-features=WebMCP'],
    });

    context = await browser.newContext();
    // Inject bridge script before page scripts run
    await context.addInitScript(getInjectedBridgeScript());
    page = await context.newPage();
    await page.goto(fixtureUrl);
    // Wait for the fixture initialization to complete
    await page.waitForFunction(() => {
      const el = document.getElementById('status');
      return el && el.textContent && el.textContent.includes('successfully');
    });
  });

  after(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('verifies fixture file exists on disk', () => {
    assert.strictEqual(fs.existsSync(fixturePath), true);
  });

  it('exposes window.__webmcp_bridge__ with isSupported returning true', async () => {
    const isSupported = await page.evaluate(() => {
      return window.__webmcp_bridge__?.isSupported();
    });
    assert.strictEqual(isSupported, true);
  });

  it('discovers registered tools via getTools() with correct schemas', async () => {
    const tools = await page.evaluate(async () => {
      return await window.__webmcp_bridge__?.getTools();
    });

    assert.ok(Array.isArray(tools), 'getTools() should return an array');
    assert.strictEqual(tools.length, 2, 'Should have exactly 2 registered tools');

    // 1. get_time tool verification
    const getTime = tools.find((t: any) => t.name === 'get_time');
    assert.ok(getTime, 'get_time tool must be registered');
    assert.strictEqual(
      getTime.description,
      'Returns the current server/page time in ISO format and timezone'
    );
    assert.strictEqual(getTime.inputSchema.type, 'object');
    assert.ok(getTime.inputSchema.properties.timezone);
    assert.strictEqual(getTime.inputSchema.properties.timezone.type, 'string');

    // 2. search_items tool verification
    const searchItems = tools.find((t: any) => t.name === 'search_items');
    assert.ok(searchItems, 'search_items tool must be registered');
    assert.strictEqual(
      searchItems.description,
      'Searches an in-page mock inventory by query string'
    );
    assert.strictEqual(searchItems.inputSchema.type, 'object');
    assert.ok(searchItems.inputSchema.properties.query);
    assert.strictEqual(searchItems.inputSchema.properties.query.type, 'string');
    assert.ok(searchItems.inputSchema.properties.limit);
    assert.strictEqual(searchItems.inputSchema.properties.limit.type, 'number');
    assert.deepStrictEqual(searchItems.inputSchema.required, ['query']);
  });

  it('calls get_time tool and receives valid ISO timestamp and timezone info', async () => {
    const result: any = await page.evaluate(async () => {
      return await window.__webmcp_bridge__?.callTool('get_time', {});
    });

    assert.ok(result, 'Result should be defined');
    assert.ok(result.iso, 'Result should have iso property');
    assert.strictEqual(typeof result.iso, 'string');
    // Ensure valid ISO date format
    assert.strictEqual(new Date(result.iso).toISOString(), result.iso);
    assert.strictEqual(result.requestedTimezone, 'default');
    assert.ok(result.localeString, 'Result should have localeString');

    // Call with specific timezone
    const resultWithTz: any = await page.evaluate(async () => {
      return await window.__webmcp_bridge__?.callTool('get_time', { timezone: 'America/New_York' });
    });
    assert.strictEqual(resultWithTz.requestedTimezone, 'America/New_York');
  });

  it('calls search_items tool with query="Hardware" and returns matching items', async () => {
    const result: any = await page.evaluate(async () => {
      return await window.__webmcp_bridge__?.callTool('search_items', { query: 'Hardware' });
    });

    assert.ok(result, 'Result should be defined');
    assert.strictEqual(result.query, 'Hardware');
    assert.strictEqual(result.count, 2);
    assert.ok(Array.isArray(result.results));
    assert.strictEqual(result.results.length, 2);

    const titles = result.results.map((i: any) => i.title);
    assert.ok(titles.includes('Mechanical Keyboard'));
    assert.ok(titles.includes('4K Monitor'));

    for (const item of result.results) {
      assert.strictEqual(item.category, 'Hardware');
    }
  });

  it('calls search_items tool with limit and returns bounded results', async () => {
    const result: any = await page.evaluate(async () => {
      return await window.__webmcp_bridge__?.callTool('search_items', { query: '', limit: 1 });
    });

    assert.ok(result);
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.results.length, 1);
  });

  it('throws a clean error when calling a non-existent tool', async () => {
    await assert.rejects(
      async () => {
        await page.evaluate(async () => {
          return await window.__webmcp_bridge__?.callTool('non_existent_tool', {});
        });
      },
      (err: Error) => {
        assert.ok(
          err.message.includes('not found') || err.message.includes('non_existent_tool'),
          `Unexpected error message: ${err.message}`
        );
        return true;
      }
    );
  });

  it('shows diagnostic UI on fixture page when bridge is not injected and WebMCP is absent', async () => {
    // Open fixture without bridge injection in a fresh context
    const rawContext = await browser.newContext();
    const rawPage = await rawContext.newPage();
    try {
      await rawPage.goto(fixtureUrl);
      const statusText = await rawPage.textContent('#status');
      // If browser doesn't natively support WebMCP, the diagnostic warning must appear
      const hasNative = await rawPage.evaluate(() => 'modelContext' in navigator && !!navigator.modelContext?.registerTool);
      if (!hasNative) {
        assert.ok(
          statusText?.includes('WebMCP (navigator.modelContext) is not available') ||
          statusText?.includes('Chrome 146+'),
          `Expected diagnostic text but got: ${statusText}`
        );
      }
    } finally {
      await rawContext.close();
    }
  });
});
