#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './index.js';
import { startMcpServer } from './server.js';
import { runDiscover } from './discover.js';

const USAGE_TEXT = `webmcp-bridge v${VERSION}
Bridge between browser-native WebMCP and Model Context Protocol (MCP)

Usage:
  webmcp-bridge connect <url>      Start stdio MCP server for a WebMCP web page
  webmcp-bridge discover <url>     Discover and inspect WebMCP tools exposed by a page
  webmcp-bridge --help, -h         Show help and usage information
  webmcp-bridge --version, -v      Show version number

Examples:
  webmcp-bridge connect http://localhost:3000
  webmcp-bridge connect ./test/fixture.html
  webmcp-bridge discover http://localhost:3000
  webmcp-bridge discover ./test/fixture.html

Claude Desktop Configuration:
  Add to your claude_desktop_config.json:
  {
    "mcpServers": {
      "my-webapp": {
        "command": "npx",
        "args": ["-y", "webmcp-bridge", "connect", "http://localhost:3000"]
      }
    }
  }
`;

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const firstArg = args[0];

  if (!firstArg || firstArg === '--help' || firstArg === '-h' || firstArg === 'help') {
    process.stdout.write(USAGE_TEXT);
    return;
  }

  if (firstArg === '--version' || firstArg === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (firstArg === 'connect') {
    const url = args[1];
    if (!url) {
      process.stderr.write(
        '[webmcp-bridge] Error: Missing URL for "connect" command.\n' +
        'Usage: webmcp-bridge connect <url>\n'
      );
      process.exit(1);
    }

    try {
      const running = await startMcpServer(url);

      let isCleaningUp = false;
      const cleanupAndExit = async () => {
        if (isCleaningUp) return;
        isCleaningUp = true;
        try {
          await running.close();
        } catch {
          // Ignore errors during exit cleanup
        }
        process.exit(0);
      };

      process.stdin.on('close', cleanupAndExit);
      process.stdin.on('end', cleanupAndExit);
    } catch (err: any) {
      const message = err?.message || String(err);
      if (
        message.includes("Executable doesn't exist") ||
        message.includes('playwright install') ||
        message.includes('browserType.launch') ||
        message.includes('Failed to launch') ||
        message.includes('spawn')
      ) {
        process.stderr.write(
          `[webmcp-bridge] Error: Chromium browser could not be launched.\n` +
          `Please ensure Chrome 146+ or Playwright Chromium is installed:\n` +
          `  npx playwright install chromium\n` +
          `Or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a Chrome/Chromium 146+ executable.\n`
        );
      } else {
        process.stderr.write(`[webmcp-bridge] Error: Failed to load target URL "${url}": ${message}\n`);
      }
      process.exit(1);
    }
    return;
  }

  if (firstArg === 'discover') {
    const url = args[1];
    if (!url) {
      process.stderr.write(
        '[webmcp-bridge] Error: Missing URL for "discover" command.\n' +
        'Usage: webmcp-bridge discover <url>\n'
      );
      process.exit(1);
    }
    await runDiscover(args.slice(1));
    return;
  }

  // Unknown command
  process.stderr.write(
    `[webmcp-bridge] Error: Unknown command "${firstArg}".\n` +
    'Run "webmcp-bridge --help" for available commands.\n'
  );
  process.exit(1);
}

// Execute directly if this file is the entry point
const isDirectExecution = () => {
  if (!process.argv[1]) return false;
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const realArgv1 = fs.realpathSync(process.argv[1]);
    const realCurrentFile = fs.realpathSync(currentFile);
    return path.resolve(realArgv1).toLowerCase() === path.resolve(realCurrentFile).toLowerCase();
  } catch {
    return (
      path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
      path.resolve(process.argv[1]).toLowerCase()
    );
  }
};

if (isDirectExecution()) {
  runCli().catch((err) => {
    process.stderr.write(`[webmcp-bridge] Fatal error: ${err?.message || err}\n`);
    process.exit(1);
  });
}
