import { calculateReadinessScore, type ReadinessScoreResult } from '../readinessScore';
import type { DashboardSnapshot } from './dashboardData';
import type { SafeloopStreamEvent } from '../eventStream';
import type { ModelUsageRecord } from '../modelUsage';
import { analyzeLoopOversight as analyzeLoopOversightImpl } from '../oversightAnalyzer';

export type LoopStatus = 'running' | 'completed' | 'stale' | 'historical';

export interface LoopTimecard {
  key: string;
  caseId: string;
  taskId?: string;
  taskName: string;
  project?: string;
  agentId?: string;
  agent?: string;
  sessionId?: string;
  status: LoopStatus;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  durationMs: number;
  approvalsCount: number;
  approvalsStatus: 'none' | 'pending' | 'approved' | 'rejected';
  risksCount: number;
  artifactsCount: number;
  handoffsCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  models: string[];
  oversightScore: number;
  oversightLevel: OversightLevel;
  recommendedAction: OversightRecommendedAction;
  warnings: OversightIssue[];
  anomalies: OversightIssue[];
  explainability: LoopExplainabilitySummary;
  feedback: LoopFeedbackSummary;
}

export interface TimecardCollection {
  all: LoopTimecard[];
  current: LoopTimecard[];
  historical: LoopTimecard[];
  latest: LoopTimecard | null;
}

interface InternalLoopTimecard extends LoopTimecard {
  _events: SafeloopStreamEvent[];
  _usageRecords: ModelUsageRecord[];
}

type LoopEventSource = {
  _events?: SafeloopStreamEvent[];
};

interface InternalTimecardCollection {
  all: InternalLoopTimecard[];
  current: InternalLoopTimecard[];
  historical: InternalLoopTimecard[];
  latest: InternalLoopTimecard | null;
}

export interface SectionItem {
  id: string;
  caseId?: string;
  loopKey?: string;
  summary: string;
  timestamp: string;
  agent?: string;
  agentId?: string;
}

export interface RiskItem extends SectionItem {
  severity?: 'low' | 'medium' | 'high';
  mitigation?: string;
}

export interface ApprovalItem extends SectionItem {
  approver?: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ArtifactItem extends SectionItem {
  path?: string;
}

export interface HandoffItem extends SectionItem {
  from?: string;
  to?: string;
}

export type OversightLevel = 'healthy' | 'watch' | 'needs_review' | 'critical';
export type OversightRecommendedAction =
  | 'continue'
  | 'review'
  | 'approve_required'
  | 'investigate_cost'
  | 'investigate_stale_loop'
  | 'fix_attribution'
  | 'add_explanation'
  | 'stop_or_handoff';

export interface OversightIssue {
  code: string;
  severity: 'warning' | 'anomaly';
  message: string;
}

export interface LoopExplainabilitySummary {
  decisionCount: number;
  explainedDecisionCount: number;
  explanationCoveragePercent: number;
  missingExplanationCount: number;
}

export interface LoopFeedbackItem {
  feedbackId?: string;
  targetType: 'loop' | 'event' | 'artifact' | 'decision' | 'approval' | 'handoff';
  targetEventId?: string;
  rating: 'positive' | 'neutral' | 'negative';
  score?: number;
  labels: string[];
  comment: string;
  reviewer?: string;
  timestamp: string;
}

export interface LoopFeedbackSummary {
  feedbackCount: number;
  averageScore: number | null;
  positiveCount: number;
  negativeCount: number;
  latestFeedback: LoopFeedbackItem | null;
  needsReviewFromFeedback: boolean;
}

export interface LoopOversightSummary {
  oversightScore: number;
  oversightLevel: OversightLevel;
  recommendedAction: OversightRecommendedAction;
  warningCount: number;
  anomalyCount: number;
  latestLoop: LoopTimecard | null;
  loopCount: number;
  currentLoopCount: number;
  historicalLoopCount: number;
  staleLoopCount: number;
  needsReviewLoopCount: number;
  explainability: LoopExplainabilitySummary;
  feedback: LoopFeedbackSummary;
}

export interface OversightSection {
  summary: LoopOversightSummary;
  latestLoop: LoopTimecard | null;
  loopTimecards: LoopTimecard[];
  warnings: OversightIssue[];
  anomalies: OversightIssue[];
  explainability: LoopExplainabilitySummary;
  feedback: LoopFeedbackSummary;
}

export interface CurrentSection {
  latestRun: LoopTimecard | null;
  currentLoops: LoopTimecard[];
  currentReadiness: ReadinessScoreResult;
  risks: RiskItem[];
  approvals: ApprovalItem[];
  artifacts: ArtifactItem[];
  handoffs: HandoffItem[];
}

export interface HistoricalSection {
  loopCount: number;
  eventCount: number;
  riskCount: number;
  readiness: ReadinessScoreResult;
  loops: LoopTimecard[];
  risks: RiskItem[];
  approvals: ApprovalItem[];
  artifacts: ArtifactItem[];
  handoffs: HandoffItem[];
}

export interface SpendAggregate {
  totalCost: number;
  currency: string;
  usageCount: number;
  byAgent: Record<string, number>;
  byModel: Record<string, number>;
  byProject: Record<string, number>;
  byTask: Record<string, number>;
  latestRunCost: number;
  totalLedgerCost: number;
}

export interface TokenModelUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  records: number;
}

export interface TokenSection {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  byModel: Record<string, TokenModelUsageSummary>;
  records: ModelUsageRecord[];
}

export interface DiagnosticsSection {
  lastPollUrl: string;
  lastHttpStatus: string;
  responseKeys: string[];
  lastRenderError: string | null;
}

export interface MonitorViewModel {
  status: {
    connection: 'connected';
    lastUpdated: string;
    monitoredPath: string;
    eventCount: number;
  };
  current: CurrentSection;
  historical: HistoricalSection;
  spend: SpendAggregate;
  tokens: TokenSection;
  diagnostics: DiagnosticsSection;
  oversight: OversightSection;
}

export interface MonitorDashboardPayload extends DashboardSnapshot {
  viewModel: MonitorViewModel;
  oversight: OversightSection;
}

const LOOP_RECENT_MS = 30 * 60 * 1000;
const LOOP_STALE_MS = 2 * 60 * 60 * 1000;
const LOOP_HISTORICAL_MS = 24 * 60 * 60 * 1000;

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function latestTimestamp(a: string, b: string): string {
  return toTimestamp(a) >= toTimestamp(b) ? a : b;
}

function earliestTimestamp(a: string, b: string): string {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return toTimestamp(a) <= toTimestamp(b) ? a : b;
}

function buildLoopKey(record: Partial<ModelUsageRecord> & { caseId: string }): string {
  const sessionId = trimText(record.sessionId);
  const taskId = trimText(record.taskId);
  const taskName = trimText(record.taskName);
  const agentId = trimText(record.agentId);
  const agent = trimText(record.agent);
  const primary = sessionId || taskId || taskName || agentId || agent || 'loop';
  const secondary = taskId || taskName || sessionId || agentId || agent || 'loop';
  return [trimText(record.caseId) || 'case-unknown', primary, secondary].join('::');
}

interface LoopBucket {
  key: string;
  caseId: string;
  taskId?: string;
  taskName?: string;
  project?: string;
  agentId?: string;
  agent?: string;
  sessionId?: string;
  eventTypes: Set<string>;
  models: Set<string>;
  usageRecords: ModelUsageRecord[];
  events: SafeloopStreamEvent[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  firstTimestamp: string;
  lastTimestamp: string;
}

function createBucketFromUsage(record: ModelUsageRecord): LoopBucket {
  return {
    key: buildLoopKey(record),
    caseId: record.caseId,
    taskId: trimText(record.taskId) || undefined,
    taskName: trimText(record.taskName) || trimText(record.taskId) || 'Unnamed loop',
    project: trimText(record.project) || undefined,
    agentId: trimText(record.agentId) || undefined,
    agent: trimText(record.agent) || trimText(record.agentId) || undefined,
    sessionId: trimText(record.sessionId) || undefined,
    eventTypes: new Set<string>(),
    models: new Set<string>(),
    usageRecords: [],
    events: [],
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    firstTimestamp: record.timestamp,
    lastTimestamp: record.timestamp,
  };
}

function createBucketFromEvent(event: SafeloopStreamEvent): LoopBucket {
  const taskName = trimText(event.metadata?.taskName) || trimText(event.metadata?.task) || event.summary || 'Unnamed loop';
  const bucketSeed: ModelUsageRecord = {
    provider: 'event',
    model: trimText(event.metadata?.model) || 'event',
    modelArchitecture: 'unknown',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    timestamp: event.timestamp,
    agentId: trimText(event.metadata?.agentId) || trimText(event.agentId) || 'unknown-agent',
    agent: trimText(event.metadata?.agent) || trimText(event.agentName) || trimText(event.metadata?.agentId) || trimText(event.agentId) || undefined,
    caseId: trimText(event.caseId) || 'case-unknown',
    project: trimText(event.metadata?.project) || undefined,
    taskId: trimText(event.metadata?.taskId) || undefined,
    taskName,
    sessionId: trimText(event.sessionId) || undefined,
  };
  return createBucketFromUsage(bucketSeed);
}

function chooseBestBucket(event: SafeloopStreamEvent, buckets: LoopBucket[]): LoopBucket | null {
  if (buckets.length === 0) {
    return null;
  }

  const eventSessionId = trimText(event.sessionId);
  const eventTaskId = trimText(event.metadata?.taskId);
  const eventTaskName = trimText(event.metadata?.taskName) || trimText(event.metadata?.task);
  const eventAgentId = trimText(event.metadata?.agentId) || trimText(event.agentId);
  const eventAgent = trimText(event.metadata?.agent) || trimText(event.agentName);

  const exactSession = eventSessionId ? buckets.find((bucket) => bucket.sessionId === eventSessionId) : undefined;
  if (exactSession) {
    return exactSession;
  }

  const exactTaskId = eventTaskId ? buckets.find((bucket) => bucket.taskId === eventTaskId) : undefined;
  if (exactTaskId) {
    return exactTaskId;
  }

  const exactTaskName = eventTaskName ? buckets.find((bucket) => bucket.taskName === eventTaskName) : undefined;
  if (exactTaskName) {
    return exactTaskName;
  }

  const exactAgent = eventAgentId
    ? buckets.find((bucket) => bucket.agentId === eventAgentId)
    : eventAgent
      ? buckets.find((bucket) => bucket.agent === eventAgent)
      : undefined;
  if (exactAgent) {
    return exactAgent;
  }

  return buckets[0] ?? null;
}

function addUsageToBucket(bucket: LoopBucket, record: ModelUsageRecord): void {
  bucket.usageRecords.push(record);
  bucket.inputTokens += Number(record.inputTokens || 0);
  bucket.outputTokens += Number(record.outputTokens || 0);
  bucket.totalTokens += Number(record.totalTokens || Number(record.inputTokens || 0) + Number(record.outputTokens || 0));
  bucket.estimatedCost += Number(record.estimatedCost || 0);
  bucket.models.add(trimText(record.model) || 'unknown-model');
  bucket.firstTimestamp = earliestTimestamp(bucket.firstTimestamp, record.timestamp);
  bucket.lastTimestamp = latestTimestamp(bucket.lastTimestamp, record.timestamp);
  bucket.taskId = bucket.taskId || trimText(record.taskId) || undefined;
  bucket.taskName = bucket.taskName || trimText(record.taskName) || trimText(record.taskId) || undefined;
  bucket.project = bucket.project || trimText(record.project) || undefined;
  bucket.agentId = bucket.agentId || trimText(record.agentId) || undefined;
  bucket.agent = bucket.agent || trimText(record.agent) || trimText(record.agentId) || undefined;
  bucket.sessionId = bucket.sessionId || trimText(record.sessionId) || undefined;
}

function addEventToBucket(bucket: LoopBucket, event: SafeloopStreamEvent): void {
  bucket.events.push(event);
  bucket.eventTypes.add(event.type);
  bucket.firstTimestamp = earliestTimestamp(bucket.firstTimestamp, event.timestamp);
  bucket.lastTimestamp = latestTimestamp(bucket.lastTimestamp, event.timestamp);
  bucket.taskId = bucket.taskId || trimText(event.metadata?.taskId) || undefined;
  bucket.taskName = bucket.taskName || trimText(event.metadata?.taskName) || trimText(event.metadata?.task) || event.summary || undefined;
  bucket.project = bucket.project || trimText(event.metadata?.project) || undefined;
  bucket.agentId = bucket.agentId || trimText(event.agentId) || undefined;
  bucket.agent = bucket.agent || trimText(event.agentName) || trimText(event.agentId) || undefined;
  bucket.sessionId = bucket.sessionId || trimText(event.sessionId) || undefined;
}

function deriveLoopBuckets(snapshot: DashboardSnapshot): InternalTimecardCollection {
  const usageRecords = Array.isArray(snapshot.modelUsage) ? snapshot.modelUsage : [];
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const byCaseId = new Map<string, LoopBucket[]>();
  const byKey = new Map<string, LoopBucket>();

  for (const record of usageRecords) {
    const caseId = trimText(record.caseId) || 'case-unknown';
    const key = buildLoopKey(record);
    const bucket = byKey.get(key) ?? createBucketFromUsage(record);
    if (!byKey.has(key)) {
      byKey.set(key, bucket);
      const list = byCaseId.get(caseId) ?? [];
      list.push(bucket);
      byCaseId.set(caseId, list);
    }
    addUsageToBucket(bucket, record);
  }

  for (const event of events) {
    const caseId = trimText(event.caseId) || 'case-unknown';
    let candidates = byCaseId.get(caseId) ?? [];
    let bucket = chooseBestBucket(event, candidates);

    if (!bucket) {
      bucket = createBucketFromEvent(event);
      byKey.set(bucket.key, bucket);
      candidates = byCaseId.get(caseId) ?? [];
      candidates.push(bucket);
      byCaseId.set(caseId, candidates);
    }

    addEventToBucket(bucket, event);
  }

  const all = Array.from(byKey.values())
    .map((bucket) => {
      const hasStarted = bucket.eventTypes.has('task.started');
      const hasCompleted = bucket.eventTypes.has('task.completed');
      const nowMs = Date.now();
      const lastMs = toTimestamp(bucket.lastTimestamp);
      const ageMs = lastMs > 0 ? Math.max(0, nowMs - lastMs) : Number.POSITIVE_INFINITY;
      let status: LoopStatus = 'historical';
      if (hasCompleted) {
        status = 'completed';
      } else if (hasStarted && ageMs <= LOOP_RECENT_MS) {
        status = 'running';
      } else if (hasStarted && ageMs <= LOOP_STALE_MS) {
        status = 'stale';
      }

      const approvalsRequested = bucket.events.filter((event) => event.type === 'approval.requested').length;
      const approvalsResolved = bucket.events.filter((event) => event.type === 'approval.resolved').length;
      const approvalStatus: LoopTimecard['approvalsStatus'] = (() => {
        const resolved = bucket.events.filter((event) => event.type === 'approval.resolved');
        if (resolved.some((event) => String(event.metadata?.decision || '').toLowerCase() === 'rejected')) {
          return 'rejected';
        }
        if (approvalsRequested > approvalsResolved) {
          return 'pending';
        }
        if (approvalsRequested > 0 || approvalsResolved > 0) {
          return 'approved';
        }
        return 'none';
      })();

      const firstMs = toTimestamp(bucket.firstTimestamp);
      const lastTimestamp = bucket.lastTimestamp || bucket.firstTimestamp;
      const firstTimestamp = bucket.firstTimestamp || bucket.lastTimestamp;
      const durationMs = firstMs > 0 && lastMs > 0 ? Math.max(0, lastMs - firstMs) : 0;

      return {
        key: bucket.key,
        caseId: bucket.caseId,
        taskId: bucket.taskId,
        taskName: bucket.taskName || bucket.taskId || 'Unnamed loop',
        project: bucket.project,
        agentId: bucket.agentId,
        agent: bucket.agent,
        sessionId: bucket.sessionId,
        status,
        eventCount: bucket.events.length,
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        totalTokens: bucket.totalTokens,
        estimatedCost: bucket.estimatedCost,
        durationMs,
        approvalsCount: approvalsRequested + approvalsResolved,
        approvalsStatus: approvalStatus,
        risksCount: bucket.events.filter((event) => event.type === 'risk.detected').length,
        artifactsCount: bucket.events.filter((event) => event.type === 'artifact.changed').length,
        handoffsCount: bucket.events.filter((event) => event.type === 'handoff.created').length,
        firstTimestamp,
        lastTimestamp,
        models: Array.from(bucket.models).sort(),
        _events: bucket.events,
        _usageRecords: bucket.usageRecords,
      } as InternalLoopTimecard;
    })
    .sort((a, b) => toTimestamp(b.lastTimestamp) - toTimestamp(a.lastTimestamp));

  const nowMs = Date.now();
  const bareCollection: InternalTimecardCollection = {
    all,
    current: all.filter((summary) => {
      if (summary === all[0]) {
        return true;
      }
      if (summary.status === 'running') {
        return true;
      }
      if (summary.status === 'completed') {
        return toTimestamp(summary.lastTimestamp) >= nowMs - LOOP_HISTORICAL_MS;
      }
      return false;
    }),
    historical: [],
    latest: null,
  };
  bareCollection.historical = all.filter((summary) => !bareCollection.current.some((item) => item.key === summary.key));
  bareCollection.latest = bareCollection.current[0] ?? all[0] ?? null;

  const decoratedAll = all.map((loop) => ({
    ...loop,
    ...analyzeLoopOversightImpl(loop, bareCollection),
  })) as InternalLoopTimecard[];
  const decoratedCurrent = decoratedAll.filter((summary) => bareCollection.current.some((item) => item.key === summary.key));
  const decoratedHistorical = decoratedAll.filter((summary) => bareCollection.historical.some((item) => item.key === summary.key));
  const decoratedLatest = decoratedCurrent[0] ?? decoratedAll[0] ?? null;

  return {
    all: decoratedAll,
    current: decoratedCurrent,
    historical: decoratedHistorical,
    latest: decoratedLatest,
  };
}

function stripInternalFields(summary: InternalLoopTimecard): LoopTimecard {
  const { _events: _events, _usageRecords: _usageRecords, ...rest } = summary;
  return rest;
}

function flattenSectionEvents(loops: ReadonlyArray<LoopEventSource>): SafeloopStreamEvent[] {
  const events: SafeloopStreamEvent[] = [];
  for (const loop of loops) {
    if (Array.isArray(loop._events)) {
      events.push(...loop._events);
    }
  }
  return events;
}

function buildRiskItems(loops: ReadonlyArray<LoopEventSource>): RiskItem[] {
  return flattenSectionEvents(loops)
    .filter((event) => event.type === 'risk.detected')
    .map((event) => ({
      id: event.id,
      caseId: event.caseId,
      loopKey: event.sessionId || event.caseId || event.id,
      summary: event.summary,
      timestamp: event.timestamp,
      agent: event.agentName,
      agentId: event.agentId,
      severity: (typeof event.metadata?.severity === 'string' ? event.metadata.severity : 'medium') as 'low' | 'medium' | 'high',
      mitigation: typeof event.metadata?.mitigation === 'string' ? event.metadata.mitigation : undefined,
    }))
    .sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp));
}

function buildApprovalItems(loops: ReadonlyArray<LoopEventSource>): ApprovalItem[] {
  const approvals: ApprovalItem[] = [];
  const requestedById = new Map<string, ApprovalItem>();

  for (const event of flattenSectionEvents(loops)) {
    if (event.type === 'approval.requested') {
      const item: ApprovalItem = {
        id: event.id,
        caseId: event.caseId,
        loopKey: event.sessionId || event.caseId || event.id,
        summary: event.summary,
        timestamp: event.timestamp,
        agent: event.agentName,
        agentId: event.agentId,
        approver: trimText(event.metadata?.approver) || undefined,
        reason: trimText(event.metadata?.reason) || undefined,
        status: 'pending',
      };
      approvals.push(item);
      requestedById.set(event.id, item);
      continue;
    }

    if (event.type === 'approval.resolved') {
      const approvalId = trimText(event.metadata?.approvalId);
      let target = approvalId ? requestedById.get(approvalId) : undefined;
      if (!target) {
        for (let index = approvals.length - 1; index >= 0; index -= 1) {
          if (approvals[index].status === 'pending') {
            target = approvals[index];
            break;
          }
        }
      }
      if (!target) {
        target = {
          id: event.id,
          caseId: event.caseId,
          loopKey: event.sessionId || event.caseId || event.id,
          summary: event.summary,
          timestamp: event.timestamp,
          agent: event.agentName,
          agentId: event.agentId,
          status: 'pending',
        };
        approvals.push(target);
      }
      target.status = String(event.metadata?.decision || '').toLowerCase() === 'rejected' ? 'rejected' : 'approved';
      target.approver = trimText(event.metadata?.approver) || target.approver;
      target.timestamp = event.timestamp;
    }
  }

  return approvals.sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp));
}

function buildArtifactItems(loops: ReadonlyArray<LoopEventSource>): ArtifactItem[] {
  return flattenSectionEvents(loops)
    .filter((event) => event.type === 'artifact.changed')
    .map((event) => ({
      id: event.id,
      caseId: event.caseId,
      loopKey: event.sessionId || event.caseId || event.id,
      summary: event.summary,
      timestamp: event.timestamp,
      agent: event.agentName,
      agentId: event.agentId,
      path: trimText(event.metadata?.path) || undefined,
    }))
    .sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp));
}

function buildHandoffItems(loops: ReadonlyArray<LoopEventSource>): HandoffItem[] {
  return flattenSectionEvents(loops)
    .filter((event) => event.type === 'handoff.created')
    .map((event) => ({
      id: event.id,
      caseId: event.caseId,
      loopKey: event.sessionId || event.caseId || event.id,
      summary: event.summary,
      timestamp: event.timestamp,
      agent: event.agentName,
      agentId: event.agentId,
      from: trimText(event.metadata?.from) || undefined,
      to: trimText(event.metadata?.to) || undefined,
    }))
    .sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp));
}

const OVERSIGHT_COST_THRESHOLD = 0.02;
const OVERSIGHT_TOKEN_THRESHOLD = 50000;
const OVERSIGHT_DURATION_THRESHOLD_MS = 90 * 60 * 1000;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function collectLoopFeedback(loops: ReadonlyArray<LoopEventSource>): LoopFeedbackSummary {
  const feedbackEvents = flattenSectionEvents(loops).filter((event) => event.type === 'feedback.recorded');
  const items = feedbackEvents.map((event) => ({
    feedbackId: asText(event.metadata?.feedbackId) || undefined,
    targetType: (asText(event.metadata?.targetType) as LoopFeedbackItem['targetType']) || 'loop',
    targetEventId: asText(event.metadata?.targetEventId) || undefined,
    rating: (asText(event.metadata?.rating) as LoopFeedbackItem['rating']) || 'neutral',
    score: typeof event.metadata?.score === 'number' ? event.metadata.score : undefined,
    labels: Array.isArray(event.metadata?.labels) ? (event.metadata.labels.filter((label): label is string => typeof label === 'string').map((label) => label.trim()).filter(Boolean)) : [],
    comment: asText(event.metadata?.comment) || event.summary,
    reviewer: asText(event.metadata?.reviewer) || undefined,
    timestamp: asText(event.metadata?.timestamp) || event.timestamp,
  }));
  const positiveCount = items.filter((item) => item.rating === 'positive').length;
  const negativeCount = items.filter((item) => item.rating === 'negative').length;
  const scoredItems = items.filter((item) => typeof item.score === 'number');
  const averageScore = scoredItems.length > 0
    ? scoredItems.reduce((sum, item) => sum + Number(item.score || 0), 0) / scoredItems.length
    : null;
  const latestFeedback = items.length > 0 ? [...items].sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp))[0] : null;
  const needsReviewFromFeedback = negativeCount > 0 && (averageScore === null || averageScore <= 3.5 || negativeCount > positiveCount);

  return {
    feedbackCount: items.length,
    averageScore,
    positiveCount,
    negativeCount,
    latestFeedback,
    needsReviewFromFeedback,
  };
}

function collectLoopExplainability(loops: ReadonlyArray<LoopEventSource>): LoopExplainabilitySummary {
  const events = flattenSectionEvents(loops);
  const decisions = events.filter((event) => event.type === 'decision.made');
  const explained = decisions.filter((event) => Boolean(trimText(event.metadata?.rationale) || trimText(event.metadata?.explanation) || trimText(event.metadata?.reason)));
  const highRiskWithoutExplanation = decisions.filter((event) => {
    const severity = trimText(event.metadata?.severity) || trimText(event.metadata?.risk);
    return (severity === 'high' || severity === 'critical') && !Boolean(trimText(event.metadata?.rationale) || trimText(event.metadata?.explanation) || trimText(event.metadata?.reason));
  });
  const approvalRequestsWithoutReason = events.filter((event) => event.type === 'approval.requested' && !trimText(event.metadata?.reason));
  const completedWithoutReport = events.filter((event) => event.type === 'task.completed' && !events.some((candidate) => candidate.type === 'report.generated'));
  const missingExplanationCount = (decisions.length - explained.length) + highRiskWithoutExplanation.length + approvalRequestsWithoutReason.length + completedWithoutReport.length;
  return {
    decisionCount: decisions.length,
    explainedDecisionCount: explained.length,
    explanationCoveragePercent: decisions.length === 0 ? 100 : Math.max(0, Math.round((explained.length / decisions.length) * 100)),
    missingExplanationCount: Math.max(0, missingExplanationCount),
  };
}

function analyzeLoopOversight(loop: InternalLoopTimecard, collection: InternalTimecardCollection): Pick<InternalLoopTimecard, 'oversightScore' | 'oversightLevel' | 'recommendedAction' | 'warnings' | 'anomalies' | 'explainability' | 'feedback'> {
  const warnings: OversightIssue[] = [];
  const anomalies: OversightIssue[] = [];
  const events = loop._events;
  const usageRecords = loop._usageRecords;
  const nowMs = Date.now();
  const lastMs = toTimestamp(loop.lastTimestamp);
  const ageMs = lastMs > 0 ? Math.max(0, nowMs - lastMs) : Number.POSITIVE_INFINITY;
  const staleByAge = loop.status === 'stale' || (loop.status !== 'historical' && ageMs > LOOP_STALE_MS);
  const durationTooLong = loop.durationMs > OVERSIGHT_DURATION_THRESHOLD_MS;
  const tokenUsage = loop.totalTokens > OVERSIGHT_TOKEN_THRESHOLD;
  const costTooHigh = loop.estimatedCost > OVERSIGHT_COST_THRESHOLD;
  const unresolvedApprovals = loop.approvalsStatus === 'pending' || events.some((event) => event.type === 'approval.requested') && !events.some((event) => event.type === 'approval.resolved');
  const highRiskWithoutMitigation = events.some((event) => event.type === 'risk.detected' && asText(event.metadata?.severity) === 'high' && !asText(event.metadata?.mitigation));
  const missingAttribution = !loop.project || !loop.taskId || !loop.caseId || !loop.agentId;
  const modelUsageWithoutCost = usageRecords.some((record) => !(Number(record.estimatedCost) > 0));
  const repeatedFailures = events.filter((event) => String(event.type).includes('fail')).length;
  const repeatedProviderRetries = events.filter((event) => String(event.type).toLowerCase().includes('retry') || Number(event.metadata?.retryCount ?? event.metadata?.retries ?? 0) > 1).length;
  const repeatedPatchNoops = events.filter((event) => String(event.type).toLowerCase().includes('patch') && String(event.type).toLowerCase().includes('noop') || String(event.summary).toLowerCase().includes('no-op') || String(event.summary).toLowerCase().includes('noop')).length;
  const artifactChangedWithoutCompletion = events.some((event) => event.type === 'artifact.changed') && !events.some((event) => event.type === 'task.completed');
  const taskCompletedWithoutReport = events.some((event) => event.type === 'task.completed') && !events.some((event) => event.type === 'report.generated');
  const historicalActives = collection.historical.filter((item) => toTimestamp(item.lastTimestamp) > 0 && item.status !== 'historical' && (nowMs - toTimestamp(item.lastTimestamp)) > LOOP_HISTORICAL_MS).length;

  const explainability = collectLoopExplainability([loop]);
  const feedback = collectLoopFeedback([loop]);

  const decisionMissingExplanation = explainability.missingExplanationCount > 0;
  if (decisionMissingExplanation) {
    warnings.push({ code: 'missing_explanation', severity: 'warning', message: 'Decision explainability is incomplete.' });
  }
  if (explainability.decisionCount > 0 && explainability.explainedDecisionCount === 0) {
    anomalies.push({ code: 'decision_without_rationale', severity: 'anomaly', message: 'Decision.made events do not include rationale or explanation.' });
  }
  if (highRiskWithoutMitigation) {
    anomalies.push({ code: 'high_risk_without_mitigation', severity: 'anomaly', message: 'High-risk work has no mitigation recorded.' });
  }
  if (staleByAge) {
    warnings.push({ code: 'stale_loop', severity: 'warning', message: 'Loop is stale and should be reviewed.' });
  }
  if (durationTooLong) {
    warnings.push({ code: 'duration_threshold_exceeded', severity: 'warning', message: 'Loop duration exceeds the active threshold.' });
  }
  if (tokenUsage) {
    warnings.push({ code: 'token_threshold_exceeded', severity: 'warning', message: 'Token usage exceeds the loop threshold.' });
  }
  if (costTooHigh) {
    warnings.push({ code: 'cost_threshold_exceeded', severity: 'warning', message: 'Cost exceeds the loop threshold.' });
  }
  if (unresolvedApprovals) {
    anomalies.push({ code: 'unresolved_approval', severity: 'anomaly', message: 'An approval remains unresolved.' });
  }
  if (missingAttribution) {
    anomalies.push({ code: 'missing_attribution', severity: 'anomaly', message: 'Project or task attribution is missing.' });
  }
  if (modelUsageWithoutCost) {
    warnings.push({ code: 'model_usage_without_cost', severity: 'warning', message: 'Model usage is missing an estimated cost.' });
  }
  if (repeatedFailures > 1) {
    anomalies.push({ code: 'repeated_failures', severity: 'anomaly', message: 'Repeated failures were detected in the loop.' });
  }
  if (repeatedProviderRetries > 1) {
    warnings.push({ code: 'provider_retries', severity: 'warning', message: 'Repeated provider retries were detected.' });
  }
  if (repeatedPatchNoops > 0) {
    warnings.push({ code: 'patch_noop', severity: 'warning', message: 'Patch no-op errors were detected.' });
  }
  if (artifactChangedWithoutCompletion) {
    warnings.push({ code: 'artifact_without_completion', severity: 'warning', message: 'Artifact changes were recorded without loop completion.' });
  }
  if (taskCompletedWithoutReport) {
    warnings.push({ code: 'completion_without_report', severity: 'warning', message: 'Task completed without a report or output summary.' });
  }
  if (historicalActives > 2) {
    anomalies.push({ code: 'historical_loops_marked_active', severity: 'anomaly', message: 'Too many historical loops are still marked active.' });
  }
  if (feedback.needsReviewFromFeedback) {
    warnings.push({ code: 'feedback_needs_review', severity: 'warning', message: 'Feedback indicates the loop needs review.' });
  }

  const scoreDeductions = [
    costTooHigh ? 15 : 0,
    tokenUsage ? 12 : 0,
    durationTooLong ? 10 : 0,
    staleByAge ? 10 : 0,
    repeatedFailures > 1 ? 15 : 0,
    repeatedProviderRetries > 1 ? 10 : 0,
    repeatedPatchNoops > 0 ? 10 : 0,
    unresolvedApprovals ? 15 : 0,
    highRiskWithoutMitigation ? 15 : 0,
    artifactChangedWithoutCompletion ? 10 : 0,
    taskCompletedWithoutReport ? 10 : 0,
    missingAttribution ? 20 : 0,
    modelUsageWithoutCost ? 10 : 0,
    historicalActives > 2 ? 15 : 0,
    explainability.decisionCount > 0 && explainability.explainedDecisionCount === 0 ? 10 : 0,
    decisionMissingExplanation ? 5 : 0,
    feedback.needsReviewFromFeedback ? 5 : 0,
  ].reduce((sum, value) => sum + value, 0);

  const oversightScore = Math.max(0, 100 - scoreDeductions);
  const oversightLevel: OversightLevel = oversightScore >= 80 ? 'healthy' : oversightScore >= 60 ? 'watch' : oversightScore >= 40 ? 'needs_review' : 'critical';
  const recommendedAction: OversightRecommendedAction = (() => {
    if (missingAttribution) {
      return 'fix_attribution';
    }
    if (oversightLevel === 'critical' || repeatedFailures > 1 || repeatedPatchNoops > 0 || historicalActives > 2) {
      return 'stop_or_handoff';
    }
    if (unresolvedApprovals || highRiskWithoutMitigation) {
      return 'approve_required';
    }
    if (staleByAge || durationTooLong) {
      return 'investigate_stale_loop';
    }
    if (costTooHigh || tokenUsage || modelUsageWithoutCost) {
      return 'investigate_cost';
    }
    if (decisionMissingExplanation) {
      return 'add_explanation';
    }
    if (warnings.length > 0 || anomalies.length > 0) {
      return 'review';
    }
    return 'continue';
  })();

  return {
    oversightScore,
    oversightLevel,
    recommendedAction,
    warnings,
    anomalies,
    explainability,
    feedback,
  };
}

function readinessFromLoops(loops: ReadonlyArray<LoopEventSource>): ReadinessScoreResult {
  const events = flattenSectionEvents(loops);
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
    .map((event) => trimText(event.metadata?.path) || event.summary);

  const handoffs = events
    .filter((event) => event.type === 'handoff.created')
    .map((event) => event.summary);

  const evidence = events.map((event) => event.summary);
  const testEvents = events.filter((event) => event.type === 'test.completed');
  const testsPassed = testEvents.length === 0
    ? true
    : testEvents.every((event) => String(event.metadata?.status ?? '').toLowerCase() === 'passed');

  return calculateReadinessScore({
    risks,
    approvals,
    attachments,
    evidence,
    handoffs,
    tests: { passed: testsPassed },
  });
}

function aggregateTokens(records: ModelUsageRecord[]): TokenSection {
  const byModel: Record<string, TokenModelUsageSummary> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;

  for (const record of records) {
    const modelKey = trimText(record.model) || 'unknown-model';
    const bucket = byModel[modelKey] ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      records: 0,
    };
    bucket.inputTokens += Number(record.inputTokens || 0);
    bucket.outputTokens += Number(record.outputTokens || 0);
    bucket.totalTokens += Number(record.totalTokens || Number(record.inputTokens || 0) + Number(record.outputTokens || 0));
    bucket.estimatedCost += Number(record.estimatedCost || 0);
    bucket.records += 1;
    byModel[modelKey] = bucket;

    totalInputTokens += Number(record.inputTokens || 0);
    totalOutputTokens += Number(record.outputTokens || 0);
    totalTokens += Number(record.totalTokens || Number(record.inputTokens || 0) + Number(record.outputTokens || 0));
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    byModel,
    records: [...records].sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp)),
  };
}

function aggregateSpend(snapshot: DashboardSnapshot, latest: LoopTimecard | null, currentLoops: LoopTimecard[], allLoops: LoopTimecard[]): SpendAggregate {
  const costSummary = snapshot.costSummary;
  const latestCaseId = latest?.caseId;
  const latestTaskName = latest?.taskName;
  const latestTaskId = latest?.taskId;
  const latestAgentId = latest?.agentId;
  const latestUsageRecords = snapshot.modelUsage.filter((record) => {
    if (!latestCaseId || record.caseId !== latestCaseId) {
      return false;
    }
    const taskMatches = latestTaskId ? trimText(record.taskId) === latestTaskId : true;
    const taskNameMatches = latestTaskName ? trimText(record.taskName) === latestTaskName : true;
    const agentMatches = latestAgentId ? trimText(record.agentId) === latestAgentId : true;
    return taskMatches && taskNameMatches && agentMatches;
  });

  const latestRunCost = latestUsageRecords.reduce((sum, record) => sum + Number(record.estimatedCost || 0), 0);
  const totalLedgerCost = snapshot.modelUsage.reduce((sum, record) => sum + Number(record.estimatedCost || 0), 0);

  return {
    totalCost: Number(costSummary.totalCost || 0),
    currency: costSummary.currency || 'USD',
    usageCount: Number(costSummary.usageCount || 0),
    byAgent: { ...costSummary.costByAgent },
    byModel: { ...costSummary.costByModel },
    byProject: { ...costSummary.costByProject },
    byTask: { ...costSummary.costByTask },
    latestRunCost,
    totalLedgerCost,
  };
}

export function summarizeLoopSummaries(snapshot: DashboardSnapshot): TimecardCollection {
  return deriveLoopBuckets(snapshot);
}

export function buildMonitorViewModel(snapshot: DashboardSnapshot): MonitorViewModel {
  const collection = deriveLoopBuckets(snapshot);
  const currentLoopInternal = collection.current;
  const historicalLoopInternal = collection.historical;
  const latestRun = collection.latest ? stripInternalFields(collection.latest) : null;
  const currentReadiness = readinessFromLoops(currentLoopInternal.length > 0 ? currentLoopInternal : latestRun ? [collection.latest as InternalLoopTimecard] : []);
  const historicalReadiness = readinessFromLoops(historicalLoopInternal);

  const current = {
    latestRun,
    currentLoops: collection.current.map(stripInternalFields),
    currentReadiness,
    risks: buildRiskItems(currentLoopInternal),
    approvals: buildApprovalItems(currentLoopInternal),
    artifacts: buildArtifactItems(currentLoopInternal),
    handoffs: buildHandoffItems(currentLoopInternal),
  };

  const historical = {
    loopCount: collection.historical.length,
    eventCount: flattenSectionEvents(historicalLoopInternal).length,
    riskCount: buildRiskItems(historicalLoopInternal).length,
    readiness: historicalReadiness,
    loops: collection.historical.map(stripInternalFields),
    risks: buildRiskItems(historicalLoopInternal),
    approvals: buildApprovalItems(historicalLoopInternal),
    artifacts: buildArtifactItems(historicalLoopInternal),
    handoffs: buildHandoffItems(historicalLoopInternal),
  };

  const spend = aggregateSpend(snapshot, latestRun, current.currentLoops, historical.loops);
  const tokens = aggregateTokens(snapshot.modelUsage);
  const diagnostics: DiagnosticsSection = {
    lastPollUrl: '/api/dashboard',
    lastHttpStatus: '200 OK',
    responseKeys: [],
    lastRenderError: null,
  };
  const oversightLoopTimecards = collection.all.map(stripInternalFields);
  const oversightWarnings = collection.all.flatMap((loop) => loop.warnings);
  const oversightAnomalies = collection.all.flatMap((loop) => loop.anomalies);
  const oversightExplainability = collection.all.reduce(
    (acc, loop) => ({
      decisionCount: acc.decisionCount + loop.explainability.decisionCount,
      explainedDecisionCount: acc.explainedDecisionCount + loop.explainability.explainedDecisionCount,
      explanationCoveragePercent: acc.decisionCount + loop.explainability.decisionCount === 0
        ? 100
        : Math.max(0, Math.round(((acc.explainedDecisionCount + loop.explainability.explainedDecisionCount) / (acc.decisionCount + loop.explainability.decisionCount)) * 100)),
      missingExplanationCount: acc.missingExplanationCount + loop.explainability.missingExplanationCount,
    }),
    {
      decisionCount: 0,
      explainedDecisionCount: 0,
      explanationCoveragePercent: 100,
      missingExplanationCount: 0,
    },
  );
  const oversightFeedback = collection.all.reduce(
    (acc, loop) => {
      const nextCount = acc.feedbackCount + loop.feedback.feedbackCount;
      const nextScoreTotal = (acc.averageScore ?? 0) * acc.feedbackCount + (loop.feedback.averageScore ?? 0) * loop.feedback.feedbackCount;
      const nextAverage = nextCount > 0 ? nextScoreTotal / nextCount : null;
      return {
        feedbackCount: nextCount,
        averageScore: nextAverage,
        positiveCount: acc.positiveCount + loop.feedback.positiveCount,
        negativeCount: acc.negativeCount + loop.feedback.negativeCount,
        latestFeedback:
          !acc.latestFeedback || toTimestamp(loop.feedback.latestFeedback?.timestamp ?? '') >= toTimestamp(acc.latestFeedback.timestamp)
            ? loop.feedback.latestFeedback
            : acc.latestFeedback,
        needsReviewFromFeedback: acc.needsReviewFromFeedback || loop.feedback.needsReviewFromFeedback,
      };
    },
    {
      feedbackCount: 0,
      averageScore: null as number | null,
      positiveCount: 0,
      negativeCount: 0,
      latestFeedback: null as LoopFeedbackItem | null,
      needsReviewFromFeedback: false,
    },
  );
  const oversight: OversightSection = {
    summary: {
      oversightScore: latestRun?.oversightScore ?? 100,
      oversightLevel: latestRun?.oversightLevel ?? 'healthy',
      recommendedAction: latestRun?.recommendedAction ?? 'continue',
      warningCount: oversightWarnings.length,
      anomalyCount: oversightAnomalies.length,
      latestLoop: latestRun,
      loopCount: collection.all.length,
      currentLoopCount: collection.current.length,
      historicalLoopCount: collection.historical.length,
      staleLoopCount: collection.all.filter((loop) => loop.status === 'stale').length,
      needsReviewLoopCount: collection.all.filter((loop) => loop.oversightLevel !== 'healthy').length,
      explainability: oversightExplainability,
      feedback: oversightFeedback,
    },
    latestLoop: latestRun,
    loopTimecards: oversightLoopTimecards,
    warnings: oversightWarnings,
    anomalies: oversightAnomalies,
    explainability: oversightExplainability,
    feedback: oversightFeedback,
  };

  return {
    status: {
      connection: 'connected',
      lastUpdated: snapshot.lastUpdated,
      monitoredPath: snapshot.monitoredPath,
      eventCount: snapshot.eventCount,
    },
    current,
    historical,
    spend,
    tokens,
    diagnostics,
    oversight,
  };
}

export function buildMonitorDashboardPayload(snapshot: DashboardSnapshot): MonitorDashboardPayload {
  const viewModel = buildMonitorViewModel(snapshot);
  const payload: MonitorDashboardPayload = {
    ...snapshot,
    viewModel,
    oversight: viewModel.oversight,
  };
  const responseKeys = Object.keys(payload).sort();
  viewModel.diagnostics.responseKeys = responseKeys;
  return payload;
}
