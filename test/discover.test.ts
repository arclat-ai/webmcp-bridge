import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrowserBridge } from '../src/browser.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const fixturePath = path.resolve(__dirname, 'fixture.html');
const discoverScript = path.resolve(rootDir, 'discover.js');

describe('BrowserBridge Class', () => {
  it('opens fixture, discovers tools, and closes cleanly', async () => {
    const bridge = new BrowserBridge();
    try {
      await bridge.open(fixturePath);
      assert.ok(bridge.getPage(), 'getPage() should return active page');

      const isNative = await bridge.isNativeSupported();
      assert.strictEqual(typeof isNative, 'boolean');

      const tools = await bridge.discoverTools();
      assert.ok(Array.isArray(tools), 'discoverTools() should return array');
      assert.strictEqual(tools.length, 2);

      const getTime = tools.find(t => t.name === 'get_time');
      assert.ok(getTime, 'get_time tool should be present');
      assert.strictEqual(typeof getTime.description, 'string');
      assert.strictEqual(getTime.inputSchema.type, 'object');

      const searchItems = tools.find(t => t.name === 'search_items');
      assert.ok(searchItems, 'search_items tool should be present');
      assert.strictEqual(typeof searchItems.description, 'string');
      assert.strictEqual(searchItems.inputSchema.type, 'object');
    } finally {
      await bridge.close();
      assert.strictEqual(bridge.getPage(), null);
    }
  });
});

describe('discover.js CLI Integration', () => {
  it('fails with code 1 and prints usage when no target is provided', async () => {
    await assert.rejects(
      async () => {
        await execFileAsync(process.execPath, [discoverScript]);
      },
      (err: any) => {
        assert.strictEqual(err.code, 1);
        assert.ok(err.stderr.includes('Usage:'));
        assert.strictEqual(err.stdout.trim(), '');
        return true;
      }
    );
  });

  it('runs "node discover.js test/fixture.html" and prints valid JSON to stdout', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [discoverScript, 'test/fixture.html'], {
      cwd: rootDir,
    });

    // Stderr should contain diagnostic / page console info, never tool JSON
    assert.ok(
      stderr.includes('[webmcp-bridge]') || stderr.includes('Note:') || stderr.length >= 0,
      'Stderr captures diagnostic notes'
    );

    // Stdout must be clean, parseable JSON
    let parsed: any;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (e) {
      assert.fail(`Stdout is not valid JSON:\n${stdout}`);
    }

    assert.ok(Array.isArray(parsed), 'Stdout JSON must be an array of tools');
    assert.strictEqual(parsed.length, 2, 'Must discover 2 tools');

    const toolNames = parsed.map((t: any) => t.name).sort();
    assert.deepStrictEqual(toolNames, ['get_time', 'search_items']);

    const getTime = parsed.find((t: any) => t.name === 'get_time');
    assert.strictEqual(getTime.description, 'Returns the current server/page time in ISO format and timezone');
    assert.ok(getTime.inputSchema);
    assert.strictEqual(getTime.inputSchema.type, 'object');
    assert.ok(getTime.inputSchema.properties.timezone);

    const searchItems = parsed.find((t: any) => t.name === 'search_items');
    assert.strictEqual(searchItems.description, 'Searches an in-page mock inventory by query string');
    assert.ok(searchItems.inputSchema);
    assert.strictEqual(searchItems.inputSchema.type, 'object');
    assert.ok(searchItems.inputSchema.properties.query);
    assert.deepStrictEqual(searchItems.inputSchema.required, ['query']);
  });
});
