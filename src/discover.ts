#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserBridge } from './browser.js';

/**
 * Runs tool discovery against a target URL or HTML file.
 */
export async function runDiscover(args: string[] = process.argv.slice(2)): Promise<void> {
  const targetUrl = args[0];
  if (!targetUrl) {
    process.stderr.write('Usage: node discover.js <target-url-or-file>\n');
    process.stderr.write('Error: Target URL or HTML file path is required.\n');
    process.exit(1);
  }

  const bridge = new BrowserBridge();
  try {
    await bridge.open(targetUrl);
    const tools = await bridge.discoverTools();
    console.log(JSON.stringify(tools, null, 2));
  } catch (err) {
    process.stderr.write(`[webmcp-bridge] Discovery failed: ${(err as Error).message}\n`);
    process.exit(1);
  } finally {
    await bridge.close();
  }
}

// Execute directly if this file is the entry point
const isDirectExecution = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);
if (isDirectExecution) {
  runDiscover().catch((err) => {
    process.stderr.write(`[webmcp-bridge] Fatal error: ${err}\n`);
    process.exit(1);
  });
}
