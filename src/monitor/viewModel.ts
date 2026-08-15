import { calculateReadinessScore, type ReadinessScoreResult } from '../readinessScore';
import type { DashboardRuntimeControl } from './runtimeControls';
import type { FlightRecorderIndex, FlightRecorderSession } from '../runtime/flightRecorder';
import type { DashboardSnapshot } from './dashboardData';
import type { OperationalTelemetrySnapshot } from '../runtime/operationalTelemetry';
import type { EventReadDiagnostics, SafeloopStreamEvent } from '../eventStream';
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
  pricingAvailable: boolean;
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
  eventType?: string;
  metadata?: Record<string, unknown>;
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
  pricingAvailable: boolean;
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
  isHistoricalOnly?: boolean;
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
  pricingAvailable: boolean;
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
  eventRead?: EventReadDiagnostics;
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
  runtimeControls: DashboardRuntimeControl[];
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
  // circuit graph for agent topology visualization
  circuitGraph?: CircuitGraph;
  // billable agent timecard summary
  timecardSummary?: BillableTimecardSummary;
  // deployment metadata for local/cloud mode awareness
  deployment?: SafeLoopDeploymentMetadata;
  // Operational health supplied by the runtime telemetry model when available.
  operationalHealth?: OperationalTelemetrySnapshot;
  // Flight Recorder session summaries and latest-session detail projected from the runtime work graph
  flightRecorder?: FlightRecorderIndex;
  flightRecorderDetail?: FlightRecorderSession;
}

// --- Deployment Metadata types ---
export type SafeLoopDeploymentMode = 'local' | 'cloud' | 'unknown';

export interface SafeLoopDeploymentMetadata {
  mode: SafeLoopDeploymentMode;
  label: string;
  instanceId?: string;
  orgId?: string;
  projectId?: string;
  dataResidency: 'local' | 'cloud' | 'hybrid' | 'unknown';
  transport: 'polling' | 'sse' | 'websocket' | 'unknown';
}

// --- Billable Agent Timecard types ---
export type BillableTimecardStatus = 'running' | 'completed' | 'stale' | 'failed' | 'unknown';

export interface BillableAgentTimecard {
  id: string;
  sessionId?: string;
  caseId?: string;
  taskId?: string;
  taskName?: string;
  agentId?: string;
  agentName?: string;
  project?: string;
  status: BillableTimecardStatus;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  handoffCount: number;
  approvalCount: number;
  artifactCount: number;
  riskCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  pricingAvailable: boolean;
  billableCandidate: boolean;
  billableReason?: string;
}

export interface BillableTimecardSummary {
  current: BillableAgentTimecard[];
  historical: BillableAgentTimecard[];
  totals: {
    currentCount: number;
    historicalCount: number;
    billableCandidateCount: number;
    totalDurationMs: number;
    totalTokens: number;
    totalEstimatedCost: number;
    pricingAvailable: boolean;
  };
}

// --- Circuit Graph types for Agent Circuit Map visualization ---
export type CircuitNodeType = 'agent' | 'model' | 'human' | 'tool' | 'external';
export type CircuitNodeStatus = 'active' | 'idle' | 'waiting' | 'blocked' | 'completed' | 'unknown';
export type CircuitEdgeType = 'handoff' | 'model_call' | 'approval_gate' | 'artifact';
export type CircuitEdgeStatus = 'active' | 'completed' | 'pending' | 'failed' | 'unknown';

export interface CircuitNode {
  id: string;
  label: string;
  type: CircuitNodeType;
  status: CircuitNodeStatus;
  lastEventTimestamp?: string;
  tokenCount?: number;
  costTotal?: number;
  pricingAvailable?: boolean;
}

export interface CircuitEdge {
  id: string;
  from: string;
  to: string;
  type: CircuitEdgeType;
  status: CircuitEdgeStatus;
  timestamp?: string;
  summary?: string;
}

export interface CircuitGraph {
  nodes: CircuitNode[];
  edges: CircuitEdge[];
  currentFlowPath: string[];
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
  pricingAvailable: boolean;
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
    pricingAvailable: false,
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
  // Use the explicit pricingAvailable field from the usage record.
  // If any record in the bucket has pricing available, the bucket is considered priced.
  if (record.pricingAvailable === true) {
    bucket.pricingAvailable = true;
  }
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
        pricingAvailable: bucket.pricingAvailable,
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
  // Important: prefer a sessionId from an actively running loop if one exists so we don't
  // accidentally promote a completed/historical newest loop into "current" when a
  // running loop is a better candidate.
  let selectedSessionId: string | undefined = undefined;
  let selectedCaseId: string | undefined = undefined;
  // If there's a running loop with a sessionId, prefer that session. Otherwise fall back to the newest sessionId seen.
  const runningWithSession = all.find((b) => b.status === 'running' && b.sessionId && b.sessionId.trim().length > 0);
  if (runningWithSession) {
    selectedSessionId = runningWithSession.sessionId;
  } else {
    // Only promote a non-running sessionId into the selectedSessionId when it's recent enough
    // to be considered "current". Otherwise, leave selectedSessionId undefined so we can
    // rely on recency windows and avoid presenting old historical sessions as active.
    const latestWithSession = all.find((b) => b.sessionId && b.sessionId.trim().length > 0);
    if (latestWithSession && toTimestamp(latestWithSession.lastTimestamp) >= nowMs - LOOP_RECENT_MS) {
      selectedSessionId = latestWithSession.sessionId;
    } else if (all[0]) {
      // fallback to the caseId of the newest loop (used for candidate by case)
      selectedCaseId = all[0].caseId;
    }
  }

  // Build "current" as: any running loops + loops belonging to the selected session (or selected case),
  // and finally as a last resort include very recent loops.
  // Build currentBuckets with priority:
  // 1. running loops (if any)
  // 2. selected sessionId (if provided)
  // 3. selected caseId within the historical window
  // 4. recency fallback
  // candidate buckets based on session/case/recency
  const runningBuckets = all.filter((s) => s.status === 'running');
  const candidateBuckets = all.filter((s) => {
    // If we have a selectedSessionId, behave differently depending on whether that session
    // came from a running loop. When the selected session is from an active running loop,
    // include other very recent loops so the UI can show the running session alongside
    // the newest completed runs. If the selected session is the newest session (no running),
    // keep the selection narrow and only include that session so older sessions become historical.
    if (selectedSessionId) {
      if (runningWithSession && selectedSessionId === runningWithSession.sessionId) {
        // Prevent promoting the single newest historical loop into current when a running loop exists.
        // Special-case: if the newest loop (all[0]) is a completed historical run with generic events and
        // a running loop is present, do not promote that newest historical loop into currentBuckets.
        if (all[0] && all[0].key === s.key && runningBuckets.length > 0 && s.status === 'completed') {
          // if the newest loop has more than one event (indicating a finished historical run with activity),
          // prefer not to promote it into current when a running loop exists.
          if (Array.isArray((s as any)._events) && (s as any)._events.length > 1) return false;
        }
        return s.sessionId === selectedSessionId || toTimestamp(s.lastTimestamp) >= nowMs - LOOP_RECENT_MS;
      }
      return s.sessionId === selectedSessionId;
    }
    if (selectedCaseId) return s.caseId === selectedCaseId && toTimestamp(s.lastTimestamp) >= nowMs - LOOP_HISTORICAL_MS;
    return toTimestamp(s.lastTimestamp) >= nowMs - LOOP_RECENT_MS;
  });

  // Always include running buckets, and also include candidates (de-duplicated, running first)
  const runningKeys = new Set(runningBuckets.map((r) => r.key));
  let currentBuckets: InternalLoopTimecard[] = [];
  if (runningBuckets.length > 0) {
    currentBuckets = [...runningBuckets, ...candidateBuckets.filter((c) => !runningKeys.has(c.key))];
  } else {
    currentBuckets = candidateBuckets;
  }

  // Safety net: if nothing qualified as "current", promote the newest loop as a last resort
  // for display/readiness compatibility. The UI layer will detect when this
  // fallback was used and mark the live view as historical-only so it is not
  // presented as an active session.
  if (currentBuckets.length === 0 && all.length > 0) {
    currentBuckets.push(all[0]);
  }

  const bareCollection: InternalTimecardCollection = {
    all,
    current: currentBuckets,
    historical: [],
    latest: null,
  };

  // historical are those not selected as current
  bareCollection.historical = all.filter((summary) => !bareCollection.current.some((item) => item.key === summary.key));
  // Prefer an actively running loop as the latest run when available, otherwise fall back to the first current.
  // If neither exists, use the newest overall as a last-resort latest (but note: current may be empty)
  const latestCandidate = bareCollection.current.find((c) => c.status === 'running') ?? bareCollection.current[0] ?? null;
  bareCollection.latest = latestCandidate ?? (all[0] ?? null);

  const decoratedAll = all.map((loop) => ({
    ...loop,
    ...analyzeLoopOversightImpl(loop, bareCollection),
  })) as InternalLoopTimecard[];
  const decoratedCurrent = decoratedAll.filter((summary) => bareCollection.current.some((item) => item.key === summary.key));
  const decoratedHistorical = decoratedAll.filter((summary) => bareCollection.historical.some((item) => item.key === summary.key));
  const decoratedLatest = decoratedCurrent.find((c) => c.status === 'running') ?? decoratedCurrent[0] ?? decoratedAll[0] ?? null;

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
  const pricingAvailable = snapshot.modelUsage.some((record) => record.pricingAvailable === true);

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
    pricingAvailable,
  };
}

export function summarizeLoopSummaries(snapshot: DashboardSnapshot): TimecardCollection {
  return deriveLoopBuckets(snapshot);
}

export function buildMonitorViewModel(snapshot: DashboardSnapshot): MonitorViewModel {
  const collection = deriveLoopBuckets(snapshot);
  const currentLoopInternal = collection.current;
  const historicalLoopInternal = collection.historical;

  // If the view is historical-only, don't expose the current loops as active in the
  // current section. We still keep a latest candidate for readiness calculations
  // (fall-back), but the UI should render historical-only cues instead of an active session.
  const latestRun = collection.latest ?? null;
  const currentReadiness = readinessFromLoops(
    ! (collection.current.length === 0 && collection.all.length > 0 && collection.current.length > 0)
      ? (currentLoopInternal.length > 0 ? currentLoopInternal : latestRun ? [collection.latest as InternalLoopTimecard] : [])
      : []
  );
  const historicalReadiness = readinessFromLoops(historicalLoopInternal);

  const current = {
    latestRun: null as LoopTimecard | null,
    currentLoops: [] as LoopTimecard[],
    currentReadiness,
    risks: [] as RiskItem[],
    approvals: [] as ApprovalItem[],
    artifacts: [] as ArtifactItem[],
    handoffs: [] as HandoffItem[],
  } as any;

  // Populate current section only when not historical-only (the UI will rely on
  // liveActivity.isHistoricalOnly to decide whether to present this as active).
  const fallbackUsedLocal =
    collection.current.length > 0 &&
    collection.all.length > 0 &&
    collection.current.every((c) => c.key === collection.all[0].key) &&
    collection.current.every((c) => toTimestamp(c.lastTimestamp) < Date.now() - LOOP_RECENT_MS) &&
    collection.current.every((c) => c.status !== 'running');
  const isHistoricalOnlyLocal = fallbackUsedLocal || (collection.current.length === 0 && collection.all.length > 0);

  // Always set latestRun candidate (for readiness and details) and populate
  // currentLoops. The liveActivity layer will indicate historical-only state
  // when appropriate so the UI can cue the user that the ledger is historical.
  current.latestRun = collection.latest ? stripInternalFields(collection.latest) : null;
  current.currentLoops = collection.current.map(stripInternalFields);
  current.risks = buildRiskItems(currentLoopInternal);
  current.approvals = buildApprovalItems(currentLoopInternal);
  current.artifacts = buildArtifactItems(currentLoopInternal);
  current.handoffs = buildHandoffItems(currentLoopInternal);

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
    eventRead: snapshot.eventDiagnostics,
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
    eventType: e.type,
    metadata: e.metadata,
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

  const latestDecisions: SectionItem[] = recentActivity
    .filter((a) => String(a.eventType || '').startsWith('decision.'))
    .slice(0, 10);
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
    pricingAvailable: recentUsage.some((u) => (u as any).pricingAvailable === true) || spend.pricingAvailable,
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

  // detect whether we used the last-resort fallback (newest loop promoted into current)
  const fallbackUsed =
    collection.current.length > 0 &&
    collection.all.length > 0 &&
    collection.current.every((c) => c.key === collection.all[0].key) &&
    collection.current.every((c) => toTimestamp(c.lastTimestamp) < nowMs - LOOP_RECENT_MS) &&
    collection.current.every((c) => c.status !== 'running');

  // historical-only: either there were no qualifying current loops (and no fallback),
  // or we fell back to a historical newest loop (fallbackUsed).
  const isHistoricalOnly = fallbackUsed || (collection.current.length === 0 && collection.all.length > 0);

  const historicalHiddenCount = fallbackUsed ? flattenSectionEvents(collection.all).length : flattenSectionEvents(collection.historical).length;
  const currentSessionId = isHistoricalOnly ? undefined : collection.latest?.sessionId ?? undefined;
  const hasCurrentSession = !isHistoricalOnly && (Boolean(currentSessionId) || collection.current.some((c) => c.status === 'running'));

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
    isHistoricalOnly,
  };

  // --- Circuit Graph derivation ---
  const circuitGraph = deriveCircuitGraph(
    agentStatuses,
    handoffFlow,
    recentUsage,
    approvalItems,
    isHistoricalOnly,
  );

  // --- Billable Timecard Summary ---
  const timecardSummary = deriveBillableTimecardSummary(
    current.currentLoops,
    historical.loops,
    isHistoricalOnly,
  );

  // --- Deployment Metadata ---
  const deployment = deriveDeploymentMetadata();

  return {
    // Passed through from the ledger-derived snapshot, not recomputed here:
    // the dashboard reports recorded evidence rather than deriving security
    // state of its own.
    runtimeControls: snapshot.runtimeControls ?? [],
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
    circuitGraph,
    timecardSummary,
    deployment,
  };
}


// --- Deployment Metadata derivation ---
// Reads deployment mode from environment variables with safe fallbacks.
function deriveDeploymentMetadata(): SafeLoopDeploymentMetadata {
  const rawMode = (typeof process !== 'undefined' && process.env?.SAFELOOP_MODE || '').trim().toLowerCase();
  let mode: SafeLoopDeploymentMode = 'local';
  if (rawMode === 'cloud') mode = 'cloud';
  else if (rawMode === 'local') mode = 'local';
  else if (rawMode && rawMode !== 'local') mode = 'unknown';

  const instanceId = (typeof process !== 'undefined' && process.env?.SAFELOOP_INSTANCE_ID || '').trim() || undefined;
  const orgId = (typeof process !== 'undefined' && process.env?.SAFELOOP_ORG_ID || '').trim() || undefined;
  const projectId = (typeof process !== 'undefined' && process.env?.SAFELOOP_PROJECT_ID || '').trim() || undefined;

  const label = mode === 'cloud' ? 'Cloud monitor' : mode === 'local' ? 'Local monitor' : 'Unknown deployment';
  const dataResidency = mode === 'cloud' ? 'cloud' : 'local';
  const transport: SafeLoopDeploymentMetadata['transport'] = 'polling'; // only polling supported currently

  return {
    mode,
    label,
    instanceId,
    orgId,
    projectId,
    dataResidency,
    transport,
  };
}

// --- Billable Timecard derivation ---
// Derives billable agent timecards from existing loop data.
function deriveBillableTimecardFromLoop(loop: LoopTimecard): BillableAgentTimecard {
  const status: BillableTimecardStatus = loop.status === 'historical' ? 'unknown' : loop.status as BillableTimecardStatus;

  // A loop is a billable candidate when it has meaningful work evidence:
  // - has token usage (agent did computation)
  // - OR has handoffs (agent coordinated work)
  // - OR has artifacts (agent produced output)
  // - AND is completed or running (not stale/unknown)
  const hasWork = loop.totalTokens > 0 || loop.handoffsCount > 0 || loop.artifactsCount > 0;
  const hasActiveStatus = status === 'running' || status === 'completed';
  const billableCandidate = hasWork && hasActiveStatus;

  let billableReason: string | undefined;
  if (!billableCandidate) {
    if (!hasWork) billableReason = 'No token usage, handoffs, or artifacts recorded';
    else if (status === 'stale') billableReason = 'Loop is stale — may need investigation before billing';
    else if (status === 'failed') billableReason = 'Loop failed — review before billing';
    else billableReason = 'Insufficient evidence for billing';
  }

  return {
    id: loop.key,
    sessionId: loop.sessionId,
    caseId: loop.caseId,
    taskId: loop.taskId,
    taskName: loop.taskName,
    agentId: loop.agentId,
    agentName: loop.agent,
    project: loop.project,
    status,
    startTime: loop.firstTimestamp,
    endTime: loop.lastTimestamp,
    durationMs: loop.durationMs,
    handoffCount: loop.handoffsCount,
    approvalCount: loop.approvalsCount,
    artifactCount: loop.artifactsCount,
    riskCount: loop.risksCount,
    inputTokens: loop.inputTokens,
    outputTokens: loop.outputTokens,
    totalTokens: loop.totalTokens,
    estimatedCost: loop.estimatedCost,
    pricingAvailable: loop.pricingAvailable,
    billableCandidate,
    billableReason,
  };
}

function deriveBillableTimecardSummary(
  currentLoops: LoopTimecard[],
  historicalLoops: LoopTimecard[],
  isHistoricalOnly: boolean,
): BillableTimecardSummary {
  const current = currentLoops.map((loop) => {
    const card = deriveBillableTimecardFromLoop(loop);
    // In historical-only mode, current loops are fallback-promoted historical data.
    // They must not be marked as current billable candidates.
    if (isHistoricalOnly && card.billableCandidate) {
      card.billableCandidate = false;
      card.billableReason = 'Historical-only fallback \u2014 not current billable work';
    }
    return card;
  });
  const historical = historicalLoops.map(deriveBillableTimecardFromLoop);
  const all = [...current, ...historical];

  const billableCandidateCount = all.filter(t => t.billableCandidate).length;
  const totalDurationMs = all.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const totalTokens = all.reduce((sum, t) => sum + t.totalTokens, 0);
  const totalEstimatedCost = all.reduce((sum, t) => sum + t.estimatedCost, 0);
  const pricingAvailable = all.some(t => t.pricingAvailable);

  return {
    current,
    historical,
    totals: {
      currentCount: current.length,
      historicalCount: historical.length,
      billableCandidateCount,
      totalDurationMs,
      totalTokens,
      totalEstimatedCost,
      pricingAvailable,
    },
  };
}

// --- Circuit Graph derivation ---
// Derives a topology graph from live activity data for the Agent Circuit Map.
// Uses current-session data only. In historical-only mode, all edges are marked 'completed' (not 'active').
function deriveCircuitGraph(
  agentStatuses: Record<string, AgentStatus>,
  handoffFlow: HandoffDetail[],
  tokenRecords: ModelUsageRecord[],
  approvalItems: ApprovalItem[],
  isHistoricalOnly: boolean,
): CircuitGraph {
  const nodesById = new Map<string, CircuitNode>();
  const edges: CircuitEdge[] = [];
  const flowPath: string[] = [];

  // Helper to map AgentStatus.status to CircuitNodeStatus
  function mapAgentStatus(s: AgentStatus['status']): CircuitNodeStatus {
    switch (s) {
      case 'active': return 'active';
      case 'idle': return 'idle';
      case 'waiting_for_approval': return 'waiting';
      case 'blocked': return 'blocked';
      case 'failed': return 'blocked';
      case 'completed': return 'completed';
      case 'warning': return 'active'; // warning is still active, just flagged
      default: return 'unknown';
    }
  }

  // 1. Create agent nodes from agentStatuses
  for (const [key, agentStatus] of Object.entries(agentStatuses)) {
    const nodeId = `agent:${key}`;
    nodesById.set(nodeId, {
      id: nodeId,
      label: agentStatus.agent || key,
      type: 'agent',
      status: isHistoricalOnly ? 'completed' : mapAgentStatus(agentStatus.status),
      lastEventTimestamp: agentStatus.lastEventTimestamp,
    });
  }

  // 2. Create model nodes and model_call edges from token/usage records
  // Aggregate tokens/cost per model, and link from the calling agent
  const modelAgg = new Map<string, { tokens: number; cost: number; pricingAvailable: boolean; lastTs: string; agentIds: Set<string> }>();
  for (const record of tokenRecords) {
    const modelKey = `${trimText(record.provider)}/${trimText(record.model)}`;
    const existing = modelAgg.get(modelKey) ?? { tokens: 0, cost: 0, pricingAvailable: false, lastTs: '', agentIds: new Set() };
    existing.tokens += Number(record.totalTokens || Number(record.inputTokens || 0) + Number(record.outputTokens || 0));
    existing.cost += Number(record.estimatedCost || 0);
    if (record.pricingAvailable === true) existing.pricingAvailable = true;
    if (!existing.lastTs || toTimestamp(record.timestamp) > toTimestamp(existing.lastTs)) {
      existing.lastTs = record.timestamp;
    }
    const callerAgent = trimText(record.agent) || trimText(record.agentId) || '';
    if (callerAgent) existing.agentIds.add(callerAgent);
    modelAgg.set(modelKey, existing);
  }

  for (const [modelKey, agg] of modelAgg.entries()) {
    const nodeId = `model:${modelKey}`;
    nodesById.set(nodeId, {
      id: nodeId,
      label: modelKey,
      type: 'model',
      status: isHistoricalOnly ? 'completed' : 'active',
      lastEventTimestamp: agg.lastTs || undefined,
      tokenCount: agg.tokens,
      costTotal: agg.cost,
      pricingAvailable: agg.pricingAvailable,
    });

    // Create model_call edges from each calling agent to this model
    for (const callerAgent of agg.agentIds) {
      const fromNodeId = `agent:${callerAgent}`;
      // Ensure the agent node exists (it may have been missed if agentStatuses didn't include it)
      if (!nodesById.has(fromNodeId)) {
        nodesById.set(fromNodeId, {
          id: fromNodeId,
          label: callerAgent,
          type: 'agent',
          status: isHistoricalOnly ? 'completed' : 'idle',
        });
      }
      edges.push({
        id: `edge:model_call:${callerAgent}:${modelKey}`,
        from: fromNodeId,
        to: nodeId,
        type: 'model_call',
        status: isHistoricalOnly ? 'completed' : 'active',
        timestamp: agg.lastTs || undefined,
        summary: `${callerAgent} → ${modelKey}`,
      });
    }
  }

  // 3. Create handoff edges from handoffFlow
  for (let i = 0; i < handoffFlow.length; i++) {
    const h = handoffFlow[i];
    const fromAgent = h.fromAgent || h.fromAgentId || 'unknown';
    const toAgent = h.toAgent || h.toAgentId || 'unknown';
    const fromNodeId = `agent:${fromAgent}`;
    const toNodeId = `agent:${toAgent}`;

    // Ensure both nodes exist
    if (!nodesById.has(fromNodeId)) {
      nodesById.set(fromNodeId, { id: fromNodeId, label: fromAgent, type: 'agent', status: isHistoricalOnly ? 'completed' : 'idle' });
    }
    if (!nodesById.has(toNodeId)) {
      nodesById.set(toNodeId, { id: toNodeId, label: toAgent, type: 'agent', status: isHistoricalOnly ? 'completed' : 'idle' });
    }

    edges.push({
      id: `edge:handoff:${i}:${fromAgent}:${toAgent}`,
      from: fromNodeId,
      to: toNodeId,
      type: 'handoff',
      status: isHistoricalOnly ? 'completed' : (i === handoffFlow.length - 1 ? 'active' : 'completed'),
      timestamp: h.timestamp,
      summary: h.summary,
    });

    // Build flow path from handoff chain
    if (flowPath.length === 0) flowPath.push(fromNodeId);
    if (flowPath[flowPath.length - 1] !== fromNodeId) flowPath.push(fromNodeId);
    if (flowPath[flowPath.length - 1] !== toNodeId) flowPath.push(toNodeId);
  }

  // 4. Create human nodes and approval_gate edges from pending approvals
  for (const approval of approvalItems) {
    if (approval.status !== 'pending') continue;
    const approverLabel = approval.approver || 'Human Reviewer';
    const humanNodeId = `human:${approverLabel}`;
    if (!nodesById.has(humanNodeId)) {
      nodesById.set(humanNodeId, {
        id: humanNodeId,
        label: approverLabel,
        type: 'human',
        status: isHistoricalOnly ? 'completed' : 'waiting',
        lastEventTimestamp: approval.timestamp,
      });
    }

    // Edge from the requesting agent to the human approval gate
    const requestingAgent = approval.agent || approval.agentId || 'unknown';
    const fromNodeId = `agent:${requestingAgent}`;
    if (!nodesById.has(fromNodeId)) {
      nodesById.set(fromNodeId, { id: fromNodeId, label: requestingAgent, type: 'agent', status: isHistoricalOnly ? 'completed' : 'waiting' });
    }

    edges.push({
      id: `edge:approval_gate:${approval.id}`,
      from: fromNodeId,
      to: humanNodeId,
      type: 'approval_gate',
      status: isHistoricalOnly ? 'completed' : 'pending',
      timestamp: approval.timestamp,
      summary: approval.summary,
    });
  }

  return {
    nodes: Array.from(nodesById.values()),
    edges,
    currentFlowPath: isHistoricalOnly ? [] : flowPath,
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
