#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserBridge } from './browser.js';

/**
 * Runs tool discovery or tool invocation against a target URL or HTML file.
 */
export async function runDiscover(args: string[] = process.argv.slice(2)): Promise<void> {
  const callIndex = args.indexOf('--call');
  const isCall = callIndex !== -1;
  let toolName: string | undefined;
  let jsonArgs: string | undefined;
  let targetUrl: string | undefined;

  if (isCall) {
    if (callIndex === args.length - 1) {
      process.stderr.write('Error: --call requires a tool name.\n');
      process.exit(1);
    }
    toolName = args[callIndex + 1];
    if (!toolName || toolName.startsWith('--')) {
      process.stderr.write('Error: --call requires a tool name.\n');
      process.exit(1);
    }

    const beforeCall = args.slice(0, callIndex);
    const afterCall = args.slice(callIndex + 2);

    if (beforeCall.length > 0) {
      targetUrl = beforeCall[0];
      jsonArgs = afterCall[0] ?? (beforeCall.length > 1 ? beforeCall[1] : undefined);
    } else {
      if (afterCall.length === 0) {
        targetUrl = undefined;
      } else if (afterCall.length === 1) {
        targetUrl = afterCall[0];
      } else {
        jsonArgs = afterCall[0];
        targetUrl = afterCall[1];
      }
    }
  } else {
    targetUrl = args[0];
  }

  if (!targetUrl) {
    process.stderr.write('Usage: node discover.js <target-url-or-file> [--call <toolName> [jsonArgs]]\n');
    process.stderr.write('Error: Target URL or HTML file path is required.\n');
    process.exit(1);
  }

  let callArgs: unknown = {};
  if (isCall && jsonArgs !== undefined) {
    try {
      callArgs = JSON.parse(jsonArgs);
    } catch (jsonErr) {
      process.stderr.write(`[webmcp-bridge] Invalid JSON arguments: ${(jsonErr as Error).message}\n`);
      process.exit(1);
    }
  }

  const bridge = new BrowserBridge();
  let exitCode = 0;
  try {
    await bridge.open(targetUrl);
    if (isCall && toolName) {
      const result = await bridge.callTool(toolName, callArgs);
      if (typeof result === 'object' && result !== null) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result);
      }
    } else {
      const tools = await bridge.discoverTools();
      console.log(JSON.stringify(tools, null, 2));
    }
  } catch (err) {
    const action = isCall ? 'Tool invocation' : 'Discovery';
    process.stderr.write(`[webmcp-bridge] ${action} failed: ${(err as Error).message}\n`);
    exitCode = 1;
  } finally {
    await bridge.close();
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

// Execute directly if this file is the entry point
const isDirectExecution = process.argv[1] && (
  path.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
);
if (isDirectExecution) {
  runDiscover().catch((err) => {
    process.stderr.write(`[webmcp-bridge] Fatal error: ${err}\n`);
    process.exit(1);
  });
}
