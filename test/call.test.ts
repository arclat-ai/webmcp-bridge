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

describe('BrowserBridge callTool() Method', () => {
  it('throws an error if browser is not open', async () => {
    const bridge = new BrowserBridge();
    await assert.rejects(
      async () => {
        await bridge.callTool('get_time');
      },
      (err: Error) => {
        assert.ok(err.message.includes('Browser is not open') || err.message.includes('open()'));
        return true;
      }
    );
  });

  it('calls get_time and returns ISO timestamp object', async () => {
    const bridge = new BrowserBridge();
    try {
      await bridge.open(fixturePath);
      const result: any = await bridge.callTool('get_time');
      assert.ok(result, 'Result should be defined');
      assert.ok(result.iso, 'Result should have iso property');
      assert.strictEqual(typeof result.iso, 'string');
      assert.strictEqual(new Date(result.iso).toISOString(), result.iso);
      assert.strictEqual(result.requestedTimezone, 'default');
    } finally {
      await bridge.close();
    }
  });

  it('calls search_items with query and returns matching items', async () => {
    const bridge = new BrowserBridge();
    try {
      await bridge.open(fixturePath);
      const result: any = await bridge.callTool('search_items', { query: 'Hardware' });
      assert.ok(result, 'Result should be defined');
      assert.strictEqual(result.query, 'Hardware');
      assert.strictEqual(result.count, 2);
      assert.ok(Array.isArray(result.results));
      assert.strictEqual(result.results.length, 2);
      for (const item of result.results) {
        assert.strictEqual(item.category, 'Hardware');
      }
    } finally {
      await bridge.close();
    }
  });

  it('throws a clean error when calling an unknown tool', async () => {
    const bridge = new BrowserBridge();
    try {
      await bridge.open(fixturePath);
      await assert.rejects(
        async () => {
          await bridge.callTool('unknown_tool');
        },
        (err: Error) => {
          assert.ok(
            err.message.includes('not found') || err.message.includes('unknown_tool'),
            `Expected "not found" error, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      await bridge.close();
    }
  });
});

describe('discover.js CLI Tool Invocation (--call)', () => {
  it('calls search_items with query="test" and prints matching query results to stdout', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [discoverScript, 'test/fixture.html', '--call', 'search_items', '{"query":"test"}'],
      { cwd: rootDir }
    );

    assert.ok(
      stderr.includes('[webmcp-bridge]') || stderr.includes('[page console]'),
      'Diagnostics or logs go to stderr'
    );
    assert.ok(!stdout.includes('[page console]'), 'Stdout does not contain page console logs');

    const result = JSON.parse(stdout.trim());
    assert.strictEqual(result.query, 'test');
    assert.strictEqual(typeof result.count, 'number');
    assert.ok(Array.isArray(result.results));
  });

  it('calls search_items with query="Hardware" and returns Hardware items', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [discoverScript, 'test/fixture.html', '--call', 'search_items', '{"query":"Hardware"}'],
      { cwd: rootDir }
    );

    const result = JSON.parse(stdout.trim());
    assert.strictEqual(result.query, 'Hardware');
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.results.length, 2);
    for (const item of result.results) {
      assert.strictEqual(item.category, 'Hardware');
    }
  });

  it('calls get_time without jsonArgs and returns ISO timestamp object', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [discoverScript, 'test/fixture.html', '--call', 'get_time'],
      { cwd: rootDir }
    );

    const result = JSON.parse(stdout.trim());
    assert.ok(result.iso, 'Output should have iso timestamp');
    assert.strictEqual(new Date(result.iso).toISOString(), result.iso);
    assert.strictEqual(result.requestedTimezone, 'default');
  });

  it('supports --call before the target URL: node discover.js --call search_items \'{"query":"Hardware"}\' test/fixture.html', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [discoverScript, '--call', 'search_items', '{"query":"Hardware"}', 'test/fixture.html'],
      { cwd: rootDir }
    );

    const result = JSON.parse(stdout.trim());
    assert.strictEqual(result.query, 'Hardware');
    assert.strictEqual(result.count, 2);
  });

  it('supports --call before target URL with omitted jsonArgs: node discover.js --call get_time test/fixture.html', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [discoverScript, '--call', 'get_time', 'test/fixture.html'],
      { cwd: rootDir }
    );

    const result = JSON.parse(stdout.trim());
    assert.ok(result.iso);
  });

  it('returns exit code 1 with clean error on stderr when calling an unknown tool', async () => {
    await assert.rejects(
      async () => {
        await execFileAsync(
          process.execPath,
          [discoverScript, 'test/fixture.html', '--call', 'non_existent_tool'],
          { cwd: rootDir }
        );
      },
      (err: any) => {
        assert.strictEqual(err.code, 1);
        assert.ok(
          err.stderr.includes('not found') || err.stderr.includes('non_existent_tool'),
          `Stderr should mention tool error, got: ${err.stderr}`
        );
        assert.strictEqual(err.stdout.trim(), '', 'Stdout should be empty on failure');
        return true;
      }
    );
  });

  it('returns exit code 1 with clean error on stderr when passing malformed JSON arguments', async () => {
    await assert.rejects(
      async () => {
        await execFileAsync(
          process.execPath,
          [discoverScript, 'test/fixture.html', '--call', 'search_items', '{invalid-json'],
          { cwd: rootDir }
        );
      },
      (err: any) => {
        assert.strictEqual(err.code, 1);
        assert.ok(
          err.stderr.includes('JSON') || err.stderr.includes('Invalid'),
          `Stderr should mention JSON error, got: ${err.stderr}`
        );
        assert.strictEqual(err.stdout.trim(), '', 'Stdout should be empty on failure');
        return true;
      }
    );
  });

  it('returns exit code 1 with clean error on stderr when --call is provided without a tool name', async () => {
    await assert.rejects(
      async () => {
        await execFileAsync(
          process.execPath,
          [discoverScript, 'test/fixture.html', '--call'],
          { cwd: rootDir }
        );
      },
      (err: any) => {
        assert.strictEqual(err.code, 1);
        assert.ok(
          err.stderr.includes('--call') || err.stderr.includes('tool name'),
          `Stderr should mention missing tool name, got: ${err.stderr}`
        );
        assert.strictEqual(err.stdout.trim(), '');
        return true;
      }
    );
  });
});
