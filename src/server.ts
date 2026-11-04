import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { BrowserBridge } from './browser.js';
import { mapWebMCPToMCPTool } from './schema-mapper.js';

export interface StartMcpServerOptions {
  transport?: Transport;
  bridge?: BrowserBridge;
}

export interface RunningMcpServer {
  server: Server;
  bridge: BrowserBridge;
  close: () => Promise<void>;
}

/**
 * Creates and configures an MCP Server backed by the given BrowserBridge.
 * Dynamically queries the browser for registered WebMCP tools on listTools,
 * and routes callTool invocations directly into the browser page context.
 */
export function createMcpServer(bridge: BrowserBridge): Server {
  const server = new Server(
    { name: 'webmcp-bridge', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const discovered = await bridge.discoverTools();
    const tools = discovered.map(mapWebMCPToMCPTool);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await bridge.callTool(name, args ?? {});
      const text =
        typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2) ?? '';
      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
      };
    } catch (err: any) {
      const message = err?.message || String(err);
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Error executing tool "${name}": ${message}`,
          },
        ],
      };
    }
  });

  return server;
}

/**
 * Starts the MCP Server by opening the target URL in Chromium via BrowserBridge,
 * connecting to the MCP transport (StdioServerTransport by default), and
 * registering graceful termination signal handlers.
 */
export async function startMcpServer(
  targetUrl: string,
  options?: StartMcpServerOptions
): Promise<RunningMcpServer> {
  const bridge = options?.bridge ?? new BrowserBridge();

  try {
    await bridge.open(targetUrl);
  } catch (err) {
    await bridge.close();
    throw err;
  }

  const server = createMcpServer(bridge);
  const transport = options?.transport ?? new StdioServerTransport();

  let isClosed = false;
  const close = async () => {
    if (isClosed) return;
    isClosed = true;
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
    try {
      await server.close();
    } catch {
      // Ignore transport/server close errors during cleanup
    }
    try {
      await bridge.close();
    } catch {
      // Ignore browser bridge close errors during cleanup
    }
  };

  const handleSignal = async () => {
    await close();
    process.exit(0);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  try {
    await server.connect(transport);
  } catch (err) {
    await close();
    throw err;
  }

  return { server, bridge, close };
}
