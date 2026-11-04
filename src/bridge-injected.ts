/**
 * Injected Bridge Runtime for WebMCP
 *
 * Injected into the target browser page context before or during page load.
 * Bridges browser-native WebMCP (navigator.modelContext) and MCP agents.
 */

export interface WebMCPToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  execute?: (args: any) => Promise<any> | any;
}

export interface DiscoveredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface WebMCPBridge {
  isSupported(): boolean;
  isNativeSupported(): boolean;
  getTools(): Promise<DiscoveredTool[]>;
  callTool(name: string, input?: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    __webmcp_bridge__?: WebMCPBridge;
  }
}

/**
 * Returns the JavaScript source code string that injects window.__webmcp_bridge__
 * into the browser context. This script should be injected via page.addInitScript().
 */
export function getInjectedBridgeScript(): string {
  return `(function() {
  if (window.__webmcp_bridge__) return;

  const registry = new Map();
  const hasNativeModelContext = typeof navigator !== 'undefined' && 'modelContext' in navigator;
  const hasNativeModelContextTesting = typeof navigator !== 'undefined' && 'modelContextTesting' in navigator;

  if (typeof navigator !== 'undefined') {
    if (!('modelContext' in navigator)) {
      const mc = {
        async registerTool(toolDef) {
          if (!toolDef || typeof toolDef !== 'object' || !toolDef.name) {
            throw new Error('WebMCP registerTool requires a tool definition with a name.');
          }
          registry.set(toolDef.name, toolDef);
        }
      };
      try {
        navigator.modelContext = mc;
      } catch (e) {
        Object.defineProperty(navigator, 'modelContext', {
          value: mc,
          writable: true,
          configurable: true
        });
      }
    } else if (navigator.modelContext && typeof navigator.modelContext.registerTool === 'function') {
      const nativeRegisterTool = navigator.modelContext.registerTool.bind(navigator.modelContext);
      navigator.modelContext.registerTool = async function(toolDef, options) {
        if (toolDef && toolDef.name) {
          registry.set(toolDef.name, toolDef);
        }
        return await nativeRegisterTool(toolDef, options);
      };
    }
  }

  window.__webmcp_bridge__ = {
    isSupported() {
      return true;
    },
    isNativeSupported() {
      return Boolean(hasNativeModelContext || hasNativeModelContextTesting);
    },
    async getTools() {
      // If native modelContextTesting is present, attempt discovery first
      if (typeof navigator !== 'undefined' && navigator.modelContextTesting && typeof navigator.modelContextTesting.getTools === 'function') {
        try {
          const nativeTools = await navigator.modelContextTesting.getTools();
          if (Array.isArray(nativeTools) && nativeTools.length > 0) {
            return nativeTools.map(t => ({
              name: t.name,
              description: t.description || '',
              inputSchema: t.inputSchema || { type: 'object', properties: {} }
            }));
          }
        } catch (e) {
          // Fall back to internal registry if native getTools fails
        }
      }

      return Array.from(registry.values()).map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} }
      }));
    },
    async callTool(name, input) {
      // Check native modelContextTesting first if available
      if (typeof navigator !== 'undefined' && navigator.modelContextTesting && typeof navigator.modelContextTesting.executeTool === 'function') {
        try {
          return await navigator.modelContextTesting.executeTool(name, input);
        } catch (err) {
          if (!registry.has(name)) {
            throw err;
          }
        }
      }

      const tool = registry.get(name);
      if (!tool) {
        throw new Error('Tool "' + name + '" not found in registered WebMCP tools');
      }
      if (typeof tool.execute !== 'function') {
        throw new Error('Tool "' + name + '" has no execute handler function');
      }

      return await tool.execute(input);
    }
  };
})();`;
}
