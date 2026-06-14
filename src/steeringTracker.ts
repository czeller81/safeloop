import { appendEvent, readEvents } from './eventStream';
import { readJsonFile, resolveSafeloopPath, writeJsonFile, type SafeloopStorageOptions } from './localStorage';

export interface SteeringProfileInput {
  steeringProfileId: string;
  promptVersion: string;
  instructionVersion: string;
  agent: string;
  model: string;
  tokens: number;
  cost: number;
  decisions: number;
  risks: number;
  approvals: number;
  testsPassed: number;
  releaseReadiness: number;
  caseId?: string;
  timestamp?: string;
}

export interface SteeringProfileRecord extends SteeringProfileInput {
  timestamp: string;
}

export interface SteeringComparison {
  current: SteeringProfileRecord;
  previous: SteeringProfileRecord | null;
  deltas: {
    tokens: number;
    cost: number;
    decisions: number;
    risks: number;
    approvals: number;
    testsPassed: number;
    releaseReadiness: number;
  };
  verdict: 'improved' | 'regressed' | 'mixed' | 'baseline';
  insights: string[];
}

const STEERING_FILE = 'steering.jsonl';

function now(): string {
  return new Date().toISOString();
}

function parseRecord(value: unknown): SteeringProfileRecord {
  return value as SteeringProfileRecord;
}

function readSteeringFile(options: SafeloopStorageOptions = {}): SteeringProfileRecord[] {
  const filePath = resolveSafeloopPath(STEERING_FILE, options);
  return readJsonFile<SteeringProfileRecord[]>(filePath, []);
}

function writeSteeringFile(records: SteeringProfileRecord[], options: SafeloopStorageOptions = {}): void {
  const filePath = resolveSafeloopPath(STEERING_FILE, options);
  writeJsonFile(filePath, records);
}

export function readSteeringProfiles(options: SafeloopStorageOptions = {}): SteeringProfileRecord[] {
  return readSteeringFile(options);
}

export function recordSteeringProfile(
  input: SteeringProfileInput,
  options: SafeloopStorageOptions = {},
): SteeringProfileRecord {
  const record: SteeringProfileRecord = {
    ...input,
    steeringProfileId: String(input.steeringProfileId).trim(),
    promptVersion: String(input.promptVersion).trim(),
    instructionVersion: String(input.instructionVersion).trim(),
    agent: String(input.agent).trim(),
    model: String(input.model).trim(),
    tokens: Number(input.tokens),
    cost: Number(input.cost),
    decisions: Number(input.decisions),
    risks: Number(input.risks),
    approvals: Number(input.approvals),
    testsPassed: Number(input.testsPassed),
    releaseReadiness: Number(input.releaseReadiness),
    caseId: input.caseId?.trim(),
    timestamp: input.timestamp ?? now(),
  };

  const records = readSteeringFile(options);
  records.push(record);
  writeSteeringFile(records, options);

  appendEvent(
    {
      id: `steering-${record.timestamp}`,
      type: 'steering.applied',
      timestamp: record.timestamp,
      agentId: record.agent,
      caseId: record.caseId,
      summary: `Steering profile recorded: ${record.steeringProfileId}`,
      metadata: { ...record },
    },
    options,
  );

  return record;
}

function lookupRecord(recordOrId: SteeringProfileRecord | string, options: SafeloopStorageOptions = {}): SteeringProfileRecord {
  if (typeof recordOrId !== 'string') {
    return recordOrId;
  }
  const record = readSteeringFile(options).find((entry) => entry.steeringProfileId === recordOrId);
  if (!record) {
    throw new Error(`Steering profile not found: ${recordOrId}`);
  }
  return record;
}

export function compareSteeringRuns(
  current: SteeringProfileRecord | string,
  previous: SteeringProfileRecord | string | null = null,
  options: SafeloopStorageOptions = {},
): SteeringComparison {
  const currentRecord = lookupRecord(current, options);
  const previousRecord = previous == null ? null : lookupRecord(previous, options);

  if (!previousRecord) {
    return {
      current: currentRecord,
      previous: null,
      deltas: {
        tokens: 0,
        cost: 0,
        decisions: 0,
        risks: 0,
        approvals: 0,
        testsPassed: 0,
        releaseReadiness: 0,
      },
      verdict: 'baseline',
      insights: ['No previous steering run available for comparison'],
    };
  }

  const deltas = {
    tokens: currentRecord.tokens - previousRecord.tokens,
    cost: currentRecord.cost - previousRecord.cost,
    decisions: currentRecord.decisions - previousRecord.decisions,
    risks: currentRecord.risks - previousRecord.risks,
    approvals: currentRecord.approvals - previousRecord.approvals,
    testsPassed: currentRecord.testsPassed - previousRecord.testsPassed,
    releaseReadiness: currentRecord.releaseReadiness - previousRecord.releaseReadiness,
  };

  const insights: string[] = [];
  if (deltas.tokens < 0) insights.push('Reduced token use');
  if (deltas.cost < 0) insights.push('Reduced cost');
  if (deltas.risks < 0) insights.push('Reduced risk count');
  if (deltas.releaseReadiness > 0) insights.push('Improved release readiness');
  if (deltas.testsPassed > 0) insights.push('Improved test pass count');
  if (deltas.decisions > 0) insights.push('Captured more decisions');
  if (deltas.approvals > 0) insights.push('Resolved more approvals');

  let verdict: SteeringComparison['verdict'] = 'mixed';
  if (deltas.releaseReadiness > 0 && deltas.risks <= 0 && deltas.tokens <= 0) {
    verdict = 'improved';
  } else if (deltas.releaseReadiness < 0 || deltas.risks > 0) {
    verdict = 'regressed';
  }

  return { current: currentRecord, previous: previousRecord, deltas, verdict, insights };
}

export function readSteeringHistory(options: SafeloopStorageOptions = {}): SteeringProfileRecord[] {
  return readSteeringProfiles(options);
}
