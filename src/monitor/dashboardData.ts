import { resolve } from 'path';
import { calculateReadinessScore, type ReadinessScoreResult } from '../readinessScore';
import { getCaseCostSummary } from '../costTracker';
import { readEvents, type SafeloopStreamEvent } from '../eventStream';
import { readModelUsage, type ModelUsageRecord } from '../modelUsage';
import {
  compareSteeringRuns,
  readSteeringProfiles,
  type SteeringComparison,
  type SteeringProfileRecord,
} from '../steeringTracker';
import type { SafeloopStorageOptions } from '../localStorage';

export interface ActiveLoopSnapshot {
  key: string;
  agent: string;
  task: string;
  status: 'running' | 'completed' | 'idle';
  durationSeconds: number;
  currentModel: string | null;
  caseId?: string;
}

export interface DashboardSnapshot {
  activeLoops: ActiveLoopSnapshot[];
  events: SafeloopStreamEvent[];
  eventCount: number;
  monitoredPath: string;
  lastUpdated: string;
  costSummary: ReturnType<typeof getCaseCostSummary>;
  modelUsage: ModelUsageRecord[];
  risks: Array<{ id: string; summary: string; severity?: string; mitigation?: string }>;
  approvals: Array<{ id: string; summary: string; approver?: string; reason?: string; status: string }>;
  artifacts: Array<{ id: string; summary: string; path?: string }>; 
  handoffs: Array<{ id: string; currentOwner?: string; nextOwner?: string; summary: string }>;
  readiness: ReadinessScoreResult;
  steeringInsights: SteeringComparison[];
}

function now(): number {
  return Date.now();
}

function parseTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? now() : parsed;
}

function latestByKey<T extends { timestamp: string }>(items: T[]): Map<string, T> {
  return items.reduce((acc, item) => acc, new Map<string, T>());
}

function deriveActiveLoops(events: SafeloopStreamEvent[]): ActiveLoopSnapshot[] {
  const groups = new Map<string, SafeloopStreamEvent[]>();
  for (const event of events) {
    const key = `${event.caseId ?? 'case-unknown'}::${event.agentId}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(event);
    groups.set(key, bucket);
  }

  const activeLoops: ActiveLoopSnapshot[] = [];
  for (const [key, bucket] of groups.entries()) {
    const started = [...bucket].reverse().find((event) => event.type === 'task.started');
    if (!started) {
      continue;
    }
    const latest = bucket[bucket.length - 1];
    const model = [...bucket].reverse().find((event) => event.type === 'model.usage');
    const status = latest?.type === 'task.completed' ? 'completed' : 'running';
    activeLoops.push({
      key,
      agent: latest.agentName ?? latest.agentId,
      task: started.summary,
      status,
      durationSeconds: Math.max(0, Math.round((now() - parseTime(started.timestamp)) / 1000)),
      currentModel: model?.metadata && typeof model.metadata.model === 'string' ? model.metadata.model : null,
      caseId: latest.caseId,
    });
  }

  return activeLoops;
}

function deriveRiskSummary(events: SafeloopStreamEvent[]): DashboardSnapshot['risks'] {
  return events
    .filter((event) => event.type === 'risk.detected')
    .map((event) => ({
      id: event.id,
      summary: event.summary,
      severity: typeof event.metadata?.severity === 'string' ? event.metadata.severity : undefined,
      mitigation: typeof event.metadata?.mitigation === 'string' ? event.metadata.mitigation : undefined,
    }));
}

function deriveApprovalQueue(events: SafeloopStreamEvent[]): DashboardSnapshot['approvals'] {
  const approvals: Array<{
    id: string;
    summary: string;
    approver?: string;
    reason?: string;
    status: 'pending' | 'approved' | 'rejected';
  }> = [];
  const approvalIndexByKey = new Map<string, number>();

  for (const event of events) {
    if (event.type === 'approval.requested') {
      const entry = {
        id: event.id,
        summary: event.summary,
        approver: typeof event.metadata?.approver === 'string' ? event.metadata.approver : undefined,
        reason: typeof event.metadata?.reason === 'string' ? event.metadata.reason : undefined,
        status: 'pending' as const,
      };
      approvalIndexByKey.set(event.id, approvals.length);
      if (typeof event.metadata?.approvalId === 'string' && event.metadata.approvalId.trim().length > 0) {
        approvalIndexByKey.set(event.metadata.approvalId.trim(), approvals.length);
      }
      approvals.push(entry);
      continue;
    }

    if (event.type === 'approval.resolved') {
      const approvalId = typeof event.metadata?.approvalId === 'string' ? event.metadata.approvalId.trim() : '';
      let approvalIndex = approvalId ? approvalIndexByKey.get(approvalId) : undefined;

      if (approvalIndex === undefined) {
        for (let index = approvals.length - 1; index >= 0; index -= 1) {
          if (approvals[index].status === 'pending') {
            approvalIndex = index;
            break;
          }
        }
      }

      if (approvalIndex === undefined) {
        continue;
      }

      approvals[approvalIndex] = {
        ...approvals[approvalIndex],
        status: event.metadata?.decision === 'rejected' ? 'rejected' : 'approved',
        approver: typeof event.metadata?.approver === 'string' ? event.metadata.approver : approvals[approvalIndex].approver,
      };
      if (approvalId) {
        approvalIndexByKey.set(approvalId, approvalIndex);
      }
    }
  }

  return approvals;
}

function deriveArtifacts(events: SafeloopStreamEvent[]): DashboardSnapshot['artifacts'] {
  return events
    .filter((event) => event.type === 'artifact.changed')
    .map((event) => ({
      id: event.id,
      summary: event.summary,
      path: typeof event.metadata?.path === 'string' ? event.metadata.path : undefined,
    }));
}

function deriveHandoffs(events: SafeloopStreamEvent[]): DashboardSnapshot['handoffs'] {
  return events
    .filter((event) => event.type === 'handoff.created')
    .map((event) => ({
      id: event.id,
      currentOwner: typeof event.metadata?.from === 'string' ? event.metadata.from : undefined,
      nextOwner: typeof event.metadata?.to === 'string' ? event.metadata.to : undefined,
      summary: event.summary,
    }));
}

function deriveModelUsage(events: SafeloopStreamEvent[]): ModelUsageRecord[] {
  return readModelUsageFromEvents(events);
}

function readModelUsageFromEvents(events: SafeloopStreamEvent[]): ModelUsageRecord[] {
  return events
    .filter((event) => event.type === 'model.usage')
    .map((event) => ({ ...(event.metadata ?? {}) } as unknown as ModelUsageRecord))
    .filter((entry) => Boolean(entry.provider) && Boolean(entry.model) && Boolean(entry.caseId));
}

function deriveReadiness(events: SafeloopStreamEvent[], modelUsage: ModelUsageRecord[]): ReadinessScoreResult {
  const risks = events
    .filter((event) => event.type === 'risk.detected')
    .map((event) => ({
      severity: (typeof event.metadata?.severity === 'string' ? event.metadata.severity : 'medium') as 'low' | 'medium' | 'high',
      status: 'open' as const,
    }));

  const approvals = events
    .filter((event) => event.type === 'approval.resolved')
    .map((event) => ({
      status: ((event.metadata?.decision as string | undefined) ?? 'approved') as 'approved' | 'pending' | 'rejected',
    }));

  const attachments = events
    .filter((event) => event.type === 'artifact.changed')
    .map((event) => typeof event.metadata?.path === 'string' ? event.metadata.path : event.summary);

  const handoffs = events
    .filter((event) => event.type === 'handoff.created')
    .map((event) => event.summary);

  const evidence = events.map((event) => event.summary);
  const testsPassed = events.filter((event) => event.type === 'test.completed').length === 0
    ? true
    : events
        .filter((event) => event.type === 'test.completed')
        .every((event) => String(event.metadata?.status ?? '').toLowerCase() === 'passed');

  return calculateReadinessScore({
    risks,
    approvals,
    attachments,
    evidence,
    handoffs,
    tests: { passed: testsPassed },
  });
}

function buildSteeringInsights(records: SteeringProfileRecord[]): SteeringComparison[] {
  if (records.length === 0) {
    return [];
  }
  const grouped = new Map<string, SteeringProfileRecord[]>();
  for (const record of records) {
    const key = record.steeringProfileId;
    const bucket = grouped.get(key) ?? [];
    bucket.push(record);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.values()).map((bucket) => {
    const current = bucket[bucket.length - 1];
    const previous = bucket.length > 1 ? bucket[bucket.length - 2] : null;
    return compareSteeringRuns(current, previous ?? null);
  });
}

export function getDashboardSnapshot(options: SafeloopStorageOptions = {}): DashboardSnapshot {
  const events = readEvents(options);
  const modelUsage = deriveModelUsage(events);
  const steeringProfiles = readSteeringProfiles(options);
  const monitoredPath = resolve(options.baseDir ?? process.cwd(), '.safeloop');
  const lastUpdated = events.length > 0 ? events[events.length - 1].timestamp : new Date().toISOString();

  return {
    activeLoops: deriveActiveLoops(events),
    events,
    eventCount: events.length,
    monitoredPath,
    lastUpdated,
    costSummary: getCaseCostSummary(undefined, options),
    modelUsage,
    risks: deriveRiskSummary(events),
    approvals: deriveApprovalQueue(events),
    artifacts: deriveArtifacts(events),
    handoffs: deriveHandoffs(events),
    readiness: deriveReadiness(events, modelUsage),
    steeringInsights: buildSteeringInsights(steeringProfiles),
  };
}
