import { z } from 'zod';
import type { DiscoveredTool } from './bridge-injected.js';

/**
 * Validation error thrown when external inputs violate security bounds or schema rules.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Configurable limits for input validation and memory exhaustion protection.
 */
export interface ValidationLimits {
  /** Maximum nesting depth for objects and arrays (prevents recursion/stack exhaustion) */
  maxDepth?: number;
  /** Maximum number of elements in a single array or keys in a single object */
  maxCollectionSize?: number;
  /** Maximum total count of elements and keys across the entire payload */
  maxTotalNodes?: number;
  /** Maximum allowed length for any single string value in bytes/chars */
  maxStringLength?: number;
  /** Maximum length for tool names */
  maxToolNameLength?: number;
  /** Maximum length for tool descriptions */
  maxToolDescriptionLength?: number;
  /** Maximum number of discovered tools allowed from a browser page */
  maxDiscoveredTools?: number;
  /** Maximum number of schema properties allowed per tool */
  maxSchemaProperties?: number;
  /** Maximum number of required fields in a tool schema */
  maxSchemaRequired?: number;
  /** Maximum length for serialized tool execution output */
  maxToolOutputLength?: number;
}

export const DEFAULT_VALIDATION_LIMITS: Required<ValidationLimits> = {
  maxDepth: 32,
  maxCollectionSize: 2000,
  maxTotalNodes: 10000,
  maxStringLength: 1024 * 1024, // 1 MB
  maxToolNameLength: 256,
  maxToolDescriptionLength: 4096,
  maxDiscoveredTools: 250,
  maxSchemaProperties: 200,
  maxSchemaRequired: 100,
  maxToolOutputLength: 5 * 1024 * 1024, // 5 MB
};

/**
 * Disallowed URL schemes that present code execution or security risks.
 */
export const DISALLOWED_URL_SCHEMES = [
  'javascript:',
  'vbscript:',
  'chrome:',
  'edge:',
  'devtools:',
  'view-source:',
];

/**
 * Validates a target URL or file path, rejecting dangerous schemes.
 */
export function validateTargetUrl(target: string): string {
  if (typeof target !== 'string' || !target.trim()) {
    throw new ValidationError('Target URL cannot be empty');
  }

  const trimmed = target.trim();
  const lower = trimmed.toLowerCase();

  for (const scheme of DISALLOWED_URL_SCHEMES) {
    if (lower.startsWith(scheme)) {
      throw new ValidationError(
        `Disallowed URL scheme "${scheme}": target must be an http(s) URL or local file path.`
      );
    }
  }

  return trimmed;
}

/**
 * Serializes and validates tool execution output, enforcing size bounds.
 */
export function formatAndValidateToolResult(
  result: unknown,
  maxLength: number = DEFAULT_VALIDATION_LIMITS.maxToolOutputLength
): string {
  const text =
    typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2) ?? '';

  if (text.length > maxLength) {
    throw new ValidationError(
      `Tool output (${text.length} characters) exceeds maximum permitted size of ${maxLength} bytes`
    );
  }

  return text;
}

/**
 * Zod schema for validating tool names with length and character constraints.
 */
export const ToolNameSchema = z
  .string({
    error: 'Tool name must be a string',
  })
  .trim()
  .min(1, 'Tool name cannot be empty')
  .max(
    DEFAULT_VALIDATION_LIMITS.maxToolNameLength,
    `Tool name exceeds maximum length of ${DEFAULT_VALIDATION_LIMITS.maxToolNameLength} characters`
  );

/**
 * Zod schema for validating tool argument records.
 */
export const ToolArgumentsSchema = z
  .record(z.string(), z.unknown(), {
    error: 'Tool arguments must be a key-value object',
  })
  .nullable()
  .optional();

/**
 * Validates payload bounds (depth, collection sizes, total nodes, string lengths, circularity)
 * using an iterative traversal to avoid unbounded recursion and prevent memory exhaustion.
 */
export function validatePayloadBounds(
  value: unknown,
  limits: ValidationLimits = DEFAULT_VALIDATION_LIMITS
): void {
  const maxDepth = limits.maxDepth ?? DEFAULT_VALIDATION_LIMITS.maxDepth;
  const maxCollectionSize = limits.maxCollectionSize ?? DEFAULT_VALIDATION_LIMITS.maxCollectionSize;
  const maxTotalNodes = limits.maxTotalNodes ?? DEFAULT_VALIDATION_LIMITS.maxTotalNodes;
  const maxStringLength = limits.maxStringLength ?? DEFAULT_VALIDATION_LIMITS.maxStringLength;

  let totalNodes = 0;
  const seen = new WeakSet<object>();
  const stack: Array<{ val: unknown; depth: number }> = [{ val: value, depth: 0 }];

  while (stack.length > 0) {
    const { val, depth } = stack.pop()!;

    if (depth > maxDepth) {
      throw new ValidationError(`Payload exceeds maximum nesting depth of ${maxDepth}`);
    }

    if (val === null || val === undefined) {
      continue;
    }

    if (typeof val === 'string') {
      if (val.length > maxStringLength) {
        throw new ValidationError(`String length exceeds maximum of ${maxStringLength} characters`);
      }
      continue;
    }

    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'symbol' || typeof val === 'bigint') {
      continue;
    }

    if (typeof val === 'function') {
      throw new ValidationError('Functions are not permitted in tool arguments');
    }

    if (typeof val === 'object') {
      if (seen.has(val)) {
        throw new ValidationError('Circular structure detected in payload');
      }
      seen.add(val);

      if (Array.isArray(val)) {
        if (val.length > maxCollectionSize) {
          throw new ValidationError(
            `Array length ${val.length} exceeds maximum permitted collection size of ${maxCollectionSize}`
          );
        }
        totalNodes += val.length;
        if (totalNodes > maxTotalNodes) {
          throw new ValidationError(
            `Total payload elements (${totalNodes}) exceeds maximum permitted nodes of ${maxTotalNodes}`
          );
        }
        for (let i = val.length - 1; i >= 0; i--) {
          stack.push({ val: val[i], depth: depth + 1 });
        }
      } else {
        const keys = Object.keys(val);
        if (keys.length > maxCollectionSize) {
          throw new ValidationError(
            `Object key count ${keys.length} exceeds maximum permitted collection size of ${maxCollectionSize}`
          );
        }
        totalNodes += keys.length;
        if (totalNodes > maxTotalNodes) {
          throw new ValidationError(
            `Total payload elements (${totalNodes}) exceeds maximum permitted nodes of ${maxTotalNodes}`
          );
        }
        for (let i = keys.length - 1; i >= 0; i--) {
          stack.push({ val: (val as Record<string, unknown>)[keys[i]], depth: depth + 1 });
        }
      }
    }
  }
}

/**
 * Validates tool name and arguments before invoking a tool.
 * Returns normalized arguments (defaulting to empty object if undefined/null).
 */
export function validateToolCall(
  name: unknown,
  args: unknown,
  limits: ValidationLimits = DEFAULT_VALIDATION_LIMITS
): { name: string; args: Record<string, unknown> } {
  const nameResult = ToolNameSchema.safeParse(name);
  if (!nameResult.success) {
    const issue = nameResult.error.issues[0];
    throw new ValidationError(`Invalid tool name: ${issue?.message || 'unknown error'}`);
  }

  const argsResult = ToolArgumentsSchema.safeParse(args);
  if (!argsResult.success) {
    const issue = argsResult.error.issues[0];
    throw new ValidationError(`Invalid tool arguments: ${issue?.message || 'unknown error'}`);
  }

  const normalizedArgs: Record<string, unknown> = argsResult.data ?? {};
  validatePayloadBounds(normalizedArgs, limits);

  return {
    name: nameResult.data,
    args: normalizedArgs,
  };
}

/**
 * Sanitizes a discovered WebMCP tool definition, bounding string lengths,
 * property count, and required fields to prevent memory exhaustion from untrusted pages.
 */
export function sanitizeWebMCPTool(
  tool: unknown,
  limits: ValidationLimits = DEFAULT_VALIDATION_LIMITS
): DiscoveredTool {
  const maxNameLen = limits.maxToolNameLength ?? DEFAULT_VALIDATION_LIMITS.maxToolNameLength;
  const maxDescLen = limits.maxToolDescriptionLength ?? DEFAULT_VALIDATION_LIMITS.maxToolDescriptionLength;
  const maxProps = limits.maxSchemaProperties ?? DEFAULT_VALIDATION_LIMITS.maxSchemaProperties;
  const maxReq = limits.maxSchemaRequired ?? DEFAULT_VALIDATION_LIMITS.maxSchemaRequired;

  if (!tool || typeof tool !== 'object') {
    return {
      name: 'unnamed_tool',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    };
  }

  const raw = tool as Record<string, unknown>;
  let name = 'unnamed_tool';
  if (raw.name !== undefined && raw.name !== null) {
    name = String(raw.name).slice(0, maxNameLen);
  }

  let description = '';
  if (raw.description !== undefined && raw.description !== null) {
    description = String(raw.description).slice(0, maxDescLen);
  }

  let inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {},
  };

  if (raw.inputSchema && typeof raw.inputSchema === 'object' && !Array.isArray(raw.inputSchema)) {
    const rawSchema = raw.inputSchema as Record<string, unknown>;
    const properties: Record<string, unknown> = {};

    if (rawSchema.properties && typeof rawSchema.properties === 'object' && !Array.isArray(rawSchema.properties)) {
      const propEntries = Object.entries(rawSchema.properties as Record<string, unknown>).slice(0, maxProps);
      for (const [key, val] of propEntries) {
        const boundedKey = key.slice(0, maxNameLen);
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          properties[boundedKey] = val;
        } else {
          properties[boundedKey] = {};
        }
      }
    }

    const { required: rawRequired, ...restSchema } = rawSchema;
    inputSchema = {
      ...restSchema,
      type: 'object',
      properties,
    };

    if (Array.isArray(rawRequired)) {
      inputSchema.required = rawRequired
        .slice(0, maxReq)
        .filter((item): item is string => typeof item === 'string')
        .map((s) => s.slice(0, maxNameLen));
    } else if (typeof rawRequired === 'string') {
      inputSchema.required = [rawRequired.slice(0, maxNameLen)];
    }
  }

  return {
    name,
    description,
    inputSchema,
  };
}

/**
 * Sanitizes an array of discovered tools, enforcing a maximum count to prevent unbounded memory growth.
 */
export function sanitizeDiscoveredTools(
  tools: unknown,
  limits: ValidationLimits = DEFAULT_VALIDATION_LIMITS
): DiscoveredTool[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  const maxTools = limits.maxDiscoveredTools ?? DEFAULT_VALIDATION_LIMITS.maxDiscoveredTools;
  return tools.slice(0, maxTools).map((t) => sanitizeWebMCPTool(t, limits));
}
