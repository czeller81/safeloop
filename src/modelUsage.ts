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
  caseId: string;
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
  caseId: string;
  activeParameters?: string;
  totalParameters?: string;
  sessionId?: string;
}

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
    caseId: String(input.caseId).trim(),
    activeParameters: input.activeParameters,
    totalParameters: input.totalParameters,
    sessionId: input.sessionId,
  };
}

export function recordModelUsage(input: ModelUsageInput, options: SafeloopStorageOptions = {}): ModelUsageRecord {
  const provisional = normalizeUsage(input, typeof input.estimatedCost === 'number' ? input.estimatedCost : 0);
  const calculated = calculateUsageCost(provisional, options);
  const record: ModelUsageRecord = {
    ...provisional,
    estimatedCost: calculated.totalCost,
  };

  appendEvent(
    {
      id: `model-usage-${record.timestamp}`,
      type: 'model.usage',
      timestamp: record.timestamp,
      agentId: record.agentId,
      caseId: record.caseId,
      summary: `Model usage recorded for ${record.model}`,
      metadata: { ...record },
    },
    options,
  );

  return record;
}

export function readModelUsage(options: SafeloopStorageOptions = {}): ModelUsageRecord[] {
  return readEvents(options)
    .filter((event) => event.type === 'model.usage')
    .map((event) => ({ ...(event.metadata ?? {}) } as unknown as ModelUsageRecord))
    .filter((entry) => Boolean(entry.provider) && Boolean(entry.model) && Boolean(entry.caseId));
}
