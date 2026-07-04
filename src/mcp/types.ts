/**
 * SafeLoop MCP Gateway Types
 */

export interface McpToolInput {
  command?: string;
  agentId?: string;
  agentName?: string;
  caseId?: string;
  taskId?: string;
  taskName?: string;
  cwd?: string;
  activityType?: string;
  target?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface McpCheckResult {
  decision: 'allow' | 'deny' | 'requires_approval';
  executed: false;
  checkOnly: true;
  violations?: string[];
  reasons?: string[];
  eventId: string;
}

export interface McpRunResult {
  decision: 'allow' | 'deny' | 'requires_approval';
  executed: boolean;
  exitCode?: number;
  output?: string;
  error?: string;
  violations?: string[];
  reasons?: string[];
  eventId: string;
}

export interface McpRecordResult {
  recorded: true;
  eventId: string;
}

export interface McpStatusResult {
  service: string;
  version: string;
  tools: string[];
  enforcementBoundary: string;
  baseDir: string;
  ledgerPath: string;
}

export type McpToolName = 'safeloop.checkCommand' | 'safeloop.runCommand' | 'safeloop.recordActivity' | 'safeloop.status';

export interface McpRequest {
  tool: McpToolName;
  input: McpToolInput;
}

export interface McpResponse {
  ok: boolean;
  result?: McpCheckResult | McpRunResult | McpRecordResult | McpStatusResult;
  error?: string;
}
