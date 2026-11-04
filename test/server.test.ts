import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { mapWebMCPToMCPTool } from '../src/schema-mapper.js';
import { createMcpServer, startMcpServer } from '../src/server.js';
import { BrowserBridge } from '../src/browser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, 'fixture.html');

describe('Schema Mapper: mapWebMCPToMCPTool', () => {
  it('maps a valid WebMCP tool definition to an MCP Tool schema', () => {
    const webMcpTool = {
      name: 'search_items',
      description: 'Searches an in-page inventory',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max items' },
        },
        required: ['query'],
      },
    };

    const mcpTool = mapWebMCPToMCPTool(webMcpTool);

    assert.strictEqual(mcpTool.name, 'search_items');
    assert.strictEqual(mcpTool.description, 'Searches an in-page inventory');
    assert.strictEqual(mcpTool.inputSchema.type, 'object');
    assert.deepStrictEqual(mcpTool.inputSchema.properties, {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max items' },
    });
    assert.deepStrictEqual(mcpTool.inputSchema.required, ['query']);

    // Validates against official MCP ToolSchema
    const validated = ToolSchema.parse(mcpTool);
    assert.strictEqual(validated.name, 'search_items');
  });

  it('handles empty or missing schema with fallback to default object schema', () => {
    const toolWithNoSchema: any = {
      name: 'empty_schema_tool',
      description: 'Tool without schema',
      inputSchema: undefined,
    };

    const mcpTool = mapWebMCPToMCPTool(toolWithNoSchema);

    assert.strictEqual(mcpTool.name, 'empty_schema_tool');
    assert.strictEqual(mcpTool.description, 'Tool without schema');
    assert.deepStrictEqual(mcpTool.inputSchema, {
      type: 'object',
      properties: {},
    });

    const validated = ToolSchema.parse(mcpTool);
    assert.strictEqual(validated.name, 'empty_schema_tool');
  });

  it('handles non-object inputSchema with fallback to default object schema', () => {
    const invalidSchemas: any[] = [null, 'invalid', 42, true, [1, 2, 3]];

    for (const schema of invalidSchemas) {
      const tool: any = {
        name: 'non_object_schema_tool',
        description: 'Tool with non-object schema',
        inputSchema: schema,
      };

      const mcpTool = mapWebMCPToMCPTool(tool);
      assert.deepStrictEqual(mcpTool.inputSchema, {
        type: 'object',
        properties: {},
      });
      assert.doesNotThrow(() => ToolSchema.parse(mcpTool));
    }
  });

  it('handles missing or non-object properties with fallback to empty properties object', () => {
    const toolWithNoProperties: any = {
      name: 'no_props_tool',
      description: 'Tool without properties field',
      inputSchema: {
        type: 'object',
      },
    };

    const mcpTool = mapWebMCPToMCPTool(toolWithNoProperties);
    assert.strictEqual(mcpTool.inputSchema.type, 'object');
    assert.deepStrictEqual(mcpTool.inputSchema.properties, {});
    assert.doesNotThrow(() => ToolSchema.parse(mcpTool));

    const toolWithInvalidProperties: any = {
      name: 'invalid_props_tool',
      description: 'Tool with string properties field',
      inputSchema: {
        type: 'object',
        properties: 'not-an-object',
      },
    };

    const mcpTool2 = mapWebMCPToMCPTool(toolWithInvalidProperties);
    assert.strictEqual(mcpTool2.inputSchema.type, 'object');
    assert.deepStrictEqual(mcpTool2.inputSchema.properties, {});
    assert.doesNotThrow(() => ToolSchema.parse(mcpTool2));
  });

  it('handles undefined description by defaulting to empty string or omitting it', () => {
    const toolWithoutDesc: any = {
      name: 'no_desc_tool',
      inputSchema: { type: 'object', properties: {} },
    };

    const mcpTool = mapWebMCPToMCPTool(toolWithoutDesc);
    assert.strictEqual(mcpTool.name, 'no_desc_tool');
    assert.ok(mcpTool.description === undefined || mcpTool.description === '');
    assert.doesNotThrow(() => ToolSchema.parse(mcpTool));
  });
});

describe('MCP Server Integration with WebMCP Browser Bridge', () => {
  it('creates an MCP Server with tools capability', () => {
    const bridge = new BrowserBridge();
    const server = createMcpServer(bridge);
    assert.ok(server, 'Server should be instantiated');
  });

  it('serves tools and tool calls over InMemoryTransport', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const { server, bridge, close } = await startMcpServer(fixturePath, {
      transport: serverTransport,
    });

    const client = new Client(
      { name: 'test-client', version: '0.1.0' },
      { capabilities: {} }
    );

    try {
      await client.connect(clientTransport);

      // 1. List tools
      const toolsResult = await client.listTools();
      assert.ok(Array.isArray(toolsResult.tools), 'tools should be an array');
      assert.ok(toolsResult.tools.length >= 2, 'Should discover at least 2 tools');

      const toolNames = toolsResult.tools.map((t) => t.name);
      assert.ok(toolNames.includes('get_time'), 'tools should include get_time');
      assert.ok(toolNames.includes('search_items'), 'tools should include search_items');

      const getTimeTool = toolsResult.tools.find((t) => t.name === 'get_time')!;
      assert.strictEqual(getTimeTool.inputSchema.type, 'object');
      assert.ok(getTimeTool.inputSchema.properties);

      const searchTool = toolsResult.tools.find((t) => t.name === 'search_items')!;
      assert.strictEqual(searchTool.inputSchema.type, 'object');
      assert.ok(searchTool.inputSchema.properties);
      assert.ok(searchTool.inputSchema.properties.query);

      // 2. Call get_time tool
      const getTimeResult: any = await client.callTool({
        name: 'get_time',
        arguments: {},
      });

      assert.ok(getTimeResult.content, 'Result should have content');
      assert.strictEqual(getTimeResult.content.length, 1);
      assert.strictEqual(getTimeResult.content[0].type, 'text');
      const timeParsed = JSON.parse(getTimeResult.content[0].text);
      assert.ok(timeParsed.iso, 'Result JSON should include iso time');
      assert.strictEqual(new Date(timeParsed.iso).toISOString(), timeParsed.iso);

      // 3. Call search_items tool with query="Hardware"
      const searchResult: any = await client.callTool({
        name: 'search_items',
        arguments: { query: 'Hardware' },
      });

      assert.ok(searchResult.content, 'Result should have content');
      assert.strictEqual(searchResult.content[0].type, 'text');
      const searchParsed = JSON.parse(searchResult.content[0].text);
      assert.strictEqual(searchParsed.query, 'Hardware');
      assert.strictEqual(searchParsed.count, 2);
      assert.strictEqual(searchParsed.results.length, 2);
      for (const item of searchParsed.results) {
        assert.strictEqual(item.category, 'Hardware');
      }

      // 4. Call nonexistent_tool
      const errorResult: any = await client.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      });

      assert.strictEqual(errorResult.isError, true, 'isError flag must be true');
      assert.ok(Array.isArray(errorResult.content), 'Content should be an array');
      assert.strictEqual(errorResult.content[0].type, 'text');
      assert.ok(
        errorResult.content[0].text.includes('Error executing tool "nonexistent_tool"'),
        `Expected error text to mention tool name, got: ${errorResult.content[0].text}`
      );

      // 5. Dynamic re-registration: inject a new tool into page via page.evaluate
      const page = bridge.getPage();
      assert.ok(page, 'Bridge page should be available');

      await page.evaluate(`(async () => {
        const mc = navigator.modelContext || document.modelContext;
        await mc.registerTool({
          name: 'dynamically_added_tool',
          description: 'A tool dynamically registered after page load',
          inputSchema: {
            type: 'object',
            properties: {
              echo: { type: 'string' },
            },
            required: ['echo'],
          },
          execute: async (params) => {
            return { echoed: params && params.echo };
          },
        });
      })()`);

      // Subsequent listTools discovers the new tool without server restart
      const updatedToolsResult = await client.listTools();
      const updatedToolNames = updatedToolsResult.tools.map((t) => t.name);
      assert.ok(
        updatedToolNames.includes('dynamically_added_tool'),
        'Updated tool list should contain dynamically_added_tool'
      );

      // And we can call the newly registered tool
      const dynamicCallResult: any = await client.callTool({
        name: 'dynamically_added_tool',
        arguments: { echo: 'hello dynamic tool' },
      });
      assert.strictEqual(dynamicCallResult.isError, undefined);
      const dynamicParsed = JSON.parse(dynamicCallResult.content[0].text);
      assert.strictEqual(dynamicParsed.echoed, 'hello dynamic tool');
    } finally {
      // 6. Close client and server, assert browser closes cleanly
      await client.close();
      await close();
      assert.strictEqual(bridge.getPage(), null, 'Bridge page should be null after close');
    }
  });

  it('formats tool string return value directly as text content', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const { bridge, close } = await startMcpServer(fixturePath, {
      transport: serverTransport,
    });

    const client = new Client(
      { name: 'test-client-str', version: '0.1.0' },
      { capabilities: {} }
    );

    try {
      await client.connect(clientTransport);

      const page = bridge.getPage();
      assert.ok(page);
      await page.evaluate(`(async () => {
        const mc = navigator.modelContext || document.modelContext;
        await mc.registerTool({
          name: 'get_raw_text',
          description: 'Returns plain text',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => 'raw string output',
        });
      })()`);

      const res: any = await client.callTool({ name: 'get_raw_text', arguments: {} });
      assert.strictEqual(res.isError, undefined);
      assert.strictEqual(res.content[0].type, 'text');
      assert.strictEqual(res.content[0].text, 'raw string output');
    } finally {
      await client.close();
      await close();
    }
  });

  it('fails gracefully and cleans up when opening an invalid target file', async () => {
    await assert.rejects(
      async () => {
        await startMcpServer('nonexistent_fixture_path.html');
      },
      (err: any) => {
        assert.ok(err.message.includes('ERR_FILE_NOT_FOUND') || err.message.includes('net::ERR'));
        return true;
      }
    );
  });
});
