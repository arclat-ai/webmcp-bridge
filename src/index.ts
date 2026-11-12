/**
 * WebMCP Bridge
 * Bridge between browser-native WebMCP and Model Context Protocol (MCP)
 */

export { VERSION } from './version.js';

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
export {
  ValidationError,
  type ValidationLimits,
  DEFAULT_VALIDATION_LIMITS,
  DISALLOWED_URL_SCHEMES,
  ToolNameSchema,
  ToolArgumentsSchema,
  validatePayloadBounds,
  validateToolCall,
  validateTargetUrl,
  formatAndValidateToolResult,
  sanitizeWebMCPTool,
  sanitizeDiscoveredTools,
} from './validation.js';

