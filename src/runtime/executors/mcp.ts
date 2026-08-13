/**
 * Managed MCP executor (downstream governance gateway).
 *
 * SafeLoop already speaks MCP as a *server*. This executor is the other
 * direction: an agent proposes a downstream MCP tool call, SafeLoop governs it,
 * and only then does the call reach the downstream server.
 *
 *   Agent → SafeLoop MCP gateway → proposed call → policy → downstream server
 *
 * The distinction that matters: a tool being *listed* is not a tool being
 * *governed*. A downstream tool reached through the certified managed route
 * cannot execute without a decision, because this executor is only ever
 * entered after a permit has been verified and consumed.
 */

import { createHash } from 'crypto';
import { redactAndBound } from '../redaction';
import { attachExecutionProof, sha256Text } from '../executionProof';
import {
  ExecutorArgumentError,
  requireString,
  type ExecutorContext,
  type ExecutorOutcome,
  type ManagedExecutorPlugin,
} from './types';

export interface McpDownstreamCall {
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface McpDownstreamResponse {
  ok: boolean;
  content?: unknown;
  error?: string;
}

export type McpInvoker = (call: McpDownstreamCall) => Promise<McpDownstreamResponse>;

const SENSITIVE_RESULT_KEYS = /(secret|token|password|passwd|credential|authorization|api[_-]?key|private[_-]?key)/i;

function redactStructured(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactStructured);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_RESULT_KEYS.test(key) ? '[REDACTED]' : redactStructured(nested);
    }
    return out;
  }
  return value;
}
export interface McpExecutorOptions {
  /**
   * How SafeLoop reaches downstream MCP servers. Injectable so conformance runs
   * and tests never touch a real server. When absent, downstream MCP is
   * declared UNMANAGED rather than silently attempted.
   */
  invoke?: McpInvoker;
}

/** Split `server.tool` addressing used by the action's `tool` slot. */
export function parseMcpTarget(action: { tool: string; target: string }): { server: string; tool: string } {
  const raw = action.target || action.tool;
  if (!raw) throw new ExecutorArgumentError('mcp actions require a "server.tool" target');
  const separator = raw.indexOf('.');
  if (separator <= 0 || separator === raw.length - 1) {
    throw new ExecutorArgumentError(`mcp target must be "server.tool", got: ${raw}`);
  }
  return { server: raw.slice(0, separator), tool: raw.slice(separator + 1) };
}

export function createMcpExecutor(options: McpExecutorOptions = {}): ManagedExecutorPlugin {
  return {
    kind: 'mcp',

    async execute(context: ExecutorContext): Promise<ExecutorOutcome> {
      const { action } = context;
      if (!options.invoke) {
        // Refusing is the honest answer: without a downstream transport this
        // path is not managed, and pretending otherwise would certify a lie.
        return {
          status: 'FAILED',
          stderr: 'no downstream MCP transport is configured; this path is UNMANAGED and cannot be executed',
          detail: attachExecutionProof({ mcp_managed: false }, {
            executor: 'mcp',
            operation: action.operation,
            result: { success: false, managed: false },
            verification_status: 'NOT_VERIFIABLE',
            verification_summary: 'no downstream MCP transport configured',
            verification_scope: 'MCP proof requires a managed downstream transport.',
          }),
        };
      }

      const { server, tool } = parseMcpTarget(action);
      const callArguments = (action.arguments.arguments ?? action.arguments) as Record<string, unknown>;
      const startedAt = Date.now();

      const descriptor = {
        mcp_server: server,
        mcp_tool: tool,
        transport: 'in_process_invoker',
        arguments_hash: `sha256:${createHash('sha256').update(JSON.stringify(callArguments ?? {})).digest('hex')}`,
        mcp_managed: true,
      };

      try {
        const response = await options.invoke({ server, tool, arguments: callArguments ?? {} });
        const text = typeof response.content === 'string' ? context.redact(response.content) : JSON.stringify(redactStructured(response.content ?? null));
        const durationMs = Date.now() - startedAt;
        const redactedText = context.redact(text);
        const resultHash = sha256Text(redactedText);
        return {
          status: response.ok ? 'EXECUTED' : 'FAILED',
          stdout: redactAndBound(redactedText, context.maxOutputBytes),
          stderr: response.error ? context.redact(response.error) : undefined,
          detail: attachExecutionProof({ ...descriptor, result_hash: resultHash, result_bytes: Buffer.byteLength(redactedText), duration_ms: durationMs }, {
            executor: 'mcp',
            operation: action.operation,
            before: { server, tool, arguments_hash: descriptor.arguments_hash, transport: descriptor.transport },
            result: { success: response.ok, result_hash: resultHash, result_bytes: Buffer.byteLength(redactedText), duration_ms: durationMs },
            verification_status: response.ok ? 'PARTIALLY_VERIFIED' : 'FAILED',
            verification_summary: 'MCP tool-call result observed; downstream side effects are not inferred',
            verification_scope: 'MCP proof covers the governed downstream tool call unless downstream evidence is explicitly linked.',
          }),
        };
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        return {
          status: 'FAILED',
          stderr: error instanceof Error ? error.message : String(error),
          detail: attachExecutionProof({ ...descriptor, duration_ms: durationMs }, {
            executor: 'mcp',
            operation: action.operation,
            before: { server, tool, arguments_hash: descriptor.arguments_hash, transport: descriptor.transport },
            result: { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: durationMs },
            verification_status: 'FAILED',
            verification_summary: 'MCP tool call failed',
            verification_scope: 'MCP proof covers the governed downstream tool call unless downstream evidence is explicitly linked.',
          }),
        };
      }
    },
  };
}

/** Convenience for adapters translating a native MCP call into a proposal. */
export function mcpActionArguments(call: McpDownstreamCall): Record<string, unknown> {
  requireString({ server: call.server }, 'server');
  return { arguments: call.arguments };
}
