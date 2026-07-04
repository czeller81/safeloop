/**
 * SafeLoop MCP stdio Server
 *
 * A true MCP-compatible stdio JSON-RPC 2.0 server that wraps the existing
 * SafeLoop MCP Gateway. MCP hosts can configure this server and call
 * SafeLoop tools through the standard protocol.
 *
 * Transport: stdin/stdout JSON-RPC 2.0
 * Logging: stderr only (stdout is reserved for protocol)
 */

import { createMcpGateway, type McpGateway } from './safeLoopMcpGateway';
import type { McpToolInput } from './types';

// --- Tool schemas for tools/list ---

const TOOL_SCHEMAS = [
  {
    name: 'safeloop.checkCommand',
    description: 'Preflight a shell command through SafeLoop without executing it. Returns allow/deny/requires_approval decision.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to evaluate' },
        agentId: { type: 'string', description: 'Agent identifier' },
        agentName: { type: 'string', description: 'Agent display name' },
        caseId: { type: 'string', description: 'Case/session identifier' },
        taskId: { type: 'string', description: 'Task identifier' },
        taskName: { type: 'string', description: 'Task display name' },
        cwd: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
  },
  {
    name: 'safeloop.runCommand',
    description: 'Run a shell command through SafeLoop CommandGuard. Denied and approval-required commands never reach the shell.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute through guard' },
        agentId: { type: 'string', description: 'Agent identifier' },
        agentName: { type: 'string', description: 'Agent display name' },
        caseId: { type: 'string', description: 'Case/session identifier' },
        taskId: { type: 'string', description: 'Task identifier' },
        taskName: { type: 'string', description: 'Task display name' },
        cwd: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
  },
  {
    name: 'safeloop.recordActivity',
    description: 'Record an audit-only SafeLoop activity event. Does not execute anything.',
    inputSchema: {
      type: 'object',
      properties: {
        activityType: { type: 'string', description: 'Activity type (file.write, git.push, test.run, etc.)' },
        agentId: { type: 'string', description: 'Agent identifier' },
        agentName: { type: 'string', description: 'Agent display name' },
        caseId: { type: 'string', description: 'Case/session identifier' },
        taskId: { type: 'string', description: 'Task identifier' },
        taskName: { type: 'string', description: 'Task display name' },
        target: { type: 'string', description: 'Target file/resource' },
        summary: { type: 'string', description: 'Activity summary' },
        metadata: { type: 'object', description: 'Additional metadata' },
      },
      required: ['activityType'],
    },
  },
  {
    name: 'safeloop.status',
    description: 'Return SafeLoop MCP server status, available tools, and enforcement boundary.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// --- JSON-RPC helpers ---

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

function makeResponse(id: string | number | null, result: any): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolResult(data: any): any {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

// --- Message handler (exported for testing) ---

export function handleMessage(msg: JsonRpcRequest, gateway: McpGateway): JsonRpcResponse | null {
  const id = msg.id ?? null;

  // Notifications (no id) — accept silently
  if (msg.id === undefined && msg.method === 'notifications/initialized') {
    return null; // no response for notifications
  }

  switch (msg.method) {
    case 'initialize':
      return makeResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'safeloop', version: '1.0.0' },
      });

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return makeResponse(id, { tools: TOOL_SCHEMAS });

    case 'tools/call': {
      const toolName = msg.params?.name;
      const args: McpToolInput = msg.params?.arguments ?? {};

      switch (toolName) {
        case 'safeloop.checkCommand':
          return makeResponse(id, toolResult(gateway.checkCommand(args)));
        case 'safeloop.runCommand':
          return makeResponse(id, toolResult(gateway.runCommand(args)));
        case 'safeloop.recordActivity':
          return makeResponse(id, toolResult(gateway.recordActivity(args)));
        case 'safeloop.status': {
          const status = gateway.status();
          return makeResponse(id, toolResult({ ...status, transport: 'stdio' }));
        }
        default:
          return makeError(id, -32601, `Unknown tool: ${toolName}`);
      }
    }

    default:
      return makeError(id, -32601, `Method not found: ${msg.method}`);
  }
}

// --- stdio server loop ---

export function startStdioServer(gateway?: McpGateway): void {
  const gw = gateway ?? createMcpGateway();
  let buffer = '';

  process.stderr.write('SafeLoop MCP stdio server started\n');

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;

    // Try to parse complete JSON messages (newline-delimited)
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep incomplete last line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as JsonRpcRequest;
        const response = handleMessage(msg, gw);
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (err: any) {
        const errResponse = makeError(null, -32700, 'Parse error');
        process.stdout.write(JSON.stringify(errResponse) + '\n');
      }
    }
  });

  process.stdin.on('end', () => {
    process.stderr.write('SafeLoop MCP stdio server: stdin closed\n');
    process.exit(0);
  });
}
