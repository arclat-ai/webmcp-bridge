import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DiscoveredTool } from './bridge-injected.js';
import { sanitizeWebMCPTool } from './validation.js';

/**
 * Maps a WebMCP tool definition discovered from the browser page into
 * an MCP Tool definition compliant with the MCP specification,
 * enforcing bounds on tool name, description, and schema properties.
 */
export function mapWebMCPToMCPTool(tool: DiscoveredTool): Tool {
  const sanitized = sanitizeWebMCPTool(tool);

  const mcpTool: Tool = {
    name: sanitized.name,
    inputSchema: sanitized.inputSchema as Tool['inputSchema'],
  };

  if (sanitized.description !== undefined && sanitized.description !== null) {
    mcpTool.description = sanitized.description;
  } else {
    mcpTool.description = '';
  }

  return mcpTool;
}
