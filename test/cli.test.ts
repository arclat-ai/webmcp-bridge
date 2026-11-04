import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const fixturePath = path.resolve(__dirname, 'fixture.html');

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function getCliCommand(): { command: string; args: string[] } {
  const distCli = path.resolve(rootDir, 'dist/cli.js');
  if (fs.existsSync(distCli)) {
    return { command: process.execPath, args: [distCli] };
  }
  const tsxCli = path.resolve(rootDir, 'node_modules/tsx/dist/cli.mjs');
  const srcCli = path.resolve(rootDir, 'src/cli.ts');
  return { command: process.execPath, args: [tsxCli, srcCli] };
}

function runCliProcess(args: string[]): Promise<ExecResult> {
  const { command, args: baseArgs } = getCliCommand();
  const child = spawn(command, [...baseArgs, ...args], {
    cwd: rootDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe('CLI Integration: webmcp-bridge', () => {
  it('--help prints usage information containing "connect" and "discover"', async () => {
    const result = await runCliProcess(['--help']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('connect'), 'stdout should explain connect command');
    assert.ok(result.stdout.includes('discover'), 'stdout should explain discover command');
    assert.ok(result.stdout.includes('webmcp-bridge'), 'stdout should include binary name');

    // Also verify -h flag
    const shortResult = await runCliProcess(['-h']);
    assert.strictEqual(shortResult.code, 0);
    assert.ok(shortResult.stdout.includes('connect'));
  });

  it('--version prints "0.1.0"', async () => {
    const result = await runCliProcess(['--version']);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout.trim(), '0.1.0');

    // Also verify -v flag
    const shortResult = await runCliProcess(['-v']);
    assert.strictEqual(shortResult.code, 0);
    assert.strictEqual(shortResult.stdout.trim(), '0.1.0');
  });

  it('connect without arguments exits with code 1 and writes error to stderr', async () => {
    const result = await runCliProcess(['connect']);
    assert.strictEqual(result.code, 1);
    assert.ok(
      result.stderr.includes('Missing URL') || result.stderr.includes('Usage:'),
      `stderr should explain missing URL: ${result.stderr}`
    );
    assert.strictEqual(result.stdout.trim(), '', 'stdout must remain clean for MCP stdio');
  });

  it('discover test/fixture.html outputs JSON containing get_time and search_items', async () => {
    const result = await runCliProcess(['discover', 'test/fixture.html']);
    assert.strictEqual(result.code, 0);

    let parsed: any;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      assert.fail(`discover stdout is not valid JSON:\n${result.stdout}`);
    }

    assert.ok(Array.isArray(parsed), 'Output should be JSON array of tools');
    const toolNames = parsed.map((t: any) => t.name);
    assert.ok(toolNames.includes('get_time'), 'discovered tools should contain get_time');
    assert.ok(toolNames.includes('search_items'), 'discovered tools should contain search_items');
  });

  it('connect test/fixture.html starts stdio MCP server, receives JSON-RPC tools/list request over stdin, and responds with valid JSON-RPC tools/list result over stdout', async () => {
    const { command, args: baseArgs } = getCliCommand();
    const child = spawn(command, [...baseArgs, 'connect', fixturePath], {
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutData = '';
    let responseReceived: any = null;

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      assert.fail('Timed out waiting for tools/list response from MCP server');
    }, 20000);

    const onData = (chunk: Buffer) => {
      stdoutData += chunk.toString();
      const lines = stdoutData.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.id === 101 && parsed.result?.tools) {
            responseReceived = parsed;
            // Finish stdin to allow server to cleanly exit
            child.stdin.end();
            break;
          }
        } catch {
          // not complete JSON yet
        }
      }
    };

    child.stdout.on('data', onData);

    // Send JSON-RPC tools/list request over stdin
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/list',
    }) + '\n';

    child.stdin.write(request);

    // Wait for child process exit
    await once(child, 'exit');
    clearTimeout(timeout);

    assert.ok(responseReceived, 'Should have received valid JSON-RPC response for id 101');
    assert.strictEqual(responseReceived.jsonrpc, '2.0');
    assert.strictEqual(responseReceived.id, 101);
    assert.ok(Array.isArray(responseReceived.result.tools), 'Result tools should be an array');

    const toolNames = responseReceived.result.tools.map((t: any) => t.name);
    assert.ok(toolNames.includes('get_time'), 'tools/list should include get_time');
    assert.ok(toolNames.includes('search_items'), 'tools/list should include search_items');
  });

  it('handles unknown commands with clean error to stderr and code 1', async () => {
    const result = await runCliProcess(['unknown_command']);
    assert.strictEqual(result.code, 1);
    assert.ok(
      result.stderr.includes('Unknown command') || result.stderr.includes('Usage:'),
      `stderr should mention unknown command: ${result.stderr}`
    );
  });

  it('connect with invalid / nonexistent file exits with code 1 and writes error to stderr', async () => {
    const result = await runCliProcess(['connect', 'nonexistent_file_path_12345.html']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.length > 0, 'stderr should have error message');
    assert.strictEqual(result.stdout.trim(), '', 'stdout must be clean');
  });

  it('imports library entry points (src/index.js and dist/index.js) without circular TDZ ReferenceError', async () => {
    // Dynamic import to test ESM module evaluation
    const srcIndex = await import('../src/index.js');
    assert.strictEqual(srcIndex.VERSION, '0.1.0');
    assert.strictEqual(typeof srcIndex.runCli, 'function');
    assert.strictEqual(typeof srcIndex.startMcpServer, 'function');
    assert.strictEqual(typeof srcIndex.runDiscover, 'function');

    const distIndexPath = path.resolve(rootDir, 'dist/index.js');
    if (fs.existsSync(distIndexPath)) {
      const { pathToFileURL } = await import('node:url');
      const distIndex = await import(pathToFileURL(distIndexPath).href);
      assert.strictEqual(distIndex.VERSION, '0.1.0');
      assert.strictEqual(typeof distIndex.runCli, 'function');
      assert.strictEqual(typeof distIndex.startMcpServer, 'function');
      assert.strictEqual(typeof distIndex.runDiscover, 'function');
    }
  });
});
