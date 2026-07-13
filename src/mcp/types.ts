/**
 * SafeLoop MCP Gateway Types
 */

export interface McpToolInput {
  command?: string;
  agentId?: string;
  agentName?: string;
  specialistId?: string;
  caseId?: string;
  taskId?: string;
  taskName?: string;
  executionPlanId?: string;
  stepId?: string;
  environment?: string;
  authorizationToken?: string;
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
  reasonCodes?: string[];
  authorizationToken?: string;
  eventId: string;
}

export interface McpRunResult {
  decision: 'allow' | 'deny' | 'requires_approval';
  executed: boolean;
  exitCode?: number;
  output?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  signal?: NodeJS.Signals | string | null;
  timedOut?: boolean;
  spawnError?: string;
  failureKind?: string;
  cwd?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  violations?: string[];
  reasons?: string[];
  reasonCodes?: string[];
  authorizationToken?: string;
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
  enforcementDiagnostics?: {
    registeredAdapters: string[];
    expectedAdapters: string[];
    knownCoverageGaps: string[];
    boundary: string;
  };
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
