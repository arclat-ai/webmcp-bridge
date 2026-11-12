import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  ValidationError,
  validateToolCall,
  validatePayloadBounds,
  validateTargetUrl,
  formatAndValidateToolResult,
  sanitizeWebMCPTool,
  sanitizeDiscoveredTools,
  DEFAULT_VALIDATION_LIMITS,
} from '../src/validation.js';
import { mapWebMCPToMCPTool } from '../src/schema-mapper.js';
import { startMcpServer } from '../src/server.js';
import { BrowserBridge } from '../src/browser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, 'fixture.html');

describe('Input Validation & Security Hardening (GHSA-mrhx-c7xc-m3w5)', () => {
  describe('Zod 4 Collection Bounds & Advisory Regression', () => {
    it('rejects oversized constrained collections early with single issue (no memory exhaustion)', () => {
      const schema = z.array(z.string().email()).max(5);
      const largeArray = new Array(100000).fill('not-an-email');

      const start = performance.now();
      const res = schema.safeParse(largeArray);
      const duration = performance.now() - start;

      assert.strictEqual(res.success, false);
      assert.ok(res.error);
      // In patched Zod (v4.6.6+), bounds are checked before element parsing, producing 1 too_big issue
      assert.strictEqual(res.error.issues.length, 1);
      assert.strictEqual(res.error.issues[0].code, 'too_big');
      // Should execute in under 100ms rather than spending seconds allocating 100k issue objects
      assert.ok(duration < 200, `Expected fast parse, took ${duration}ms`);
    });

    it('validates permitted collections with element validation', () => {
      const schema = z.array(z.string()).max(10);
      const validArray = ['a', 'b', 'c'];
      const res = schema.safeParse(validArray);
      assert.strictEqual(res.success, true);
      assert.deepStrictEqual(res.data, ['a', 'b', 'c']);
    });
  });

  describe('Normal Valid Inputs', () => {
    it('accepts standard tool call with valid name and arguments', () => {
      const result = validateToolCall('search_items', { query: 'laptop', limit: 10 });
      assert.strictEqual(result.name, 'search_items');
      assert.deepStrictEqual(result.args, { query: 'laptop', limit: 10 });
    });

    it('accepts valid nested objects and arrays within bounds', () => {
      const args = {
        filter: {
          categories: ['electronics', 'hardware'],
          priceRange: { min: 10, max: 100 },
        },
        pagination: { page: 1, perPage: 25 },
      };
      const result = validateToolCall('filter_items', args);
      assert.deepStrictEqual(result.args, args);
    });
  });

  describe('Empty Collections', () => {
    it('accepts empty object arguments', () => {
      const result = validateToolCall('get_time', {});
      assert.strictEqual(result.name, 'get_time');
      assert.deepStrictEqual(result.args, {});
    });

    it('accepts undefined/null arguments defaulting to empty object', () => {
      const resultUndefined = validateToolCall('get_time', undefined);
      assert.deepStrictEqual(resultUndefined.args, {});

      const resultNull = validateToolCall('get_time', null);
      assert.deepStrictEqual(resultNull.args, {});
    });

    it('accepts object containing empty array and empty nested object', () => {
      const args = { items: [], metadata: {}, tags: [] };
      const result = validateToolCall('empty_collections', args);
      assert.deepStrictEqual(result.args, args);
    });
  });

  describe('Large but Permitted Collections', () => {
    it('accepts arrays up to maximum collection size (e.g. 1,000 items)', () => {
      const allowedArray = new Array(1000).fill('test-item');
      assert.doesNotThrow(() => {
        validateToolCall('bulk_process', { items: allowedArray });
      });
    });

    it('accepts objects up to maximum collection size (e.g. 500 keys)', () => {
      const allowedObj: Record<string, number> = {};
      for (let i = 0; i < 500; i++) {
        allowedObj[`key_${i}`] = i;
      }
      assert.doesNotThrow(() => {
        validateToolCall('bulk_object', allowedObj);
      });
    });
  });

  describe('Oversized Collections', () => {
    it('rejects arrays exceeding maximum collection size', () => {
      const oversizedArray = new Array(2500).fill('item');
      assert.throws(
        () => {
          validateToolCall('oversized_tool', { items: oversizedArray });
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('exceeds maximum permitted collection size'));
          return true;
        }
      );
    });

    it('rejects objects exceeding maximum key count', () => {
      const oversizedObj: Record<string, string> = {};
      for (let i = 0; i < 2500; i++) {
        oversizedObj[`prop_${i}`] = 'val';
      }
      assert.throws(
        () => {
          validateToolCall('oversized_obj_tool', oversizedObj);
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('exceeds maximum permitted collection size'));
          return true;
        }
      );
    });

    it('rejects payloads with total nodes exceeding threshold', () => {
      // 15 arrays of 800 items = 12,000 nodes > 10,000 maxTotalNodes
      const largePayload: Record<string, string[]> = {};
      for (let i = 0; i < 15; i++) {
        largePayload[`arr_${i}`] = new Array(800).fill('x');
      }
      assert.throws(
        () => {
          validateToolCall('total_nodes_tool', largePayload);
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('exceeds maximum permitted nodes'));
          return true;
        }
      );
    });
  });

  describe('Malformed & Pathological Nested Objects', () => {
    it('rejects objects exceeding maximum nesting depth (recursion protection)', () => {
      // Build 40 levels deep object
      let deep: any = { leaf: 'value' };
      for (let i = 0; i < 40; i++) {
        deep = { child: deep };
      }

      assert.throws(
        () => {
          validateToolCall('deep_nesting', deep);
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('exceeds maximum nesting depth'));
          return true;
        }
      );
    });

    it('rejects circular structures gracefully without crashing or infinite recursion', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      assert.throws(
        () => {
          validatePayloadBounds(circular);
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('Circular structure detected'));
          return true;
        }
      );
    });

    it('rejects functions in payloads', () => {
      const payload = {
        action: 'test',
        callback: () => console.log('bad'),
      };
      assert.throws(
        () => {
          validatePayloadBounds(payload);
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('Functions are not permitted'));
          return true;
        }
      );
    });

    it('rejects strings exceeding maximum string length', () => {
      const hugeString = 'a'.repeat(2 * 1024 * 1024); // 2 MB
      assert.throws(
        () => {
          validatePayloadBounds({ big: hugeString });
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('String length exceeds maximum'));
          return true;
        }
      );
    });
  });

  describe('Invalid WebMCP Tool Arguments & Names', () => {
    it('rejects primitive arguments (non-object)', () => {
      for (const invalid of ['string-arg', 123, true, [1, 2, 3]]) {
        assert.throws(
          () => {
            validateToolCall('test_tool', invalid);
          },
          (err: Error) => {
            assert.ok(err instanceof ValidationError);
            assert.ok(err.message.includes('Invalid tool arguments'));
            return true;
          }
        );
      }
    });

    it('rejects empty, whitespace, or invalid tool names', () => {
      for (const invalidName of ['', '   ', null, undefined, 42, {}]) {
        assert.throws(
          () => {
            validateToolCall(invalidName as any, {});
          },
          (err: Error) => {
            assert.ok(err instanceof ValidationError);
            assert.ok(err.message.includes('Invalid tool name'));
            return true;
          }
        );
      }
    });

    it('rejects tool names exceeding 256 characters', () => {
      const longName = 'tool_'.repeat(60); // 300 chars
      assert.throws(
        () => {
          validateToolCall(longName, {});
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('Tool name exceeds maximum length'));
          return true;
        }
      );
    });
  });

  describe('WebMCP Tool Discovery Sanitization', () => {
    it('bounds oversized tool properties and descriptions from untrusted pages', () => {
      const oversizedProperties: Record<string, any> = {};
      for (let i = 0; i < 500; i++) {
        oversizedProperties[`prop_${i}`] = { type: 'string' };
      }

      const rawTool = {
        name: 'a'.repeat(500),
        description: 'd'.repeat(10000),
        inputSchema: {
          type: 'object',
          properties: oversizedProperties,
          required: new Array(300).fill('required_prop'),
        },
      };

      const sanitized = sanitizeWebMCPTool(rawTool);
      assert.strictEqual(sanitized.name.length, DEFAULT_VALIDATION_LIMITS.maxToolNameLength);
      assert.strictEqual(sanitized.description.length, DEFAULT_VALIDATION_LIMITS.maxToolDescriptionLength);
      assert.ok(Object.keys(sanitized.inputSchema.properties as object).length <= DEFAULT_VALIDATION_LIMITS.maxSchemaProperties);
      assert.ok((sanitized.inputSchema.required as string[]).length <= DEFAULT_VALIDATION_LIMITS.maxSchemaRequired);

      // Maps cleanly to MCP Tool without error
      const mcpTool = mapWebMCPToMCPTool(sanitized);
      assert.doesNotThrow(() => ToolSchema.parse(mcpTool));
    });

    it('bounds total discovered tools to maxDiscoveredTools limit', () => {
      const manyTools = new Array(500).fill(null).map((_, i) => ({
        name: `tool_${i}`,
        description: `Description ${i}`,
        inputSchema: { type: 'object', properties: {} },
      }));

      const sanitized = sanitizeDiscoveredTools(manyTools);
      assert.strictEqual(sanitized.length, DEFAULT_VALIDATION_LIMITS.maxDiscoveredTools);
    });
  });

  describe('MCP Request Handling & Graceful Error Handling', () => {
    it('handles oversized arguments gracefully over MCP transport without crashing server', async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      const { close } = await startMcpServer(fixturePath, {
        transport: serverTransport,
      });

      const client = new Client(
        { name: 'test-validation-client', version: '0.1.0' },
        { capabilities: {} }
      );

      try {
        await client.connect(clientTransport);

        // 1. Legitimate call still succeeds
        const legitResult: any = await client.callTool({
          name: 'get_time',
          arguments: {},
        });
        assert.strictEqual(legitResult.isError, undefined);
        assert.ok(legitResult.content[0].text.includes('iso'));

        // 2. Oversized array argument -> returns isError without crashing server
        const oversizedResult: any = await client.callTool({
          name: 'search_items',
          arguments: {
            query: 'test',
            items: new Array(3000).fill('oversized'),
          },
        });

        assert.strictEqual(oversizedResult.isError, true);
        assert.ok(
          oversizedResult.content[0].text.includes('exceeds maximum permitted collection size'),
          `Expected collection size error, got: ${oversizedResult.content[0].text}`
        );

        // 3. Deeply nested argument -> returns isError without crashing server
        let deepObj: any = { val: 1 };
        for (let i = 0; i < 40; i++) {
          deepObj = { nested: deepObj };
        }

        const deepResult: any = await client.callTool({
          name: 'search_items',
          arguments: deepObj,
        });

        assert.strictEqual(deepResult.isError, true);
        assert.ok(
          deepResult.content[0].text.includes('exceeds maximum nesting depth'),
          `Expected depth error, got: ${deepResult.content[0].text}`
        );

        // 4. Server is still fully operational after failed validation calls
        const followUpResult: any = await client.callTool({
          name: 'search_items',
          arguments: { query: 'Hardware' },
        });
        assert.strictEqual(followUpResult.isError, undefined);
        assert.ok(followUpResult.content[0].text.includes('Hardware'));
      } finally {
        await client.close();
        await close();
      }
    });

    it('handles oversized tool execution output gracefully without crashing', async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      const { bridge, close } = await startMcpServer(fixturePath, {
        transport: serverTransport,
      });

      const client = new Client(
        { name: 'test-oversized-output-client', version: '0.1.0' },
        { capabilities: {} }
      );

      try {
        await client.connect(clientTransport);

        const page = bridge.getPage();
        assert.ok(page);

        // Register a tool that returns a massive payload exceeding 5MB
        await page.evaluate(`(async () => {
          const mc = navigator.modelContext || document.modelContext;
          await mc.registerTool({
            name: 'massive_output_tool',
            description: 'Returns oversized output',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => 'x'.repeat(6 * 1024 * 1024), // 6 MB
          });
        })()`);

        const res: any = await client.callTool({
          name: 'massive_output_tool',
          arguments: {},
        });

        assert.strictEqual(res.isError, true);
        assert.ok(
          res.content[0].text.includes('exceeds maximum permitted size'),
          `Expected output size error, got: ${res.content[0].text}`
        );
      } finally {
        await client.close();
        await close();
      }
    });
  });

  describe('URL Scheme Security & Validation', () => {
    it('rejects dangerous javascript: and vbscript: URL schemes', () => {
      for (const dangerous of [
        'javascript:alert(1)',
        'JAVASCRIPT:alert(1)',
        'vbscript:msgbox',
        'chrome://settings',
        'edge://flags',
        'devtools://devtools/bundled/inspector.html',
        'view-source:http://example.com',
      ]) {
        assert.throws(
          () => {
            validateTargetUrl(dangerous);
          },
          (err: Error) => {
            assert.ok(err instanceof ValidationError);
            assert.ok(err.message.includes('Disallowed URL scheme'));
            return true;
          }
        );
      }
    });

    it('rejects empty target URLs', () => {
      for (const empty of ['', '   ']) {
        assert.throws(
          () => {
            validateTargetUrl(empty);
          },
          (err: Error) => {
            assert.ok(err instanceof ValidationError);
            assert.ok(err.message.includes('Target URL cannot be empty'));
            return true;
          }
        );
      }
    });

    it('accepts valid http, https, file, and local relative/absolute paths', () => {
      assert.strictEqual(validateTargetUrl('https://example.com'), 'https://example.com');
      assert.strictEqual(validateTargetUrl('http://localhost:3000'), 'http://localhost:3000');
      assert.strictEqual(validateTargetUrl('file:///path/to/fixture.html'), 'file:///path/to/fixture.html');
      assert.strictEqual(validateTargetUrl('./test/fixture.html'), './test/fixture.html');
    });
  });

  describe('Tool Output Serialization & Bounds', () => {
    it('formats normal string or object outputs cleanly', () => {
      assert.strictEqual(formatAndValidateToolResult('hello world'), 'hello world');
      assert.strictEqual(
        formatAndValidateToolResult({ count: 1 }),
        JSON.stringify({ count: 1 }, null, 2)
      );
    });

    it('throws ValidationError when output exceeds specified maximum size', () => {
      assert.throws(
        () => {
          formatAndValidateToolResult('a'.repeat(200), 100);
        },
        (err: Error) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.message.includes('exceeds maximum permitted size'));
          return true;
        }
      );
    });
  });
});
