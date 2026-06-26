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
  handoffSummary?: string;
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

// --- Live Activity model (new for Live Agent Activity + Handoff Flow) ---
export interface AgentStatus {
  agentId?: string;
  agent?: string;
  status: 'active' | 'idle' | 'waiting_for_approval' | 'blocked' | 'failed' | 'completed' | 'warning' | 'unknown';
  lastEventTimestamp?: string;
  details?: string;
}

export interface TokenCostPulse {
  recentTokenTotal: number;
  recentCostTotal: number;
  topCostAgent?: string;
  topCostTask?: string;
  costTrend: 'stable' | 'rising' | 'high' | 'unknown';
}

export interface LiveActivitySection {
  activeAgents: string[];
  recentActivity: SectionItem[];
  handoffFlow: HandoffDetail[];
  currentLoopState: { running: number; stale: number; completed: number };
  agentStatuses: Record<string, AgentStatus>;
  openWarnings: OversightIssue[];
  blockedOrWaitingItems: SectionItem[];
  latestDecisions: SectionItem[];
  latestApprovals: ApprovalItem[];
  latestRisks: RiskItem[];
  latestArtifacts: ArtifactItem[];
  latestFeedback: LoopFeedbackItem[];
  tokenCostPulse: TokenCostPulse;
  // session-awareness helpers for the UI
  currentSessionId?: string;
  historicalHiddenCount?: number;
  hasCurrentSession?: boolean;
}

export interface HandoffDetail {
  caseId: string;
  taskName: string;
  fromAgent?: string;
  toAgent?: string;
  fromAgentId?: string;
  toAgentId?: string;
  summary?: string;
  status?: 'pending' | 'accepted' | 'completed' | 'failed' | 'unknown';
  approvalsStatus?: string;
  artifactsCount?: number;
  timestamp?: string;
  relatedWarnings?: OversightIssue[];
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
  // active configured thresholds exposed for visibility
  config?: Record<string, unknown> | undefined;
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

export type OperatorPriority = 'low' | 'medium' | 'high' | 'critical';
export type OperatorItemType = 'approval' | 'risk' | 'warning' | 'stale_loop' | 'failed_loop' | 'high_cost' | 'handoff';
export type OperatorRecommendedAction =
  | 'continue_watching'
  | 'review_pending_approval'
  | 'investigate_risk'
  | 'investigate_failed_loop'
  | 'review_stale_loop'
  | 'check_token_cost'
  | 'resolve_handoff'
  | 'pause_before_next_model_call';

export interface OperatorQueueItem {
  id: string;
  priority: OperatorPriority;
  type: OperatorItemType;
  title: string;
  summary: string;
  agent?: string;
  caseId?: string;
  timestamp?: string;
  recommendedAction?: OperatorRecommendedAction;
  // operator action state (local only)
  state?: 'open' | 'acknowledged' | 'reviewed' | 'resolved';
  lastOperatorAction?: string;
  operatorNote?: string;
}

export interface OperatorSummary {
  activeAgents: number;
  activeLoops: number;
  unresolvedApprovals: number;
  openRisks: number;
  openWarnings: number;
  staleLoops: number;
  failedLoops: number;
  recentTokenTotal: number;
  recentCostTotal: number;
}

export interface OperatorConsole {
  status: 'watch' | 'review' | 'pause' | 'stop';
  reason?: string;
  summary: OperatorSummary;
  attentionQueue: OperatorQueueItem[];
  recommendedAction?: OperatorRecommendedAction;
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
  // live activity view model for interactive dashboard
  liveActivity?: LiveActivitySection;
  // operator console guidance for human operators
  operatorConsole?: OperatorConsole;
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

      const firstHandoff = bucket.events.find((e) => e.type === 'handoff.created');
      const handoffSummary = firstHandoff ? `${String(firstHandoff.metadata?.from || firstHandoff.metadata?.fromId || firstHandoff.agentName || firstHandoff.agentId)} → ${String(firstHandoff.metadata?.to || firstHandoff.metadata?.toId || '')}` : undefined;

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
        handoffSummary,
        _events: bucket.events,
        _usageRecords: bucket.usageRecords,
      } as InternalLoopTimecard;
    })
    .sort((a, b) => toTimestamp(b.lastTimestamp) - toTimestamp(a.lastTimestamp));

  const nowMs = Date.now();
  // Determine a primary session/run to present by default. Prefer explicit sessionId (runId).
  let selectedSessionId: string | undefined = undefined;
  let selectedCaseId: string | undefined = undefined;
  const latestWithSession = all.find((b) => b.sessionId && b.sessionId.trim().length > 0);
  if (latestWithSession) {
    selectedSessionId = latestWithSession.sessionId;
  } else if (all[0]) {
    // fallback to the caseId of the newest loop
    selectedCaseId = all[0].caseId;
  }

  // Build "current" as: any running loops + loops belonging to the selected session (or selected case),
  // and finally as a last resort include very recent loops.
  const currentBuckets = all.filter((summary) => {
    // always include newest item as a safe default (keeps behaviour for single-loop snapshots)
    if (summary === all[0]) return true;
    if (summary.status === 'running') return true; // preserve actively running loops
    if (selectedSessionId) return summary.sessionId === selectedSessionId;
    if (selectedCaseId) return summary.caseId === selectedCaseId && toTimestamp(summary.lastTimestamp) >= nowMs - LOOP_HISTORICAL_MS;
    // final fallback: recent loops within the recent window
    return toTimestamp(summary.lastTimestamp) >= nowMs - LOOP_RECENT_MS;
  });

  const bareCollection: InternalTimecardCollection = {
    all,
    current: currentBuckets,
    historical: [],
    latest: null,
  };

  // historical are those not selected as current
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

// Oversight analysis (explainability, feedback, scoring, stale detection)
// has been delegated to src/oversightAnalyzer.ts. The view model uses the
// analyzer via an imported function (analyzeLoopOversightImpl). This file no
// longer contains duplicate analyzer logic. See src/oversightAnalyzer.ts for
// the authoritative implementation and unit tests.

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
    // expose active oversight config (if analyzer returns it on latestRun)
    config: (latestRun as any)?.config ?? undefined,
    latestLoop: latestRun,
    loopTimecards: oversightLoopTimecards,
    warnings: oversightWarnings,
    anomalies: oversightAnomalies,
    explainability: oversightExplainability,
    feedback: oversightFeedback,
  };

  // --- Live Activity derivation (small, reversible slice) ---
  // Use current session's events as the primary recent event feed for the live panel
  const recentEvents = flattenSectionEvents(collection.current)
    .slice()
    .sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp));

  const recentActivity: SectionItem[] = recentEvents.slice(0, 50).map((e) => ({
    id: e.id,
    caseId: e.caseId,
    loopKey: e.sessionId || e.caseId || e.id,
    summary: e.summary,
    timestamp: e.timestamp,
    agent: e.agentName,
    agentId: e.agentId,
  }));

  const activeAgentsSet = new Set<string>();
  const nowMs = Date.now();
  const activeWindowMs = 5 * 60 * 1000; // 5 minutes
  for (const ev of recentEvents) {
    const agent = trimText(ev.agentName) || trimText(ev.metadata?.agent) || trimText(ev.metadata?.agentId) || '';
    if (!agent) continue;
    const age = nowMs - toTimestamp(ev.timestamp);
    if (age <= activeWindowMs) {
      activeAgentsSet.add(agent);
    }
  }
  const activeAgents = Array.from(activeAgentsSet).sort();

  // build handoff flow details (chronological)
  const rawHandoffs = buildHandoffItems(collection.current).reverse(); // chronological ascending
  const handoffFlow: HandoffDetail[] = rawHandoffs.map((h) => ({
    caseId: h.caseId || 'case-unknown',
    taskName: h.summary || 'handoff',
    fromAgent: h.from,
    toAgent: h.to,
    fromAgentId: h.agentId,
    toAgentId: undefined,
    summary: h.summary,
    status: 'pending',
    approvalsStatus: undefined,
    artifactsCount: 0,
    timestamp: h.timestamp,
    relatedWarnings: [],
  }));

  // agent status inference (simple rules)
  const agentStatuses: Record<string, AgentStatus> = {};
  const approvalItems = buildApprovalItems(collection.current);
  const riskItems = buildRiskItems(collection.current);
  const failedLoopsKeys = collection.all.filter((l) => l.status === 'stale').map((l) => l.key);

  // map last event time per agent
  const lastEventByAgent = new Map<string, string>();
  for (const ev of recentEvents) {
    const agent = trimText(ev.agentName) || trimText(ev.metadata?.agent) || trimText(ev.metadata?.agentId) || '';
    if (!agent) continue;
    const prev = lastEventByAgent.get(agent);
    if (!prev || toTimestamp(ev.timestamp) > toTimestamp(prev)) {
      lastEventByAgent.set(agent, ev.timestamp);
    }
  }

  const agentsToConsider = new Set<string>([...activeAgents, ...Array.from(lastEventByAgent.keys())]);
  for (const agent of agentsToConsider) {
    const lastTs = lastEventByAgent.get(agent) || '';
    const age = lastTs ? Date.now() - toTimestamp(lastTs) : Number.POSITIVE_INFINITY;
    let status: AgentStatus['status'] = 'unknown';
    if (age <= activeWindowMs) status = 'active';
    else if (age < 60 * 60 * 1000) status = 'idle';
    else status = 'idle';

    const waiting = approvalItems.some((a) => a.agent === agent && a.status === 'pending');
    if (waiting) status = 'waiting_for_approval';
    const hasRisk = riskItems.some((r) => r.agent === agent || r.agentId === agent);
    if (hasRisk) status = 'warning';

    agentStatuses[agent] = {
      agent,
      status,
      lastEventTimestamp: lastTs,
      details: undefined,
    };
  }

  // Ensure requesters with pending approvals are marked as waiting_for_approval
  for (const a of approvalItems) {
    if (a.status === 'pending' && a.agent) {
      const name = a.agent;
      const prev = agentStatuses[name];
      agentStatuses[name] = {
        agent: name,
        agentId: a.agentId,
        status: 'waiting_for_approval',
        lastEventTimestamp: a.timestamp,
        details: a.reason || undefined,
      } as AgentStatus;
      if (prev && prev.lastEventTimestamp && !agentStatuses[name].lastEventTimestamp) {
        agentStatuses[name].lastEventTimestamp = prev.lastEventTimestamp;
      }
    }
  }

  const openWarnings = oversightWarnings.slice(0, 20);
  const blockedOrWaitingItems: SectionItem[] = approvalItems.filter((a) => a.status === 'pending').slice(0, 20);

  const latestDecisions: SectionItem[] = recentActivity.filter((a) => String(a.summary || '').toLowerCase().includes('decision')).slice(0, 10);
  const latestApprovals = approvalItems.slice(0, 10);
  const latestRisks = buildRiskItems(collection.current).slice(0, 10);
  const latestArtifacts = buildArtifactItems(collection.current).slice(0, 10);
  const latestFeedback = collection.all.flatMap((l) => l.feedback.latestFeedback ? [l.feedback.latestFeedback] : []).slice(0, 10) as LoopFeedbackItem[];

  // token cost pulse (recent 60 minutes)
  const recentWindowMs = 60 * 60 * 1000;
  const now = Date.now();
  let recentUsage = (snapshot.modelUsage || []).filter((u) => now - toTimestamp(u.timestamp) <= recentWindowMs);

  // Prefer usage records scoped to the current session/run when available. Fall back to caseId if session-scoped
  const currentSessionIdForUsage = collection.latest?.sessionId;
  const currentCaseId = collection.latest?.caseId;
  if (currentSessionIdForUsage) {
    const sessionFiltered = recentUsage.filter((u) => trimText((u as any).sessionId) === currentSessionIdForUsage);
    if (sessionFiltered.length > 0) {
      recentUsage = sessionFiltered;
    } else if (currentCaseId) {
      const caseFiltered = recentUsage.filter((u) => trimText(u.caseId) === currentCaseId);
      if (caseFiltered.length > 0) recentUsage = caseFiltered;
    }
  }

  const recentTokenTotal = recentUsage.reduce((s, r) => s + Number(r.totalTokens || Number(r.inputTokens || 0) + Number(r.outputTokens || 0)), 0);
  const recentCostTotal = recentUsage.reduce((s, r) => s + Number(r.estimatedCost || 0), 0);
  const topCostAgent = Object.keys(spend.byAgent || {}).sort((a, b) => (spend.byAgent[b] || 0) - (spend.byAgent[a] || 0))[0];
  const topCostTask = Object.keys(spend.byTask || {}).sort((a, b) => (spend.byTask[b] || 0) - (spend.byTask[a] || 0))[0];
  const costTrend: TokenCostPulse['costTrend'] = recentCostTotal > (spend.latestRunCost || 0) ? 'rising' : 'stable';

  const tokenCostPulse: TokenCostPulse = {
    recentTokenTotal,
    recentCostTotal,
    topCostAgent,
    topCostTask,
    costTrend,
  };

  // --- Operator console derivation (guidance only) ---
  const unresolvedApprovalsCount = approvalItems.filter((a) => a.status === 'pending').length;
  const openRisksCount = riskItems.length + oversightAnomalies.length;
  const openWarningsCount = oversightWarnings.length;
  const staleLoopsCount = collection.all.filter((l) => l.status === 'stale').length;
  const failedLoopsCount = collection.all.filter((l) => l.oversightLevel === 'critical').length;

  const summary: OperatorSummary = {
    activeAgents: activeAgents.length,
    activeLoops: collection.current.length,
    unresolvedApprovals: unresolvedApprovalsCount,
    openRisks: openRisksCount,
    openWarnings: openWarningsCount,
    staleLoops: staleLoopsCount,
    failedLoops: failedLoopsCount,
    recentTokenTotal,
    recentCostTotal,
  };

  const attentionQueue: OperatorQueueItem[] = [];

  // default attention item state to 'open' and then apply any local operator events
  // operator.action.recorded events in the snapshot.events will update matching items
  // This keeps the model read-only and reflects local operator activity.
  // We'll apply defaults after building the queue (below) — see processing block inserted later.

  // unresolved approvals -> medium/high
  for (const a of approvalItems.slice(0, 20)) {
    if (a.status === 'pending') {
      attentionQueue.push({
        id: a.id,
        priority: unresolvedApprovalsCount > 5 ? 'high' : 'medium',
        type: 'approval',
        title: `Approval: ${a.summary}`,
        summary: a.reason || a.summary,
        agent: a.agent,
        caseId: a.caseId,
        timestamp: a.timestamp,
        recommendedAction: 'review_pending_approval',
      });
    }
  }

  // risks & warnings -> high
  for (const r of oversightWarnings.slice(0, 20)) {
    attentionQueue.push({
      id: r.code || `risk-${Math.random().toString(36).slice(2, 8)}`,
      priority: 'high',
      type: 'warning',
      title: `Warning: ${r.code}`,
      summary: r.message,
      recommendedAction: 'investigate_risk',
    });
  }
  for (const a of oversightAnomalies.slice(0, 20)) {
    attentionQueue.push({
      id: a.code || `anomaly-${Math.random().toString(36).slice(2, 8)}`,
      priority: 'high',
      type: 'risk',
      title: `Anomaly: ${a.code}`,
      summary: a.message,
      recommendedAction: 'investigate_risk',
    });
  }

  // stale loops -> high
  for (const s of collection.all.filter((l) => l.status === 'stale').slice(0, 20)) {
    attentionQueue.push({
      id: s.key,
      priority: 'high',
      type: 'stale_loop',
      title: `Stale loop: ${s.taskName}`,
      summary: s.handoffSummary || `${s.eventCount} events`,
      agent: s.agent,
      caseId: s.caseId,
      timestamp: s.lastTimestamp,
      recommendedAction: 'review_stale_loop',
    });
  }

  // failed loops -> high
  for (const f of collection.all.filter((l) => l.oversightLevel === 'critical').slice(0, 20)) {
    attentionQueue.push({
      id: f.key,
      priority: 'high',
      type: 'failed_loop',
      title: `Failed loop: ${f.taskName}`,
      summary: f.handoffSummary || `${f.eventCount} events`,
      agent: f.agent,
      caseId: f.caseId,
      timestamp: f.lastTimestamp,
      recommendedAction: 'investigate_failed_loop',
    });
  }

  // handoff pending -> medium
  for (const h of handoffFlow.slice(0, 20)) {
    if (h.status === 'pending' || h.status === 'unknown') {
      attentionQueue.push({
        id: h.caseId + '::' + (h.taskName || 'handoff'),
        priority: 'medium',
        type: 'handoff',
        title: `Handoff: ${h.taskName}`,
        summary: h.summary || '',
        agent: h.fromAgent || h.toAgent,
        caseId: h.caseId,
        timestamp: h.timestamp,
        recommendedAction: 'resolve_handoff',
      });
    }
  }

  // token/cost -> medium/high if above threshold
  const highCostThreshold = Math.max(10, (spend.latestRunCost || 0) * 2);
  if (recentCostTotal >= highCostThreshold) {
    attentionQueue.push({
      id: `cost-${Date.now()}`,
      priority: recentCostTotal > highCostThreshold * 2 ? 'high' : 'medium',
      type: 'high_cost',
      title: `High token cost: ${recentCostTotal}`,
      summary: `Top agent: ${topCostAgent || 'n/a'} task: ${topCostTask || 'n/a'}`,
      recommendedAction: 'check_token_cost',
    });
  }

  // finalize attentionQueue: default each item to 'open' then apply local operator events
  for (const it of attentionQueue) {
    if (!it.state) it.state = 'open';
  }

  // apply operator.action.recorded events (local-only ledger) to attention queue items
  const operatorEvents = (snapshot.events || []).filter((e) => String(e.type) === 'operator.action.recorded');
  for (const ev of operatorEvents) {
    try {
      const meta = ev.metadata || {};
      const action = String(meta.action || '').toLowerCase();
      const targetId = String(meta.targetId || '');
      const caseId = String(meta.caseId || '') || undefined;
      const note = typeof meta.note === 'string' ? meta.note : undefined;
      // match by id or caseId
      const match = attentionQueue.find((q) => q.id === targetId || q.caseId === targetId || (caseId && q.caseId === caseId));
      if (match) {
        if (action === 'acknowledged') match.state = 'acknowledged';
        else if (action === 'reviewed') match.state = 'reviewed';
        else if (action === 'resolved') match.state = 'resolved';
        match.lastOperatorAction = action || undefined;
        if (note) match.operatorNote = note;
      }
    } catch (err) {
      // ignore malformed operator events
    }
  }

  // compute status
  let status: OperatorConsole['status'] = 'watch';
  let reason = '';
  if (failedLoopsCount > 0 || oversight.summary.oversightLevel === 'critical') {
    status = 'stop';
    reason = 'Critical oversight detected';
  } else if (failedLoopsCount > 0 || (staleLoopsCount > 0 && recentCostTotal > (spend.latestRunCost || 0))) {
    status = 'pause';
    reason = 'Failed or costly stale loops detected';
  } else if (unresolvedApprovalsCount > 0 || openRisksCount > 0 || attentionQueue.length > 0) {
    status = 'review';
    reason = 'Pending approvals, risks, or warnings need attention';
  } else {
    status = 'watch';
    reason = 'No major issues detected';
  }

  const operatorConsole: OperatorConsole = {
    status,
    reason,
    summary,
    attentionQueue: attentionQueue.sort((a, b) => {
      const order: Record<OperatorPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] || 3) - (order[b.priority] || 3);
    }),
    recommendedAction: attentionQueue.length === 0 ? 'continue_watching' : attentionQueue[0].recommendedAction,
  };

  const historicalHiddenCount = flattenSectionEvents(collection.historical).length;
  const currentSessionId = collection.latest?.sessionId ?? undefined;
  const hasCurrentSession = Boolean(currentSessionId) || collection.current.some((c) => c.status === 'running');

  const liveActivity: LiveActivitySection = {
    activeAgents,
    recentActivity,
    handoffFlow,
    currentLoopState: { running: collection.current.filter((c) => c.status === 'running').length, stale: collection.all.filter((c) => c.status === 'stale').length, completed: collection.all.filter((c) => c.status === 'completed').length },
    agentStatuses,
    openWarnings,
    blockedOrWaitingItems,
    latestDecisions,
    latestApprovals,
    latestRisks,
    latestArtifacts,
    latestFeedback,
    tokenCostPulse,
    currentSessionId,
    historicalHiddenCount,
    hasCurrentSession,
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
    operatorConsole,
    liveActivity,
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
