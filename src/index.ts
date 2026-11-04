/**
 * WebMCP Bridge
 * Bridge between browser-native WebMCP and Model Context Protocol (MCP)
 */

export const VERSION = '0.1.0';

export {
  getInjectedBridgeScript,
  type WebMCPToolDef,
  type DiscoveredTool,
  type WebMCPBridge,
} from './bridge-injected.js';

export { findChromiumExecutable } from './browser-utils.js';
export { BrowserBridge, resolveTargetUrl } from './browser.js';
export { mapWebMCPToMCPTool } from './schema-mapper.js';
export {
  createMcpServer,
  startMcpServer,
  type StartMcpServerOptions,
  type RunningMcpServer,
} from './server.js';
export { runDiscover } from './discover.js';
export { runCli } from './cli.js';

