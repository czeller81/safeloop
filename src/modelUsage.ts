import { appendEvent, readEvents } from './eventStream';
import { calculateUsageCost } from './costPricing';
import type { SafeloopStorageOptions } from './localStorage';

export type ModelArchitecture = 'dense' | 'moe' | 'local' | 'hosted' | 'unknown';

export interface ModelUsageRecord {
  provider: string;
  model: string;
  modelArchitecture: ModelArchitecture;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  timestamp: string;
  agentId: string;
  agent?: string;
  caseId: string;
  project?: string;
  taskId?: string;
  taskName?: string;
  activeParameters?: string;
  totalParameters?: string;
  sessionId?: string;
}

export interface ModelUsageInput {
  provider: string;
  model: string;
  modelArchitecture: ModelArchitecture;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  estimatedCost?: number;
  timestamp?: string;
  agentId: string;
  agent?: string;
  caseId: string;
  project?: string;
  taskId?: string;
  taskName?: string;
  activeParameters?: string;
  totalParameters?: string;
  sessionId?: string;
}

export interface TokenCostRecord extends ModelUsageRecord {}
export interface TokenCostInput extends ModelUsageInput {}

function now(): string {
  return new Date().toISOString();
}

function normalizeUsage(input: ModelUsageInput, estimatedCost: number): ModelUsageRecord {
  return {
    provider: String(input.provider).trim(),
    model: String(input.model).trim(),
    modelArchitecture: input.modelArchitecture,
    inputTokens: Number(input.inputTokens),
    outputTokens: Number(input.outputTokens),
    totalTokens: Number(input.totalTokens ?? Number(input.inputTokens) + Number(input.outputTokens)),
    estimatedCost,
    timestamp: input.timestamp ?? now(),
    agentId: String(input.agentId).trim(),
    agent: String(input.agent ?? '').trim() || undefined,
    caseId: String(input.caseId).trim(),
    project: String(input.project ?? '').trim() || undefined,
    taskId: String(input.taskId ?? '').trim() || undefined,
    taskName: String(input.taskName ?? '').trim() || undefined,
    activeParameters: input.activeParameters,
    totalParameters: input.totalParameters,
    sessionId: input.sessionId,
  };
}

function appendTokenCostEvent(record: TokenCostRecord, options: SafeloopStorageOptions): void {
  appendEvent(
    {
      id: `token-cost-${record.timestamp}`,
      type: 'token.cost',
      timestamp: record.timestamp,
      agentId: record.agentId,
      caseId: record.caseId,
      summary: `Token cost recorded for ${record.model}`,
      metadata: { ...record },
    },
    options,
  );
}

export function recordTokenCost(input: TokenCostInput, options: SafeloopStorageOptions = {}): TokenCostRecord {
  const provisional = normalizeUsage(input, typeof input.estimatedCost === 'number' ? input.estimatedCost : 0);
  const calculated = calculateUsageCost(provisional, options);
  const record: TokenCostRecord = {
    ...provisional,
    estimatedCost: calculated.totalCost,
  };
  appendTokenCostEvent(record, options);
  return record;
}

export function recordModelUsage(input: ModelUsageInput, options: SafeloopStorageOptions = {}): ModelUsageRecord {
  return recordTokenCost(input, options);
}

function isTokenCostEventType(type: string): boolean {
  return type === 'token.cost' || type === 'model.usage';
}

export function readTokenCosts(options: SafeloopStorageOptions = {}): TokenCostRecord[] {
  return readEvents(options)
    .filter((event) => isTokenCostEventType(event.type))
    .map((event) => ({ ...(event.metadata ?? {}) } as unknown as TokenCostRecord))
    .filter((entry) => Boolean(entry.provider) && Boolean(entry.model) && Boolean(entry.caseId));
}

export function readModelUsage(options: SafeloopStorageOptions = {}): ModelUsageRecord[] {
  return readTokenCosts(options);
}
