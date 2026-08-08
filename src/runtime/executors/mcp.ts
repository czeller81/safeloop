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
          detail: { mcp_managed: false },
        };
      }

      const { server, tool } = parseMcpTarget(action);
      const callArguments = (action.arguments.arguments ?? action.arguments) as Record<string, unknown>;
      const startedAt = Date.now();

      const descriptor = {
        mcp_server: server,
        mcp_tool: tool,
        arguments_hash: `sha256:${createHash('sha256').update(JSON.stringify(callArguments ?? {})).digest('hex')}`,
        mcp_managed: true,
      };

      try {
        const response = await options.invoke({ server, tool, arguments: callArguments ?? {} });
        const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content ?? null);
        return {
          status: response.ok ? 'EXECUTED' : 'FAILED',
          stdout: redactAndBound(text, context.maxOutputBytes),
          stderr: response.error,
          detail: { ...descriptor, duration_ms: Date.now() - startedAt },
        };
      } catch (error) {
        return {
          status: 'FAILED',
          stderr: error instanceof Error ? error.message : String(error),
          detail: { ...descriptor, duration_ms: Date.now() - startedAt },
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
