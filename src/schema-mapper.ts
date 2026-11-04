import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DiscoveredTool } from './bridge-injected.js';

/**
 * Maps a WebMCP tool definition discovered from the browser page into
 * an MCP Tool definition compliant with the MCP specification.
 */
export function mapWebMCPToMCPTool(tool: DiscoveredTool): Tool {
  const name = tool?.name ? String(tool.name) : 'unnamed_tool';

  let inputSchema: Tool['inputSchema'] = {
    type: 'object',
    properties: {},
  };

  if (
    tool?.inputSchema &&
    typeof tool.inputSchema === 'object' &&
    !Array.isArray(tool.inputSchema)
  ) {
    const rawSchema = tool.inputSchema as Record<string, unknown>;
    const rawProperties = rawSchema.properties;

    const properties: Record<string, object> = {};
    if (
      rawProperties &&
      typeof rawProperties === 'object' &&
      !Array.isArray(rawProperties)
    ) {
      for (const [key, val] of Object.entries(rawProperties as Record<string, unknown>)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          properties[key] = val as object;
        } else {
          properties[key] = {};
        }
      }
    }

    inputSchema = {
      ...rawSchema,
      type: 'object',
      properties,
    };

    if (Array.isArray(rawSchema.required)) {
      inputSchema.required = rawSchema.required.filter(
        (item): item is string => typeof item === 'string'
      );
    }
  }

  const mcpTool: Tool = {
    name,
    inputSchema,
  };

  if (tool?.description !== undefined && tool?.description !== null) {
    mcpTool.description = String(tool.description);
  } else {
    mcpTool.description = '';
  }

  return mcpTool;
}
