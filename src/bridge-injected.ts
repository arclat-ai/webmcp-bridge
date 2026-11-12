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
  'use strict';
  if (window.__webmcp_bridge__) return;

  const registry = new Map();
  const hasNativeModelContext = (typeof navigator !== 'undefined' && 'modelContext' in navigator) ||
    (typeof document !== 'undefined' && 'modelContext' in document);
  const hasNativeModelContextTesting = typeof navigator !== 'undefined' && 'modelContextTesting' in navigator;

  const hookTarget = function(obj, prop) {
    if (!obj) return;
    if (!obj[prop] || typeof obj[prop].registerTool !== 'function') {
      const mc = {
        async registerTool(toolDef) {
          if (!toolDef || typeof toolDef !== 'object' || typeof toolDef.name !== 'string' || !toolDef.name.trim()) {
            throw new Error('WebMCP registerTool requires a tool definition with a non-empty string name.');
          }
          if (toolDef.name.length > 256) {
            throw new Error('WebMCP registerTool: tool name exceeds maximum length of 256 characters.');
          }
          registry.set(toolDef.name, toolDef);
        }
      };
      try {
        obj[prop] = mc;
      } catch (e) {
        Object.defineProperty(obj, prop, {
          value: mc,
          writable: true,
          configurable: true
        });
      }
    } else if (obj[prop] && typeof obj[prop].registerTool === 'function') {
      const nativeRegisterTool = obj[prop].registerTool.bind(obj[prop]);
      const patchedRegisterTool = async function(toolDef, options) {
        if (toolDef && typeof toolDef.name === 'string' && toolDef.name.trim() && toolDef.name.length <= 256) {
          registry.set(toolDef.name, toolDef);
        }
        return await nativeRegisterTool(toolDef, options);
      };
      try {
        obj[prop].registerTool = patchedRegisterTool;
      } catch (e) {
        try {
          Object.defineProperty(obj[prop], 'registerTool', {
            value: patchedRegisterTool,
            writable: true,
            configurable: true
          });
        } catch (err2) {
          try {
            const proto = Object.getPrototypeOf(obj[prop]);
            if (proto) {
              Object.defineProperty(proto, 'registerTool', {
                value: patchedRegisterTool,
                writable: true,
                configurable: true
              });
            }
          } catch (err3) {}
        }
      }
    }
  };

  if (typeof navigator !== 'undefined') hookTarget(navigator, 'modelContext');
  if (typeof document !== 'undefined') hookTarget(document, 'modelContext');

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
      // If tool is in our registry with an execute function, execute it directly in page context
      const registeredTool = registry.get(name);
      if (registeredTool && typeof registeredTool.execute === 'function') {
        return await registeredTool.execute(input);
      }

      // Check native modelContextTesting if tool was not in local registry
      if (typeof navigator !== 'undefined' && navigator.modelContextTesting && typeof navigator.modelContextTesting.executeTool === 'function') {
        return await navigator.modelContextTesting.executeTool(name, input);
      }

      if (!registeredTool) {
        throw new Error('Tool "' + name + '" not found in registered WebMCP tools');
      }
      throw new Error('Tool "' + name + '" has no execute handler function');
    }
  };
})();`;
}
