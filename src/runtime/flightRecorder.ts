import { readEvents } from '../eventStream';
import type { SafeloopStorageOptions } from '../localStorage';
import { extractRuntimeWorkEvent, buildSessionWorkGraph, type SessionWorkGraph } from './sessionWorkGraph';
import { redactWorkEventData } from './workEvents';
import type { ExecutionProofRecord, ExecutionVerificationStatus } from './executionProof';
import type { RuntimeWorkEvent } from './protocol';
import type { EvidenceRegistryRecord } from '../evidenceRegistry';
import type { ArtifactRecord } from './protocol';
import type { StoredMemory } from './memoryStore';

export type FlightRecorderEventCategory =
  | 'SESSION'
  | 'TASK'
  | 'PROPOSAL'
  | 'DECISION'
  | 'APPROVAL'
  | 'PERMIT'
  | 'EXECUTION'
  | 'VERIFICATION'
  | 'EVIDENCE'
  | 'ARTIFACT'
  | 'MEMORY'
  | 'PREVENTED'
  | 'OTHER';

export type PreventedActionCategory =
  | 'denied_by_policy'
  | 'approval_not_granted'
  | 'approval_invalid'
  | 'permit_rejected'
  | 'execution_context_mismatch'
  | 'breaker_blocked'
  | 'budget_blocked'
  | 'stop_agent'
  | 'pause'
  | 'other_governance_block';

export interface FlightRecorderSessionSummary {
  session_id: string;
  task_ids: string[];
  primary_task_id?: string;
  agent_id?: string;
  tenant_id?: string;
  profile?: string;
  task_goal?: string;
  started_at?: string;
  last_event_at?: string;
  duration_ms?: number;
  work_event_count: number;
  proposal_count: number;
  decision_count: number;
  approval_count: number;
  execution_count: number;
  evidence_count: number;
  artifact_count: number;
  memory_event_count: number;
  memory_candidate_count: number;
  memory_persisted_count: number;
  memory_rejected_count: number;
  verified_count: number;
  partially_verified_count: number;
  not_verifiable_count: number;
  failed_count: number;
  prevented_count: number;
  final_state: string;
  latest_summary?: string;
}

export interface FlightRecorderPreventedAction {
  event_id: string;
  timestamp: string;
  category: PreventedActionCategory;
  action?: string;
  reason: string;
  disposition?: string;
  rule_or_risk_source?: string;
  approval_could_resolve: boolean;
  execution_occurred: boolean;
  related_ids: Record<string, string>;
}

export interface FlightRecorderTimelineEvent {
  id: string;
  type: RuntimeWorkEvent['type'];
  category: FlightRecorderEventCategory;
  timestamp: string;
  task_id?: string;
  agent_id?: string;
  tenant_id?: string;
  summary: string;
  explanation: string;
  causal_links: {
    parent_event_id?: string;
    causes: string[];
    linked_event_ids: string[];
    missing_links: string[];
  };
  refs: Record<string, string | string[]>;
  data?: Record<string, unknown>;
}

export interface FlightRecorderCoveragePath {
  path: string;
  status: 'MANAGED' | 'UNMANAGED' | 'DISABLED' | 'UNKNOWN';
  consequential?: boolean;
}

export interface FlightRecorderCoverage {
  profile?: string;
  paths: FlightRecorderCoveragePath[];
  managed_enabled_count: number;
  unmanaged_enabled_count: number;
  disabled_count: number;
  summary: string;
}

export interface FlightRecorderEvidenceView {
  evidence_id: string;
  verification_status: string;
  supported_claim?: string;
  artifact_hash: string;
  created_at: string;
  artifact_ids: string[];
}

export interface FlightRecorderProofView {
  execution_id?: string;
  executor: string;
  operation?: string;
  verification_status: ExecutionVerificationStatus;
  verification_summary: string;
  verification_scope: string;
  limitation: string;
  before?: unknown;
  after?: unknown;
  result?: Record<string, unknown>;
  evidence_ids: string[];
  artifact_ids: string[];
}

export interface FlightRecorderMemoryView {
  memory_id: string;
  status: string;
  decision?: string;
  confidence?: number;
  provenance?: string;
  source_task?: string;
  source_session?: string;
  evidence_ids: string[];
  artifact_ids: string[];
  persisted: boolean;
  ttl_expires_at?: string;
  store: 'reference' | 'external_or_unlinked';
}

export interface FlightRecorderSession {
  schema_version: 1;
  summary: FlightRecorderSessionSummary;
  coverage: FlightRecorderCoverage;
  timeline: FlightRecorderTimelineEvent[];
  prevented_actions: FlightRecorderPreventedAction[];
  execution_proofs: FlightRecorderProofView[];
  evidence: FlightRecorderEvidenceView[];
  artifacts: ArtifactRecord[];
  memory: FlightRecorderMemoryView[];
  known_limitations: string[];
  diagnostics: SessionWorkGraph['diagnostics'];
}

export interface FlightRecorderIndex {
  schema_version: 1;
  sessions: FlightRecorderSessionSummary[];
  page: { limit: number; returned_count: number; total_count: number; next_cursor?: string; has_more: boolean; max_limit: number };
}

export interface FlightRecorderExportBundle extends FlightRecorderSession {
  export_type: 'safeloop.flight_recorder.session';
  exported_at: string;
  includes_file_bodies: false;
  includes_full_process_output: false;
}

export const DEFAULT_FLIGHT_RECORDER_LIMIT = 100;
export const MAX_FLIGHT_RECORDER_LIMIT = 500;

const PROOF_LIMITATIONS: Record<string, string> = {
  filesystem: 'Filesystem proof covers direct state observed at the resolved target path; file bodies are not included.',
  git: 'Git proof covers repository state observed before and after the governed git invocation; full diff bodies are not captured.',
  shell: 'SafeLoop verifies the governed process invocation/result, not every downstream process side effect.',
  http: 'Transaction proof only. SafeLoop does not prove the remote business outcome.',
  mcp: 'MCP call/result proof does not automatically prove downstream side effects.',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function timestampMs(value?: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function duration(start?: string, end?: string): number | undefined {
  const a = timestampMs(start);
  const b = timestampMs(end);
  return a !== undefined && b !== undefined && b >= a ? b - a : undefined;
}

function eventCategory(type: RuntimeWorkEvent['type']): FlightRecorderEventCategory {
  if (type.startsWith('session.')) return 'SESSION';
  if (type.startsWith('task.')) return 'TASK';
  if (type === 'proposal.recorded') return 'PROPOSAL';
  if (type === 'decision.recorded') return 'DECISION';
  if (type.startsWith('approval.')) return 'APPROVAL';
  if (type.startsWith('permit.')) return 'PERMIT';
  if (type.startsWith('execution.')) return type === 'execution.rejected' ? 'PREVENTED' : 'EXECUTION';
  if (type === 'verification.recorded') return 'VERIFICATION';
  if (type === 'evidence.recorded') return 'EVIDENCE';
  if (type === 'artifact.recorded') return 'ARTIFACT';
  if (type.startsWith('memory.')) return 'MEMORY';
  return 'OTHER';
}

function actionLabel(event: RuntimeWorkEvent): string | undefined {
  const data = asRecord(event.data);
  const parts = [data.action_kind, data.operation, data.method, data.tool, data.target ?? data.resource ?? data.cwd]
    .map((part) => typeof part === 'string' ? part : undefined)
    .filter(Boolean) as string[];
  return parts.length ? parts.join(' ') : event.summary;
}

function explanationFor(event: RuntimeWorkEvent): string {
  const data = asRecord(event.data);
  switch (event.type) {
    case 'proposal.recorded':
      return `The agent proposed ${actionLabel(event) ?? 'an action'} for SafeLoop governance.`;
    case 'decision.recorded': {
      const disposition = asString(data.disposition) ?? 'UNKNOWN';
      const risk = typeof data.risk_score === 'number' ? ` Risk score: ${data.risk_score}.` : '';
      const why = asString(data.explanation) ? ` ${data.explanation}` : '';
      return `SafeLoop recorded an effective governance decision of ${disposition}.${risk}${why}`.trim();
    }
    case 'approval.requested':
      return 'SafeLoop required human approval before issuing execution authority.';
    case 'approval.redeemed':
      return 'A bound approval was redeemed and can issue authority only for the approved action and context.';
    case 'approval.denied':
      return `Approval did not produce execution authority.${asString(data.reason) ? ` ${data.reason}` : ''}`;
    case 'permit.issued':
      return 'SafeLoop issued a one-time execution permit bound to the action fingerprint and context.';
    case 'permit.consumed':
      return 'The bound execution permit was consumed before the managed executor ran.';
    case 'execution.started':
      return 'The managed executor started the authorized operation.';
    case 'execution.completed':
      return `The managed executor completed with status ${asString(data.status) ?? 'UNKNOWN'}.`;
    case 'execution.rejected':
      return `SafeLoop prevented execution before the protected side effect.${asString(data.reason) ? ` ${data.reason}` : ''}`;
    case 'verification.recorded': {
      const status = asString(data.status) ?? asString(asRecord(data.execution_proof).verification_status) ?? 'UNKNOWN';
      const proof = asRecord(data.execution_proof);
      return `SafeLoop recorded executor verification status ${status}.${asString(proof.verification_summary) ? ` ${proof.verification_summary}` : ''}`;
    }
    case 'memory.candidate.recorded':
      return 'A candidate memory was submitted for governance before activation.';
    case 'memory.decision.recorded':
      return `SafeLoop recorded a memory governance decision of ${asString(data.decision) ?? 'UNKNOWN'}.`;
    case 'memory.persisted':
      return 'A governed memory candidate was authorized for persistence or persisted to the reference store.';
    case 'memory.rejected':
      return `A memory candidate was not activated.${asString(data.reason) ? ` ${data.reason}` : ''}`;
    default:
      return event.summary ?? event.type;
  }
}

function refsFor(event: RuntimeWorkEvent): Record<string, string | string[]> {
  const refs: Record<string, string | string[]> = {};
  for (const key of ['proposal_id', 'decision_id', 'approval_request_id', 'approval_id', 'permit_id', 'execution_id', 'verification_id', 'memory_candidate_id', 'memory_decision_id', 'memory_persistence_id', 'action_fingerprint'] as const) {
    const value = event[key];
    if (typeof value === 'string') refs[key] = value;
  }
  if (event.evidence_ids?.length) refs.evidence_ids = [...event.evidence_ids];
  if (event.artifact_ids?.length) refs.artifact_ids = [...event.artifact_ids];
  return refs;
}

function buildTimeline(graph: SessionWorkGraph): FlightRecorderTimelineEvent[] {
  const eventIds = new Set(graph.events.map((event) => event.id));
  return graph.events.map((event) => {
    const causes = event.causes ?? [];
    const candidateLinks = [event.parent_event_id, ...causes].filter((id): id is string => typeof id === 'string' && id.length > 0);
    const linked = candidateLinks.filter((id) => eventIds.has(id));
    const missing = candidateLinks.filter((id) => !eventIds.has(id));
    return {
      id: event.id,
      type: event.type,
      category: eventCategory(event.type),
      timestamp: event.timestamp,
      task_id: event.task_id,
      agent_id: event.agent_id,
      tenant_id: event.tenant_id,
      summary: event.summary ?? event.type,
      explanation: explanationFor(event),
      causal_links: {
        parent_event_id: event.parent_event_id,
        causes,
        linked_event_ids: linked,
        missing_links: missing,
      },
      refs: refsFor(event),
      data: event.data ? redactWorkEventData(event.data) as Record<string, unknown> : undefined,
    };
  });
}

function preventedCategory(event: RuntimeWorkEvent): PreventedActionCategory | null {
  const data = asRecord(event.data);
  if (event.type === 'decision.recorded') {
    const disposition = asString(data.disposition);
    if (disposition === 'DENY') return 'denied_by_policy';
    if (disposition === 'STOP_AGENT') return 'stop_agent';
    if (disposition === 'PAUSE') return 'pause';
  }
  if (event.type === 'approval.denied') return event.approval_id ? 'approval_invalid' : 'approval_not_granted';
  if (event.type === 'execution.rejected') {
    const status = asString(data.status);
    const reason = asString(data.reason) ?? asString(data.rejection_reason);
    if (status === 'BLOCKED_BY_BREAKER' || /breaker/i.test(reason ?? '')) return 'breaker_blocked';
    if (/budget/i.test(reason ?? '')) return 'budget_blocked';
    if (/context|cwd|repository|target|workspace/i.test(reason ?? '')) return 'execution_context_mismatch';
    return 'permit_rejected';
  }
  return null;
}

function buildPreventedActions(events: RuntimeWorkEvent[]): FlightRecorderPreventedAction[] {
  return events.flatMap((event) => {
    const category = preventedCategory(event);
    if (!category) return [];
    const data = asRecord(event.data);
    const disposition = asString(data.disposition) ?? asString(data.status);
    return [{
      event_id: event.id,
      timestamp: event.timestamp,
      category,
      action: actionLabel(event),
      reason: asString(data.reason) ?? asString(data.explanation) ?? event.summary ?? category,
      disposition,
      rule_or_risk_source: Array.isArray(data.matched_rules) ? data.matched_rules.join(', ') : asString(data.profile),
      approval_could_resolve: disposition === 'REQUIRE_APPROVAL' || event.type === 'approval.denied',
      execution_occurred: false,
      related_ids: Object.fromEntries(Object.entries(refsFor(event)).filter(([, value]) => typeof value === 'string')) as Record<string, string>,
    }];
  });
}

function summaryFromGraph(graph: SessionWorkGraph, prevented: FlightRecorderPreventedAction[]): FlightRecorderSessionSummary {
  const events = graph.events;
  const first = events[0];
  const last = events[events.length - 1];
  const sessionStarted = events.find((event) => event.type === 'session.started');
  const taskStarted = events.find((event) => event.type === 'task.started');
  const profile = asString(asRecord(sessionStarted?.data).profile);
  const proofCounts = graph.execution_proofs.reduce((counts, proof) => {
    counts[proof.verification_status] = (counts[proof.verification_status] ?? 0) + 1;
    return counts;
  }, {} as Record<ExecutionVerificationStatus, number>);
  const memoryCandidates = events.filter((event) => event.type === 'memory.candidate.recorded');
  const memoryPersisted = events.filter((event) => event.type === 'memory.persisted');
  const memoryRejected = events.filter((event) => event.type === 'memory.rejected' || (event.type === 'memory.decision.recorded' && asBool(asRecord(event.data).allowed) === false));
  return {
    session_id: graph.session_id,
    task_ids: graph.tasks.map((task) => task.task_id),
    primary_task_id: graph.tasks[0]?.task_id,
    agent_id: first?.agent_id,
    tenant_id: first?.tenant_id,
    profile,
    task_goal: asString(asRecord(taskStarted?.data).goal),
    started_at: first?.timestamp,
    last_event_at: last?.timestamp,
    duration_ms: duration(first?.timestamp, last?.timestamp),
    work_event_count: events.length,
    proposal_count: events.filter((event) => event.type === 'proposal.recorded').length,
    decision_count: events.filter((event) => event.type === 'decision.recorded').length,
    approval_count: events.filter((event) => event.type.startsWith('approval.')).length,
    execution_count: events.filter((event) => event.type === 'execution.completed').length,
    evidence_count: graph.evidence.length,
    artifact_count: graph.artifacts.length,
    memory_event_count: events.filter((event) => event.type.startsWith('memory.')).length,
    memory_candidate_count: memoryCandidates.length,
    memory_persisted_count: memoryPersisted.length,
    memory_rejected_count: memoryRejected.length,
    verified_count: proofCounts.VERIFIED ?? 0,
    partially_verified_count: proofCounts.PARTIALLY_VERIFIED ?? 0,
    not_verifiable_count: proofCounts.NOT_VERIFIABLE ?? 0,
    failed_count: proofCounts.FAILED ?? 0,
    prevented_count: prevented.length,
    final_state: last?.type ?? 'empty',
    latest_summary: last?.summary,
  };
}

function proofView(proof: ExecutionProofRecord): FlightRecorderProofView {
  const executor = proof.executor.toLowerCase();
  return {
    execution_id: proof.execution_id,
    executor: proof.executor,
    operation: proof.operation,
    verification_status: proof.verification_status,
    verification_summary: proof.verification_summary,
    verification_scope: proof.verification_scope,
    limitation: PROOF_LIMITATIONS[executor] ?? 'Proof covers only the data SafeLoop directly observed.',
    before: redactWorkEventData(proof.before),
    after: redactWorkEventData(proof.after),
    result: redactWorkEventData(proof.result) as Record<string, unknown> | undefined,
    evidence_ids: [...(proof.evidence_ids ?? [])],
    artifact_ids: [...(proof.artifact_ids ?? [])],
  };
}

function evidenceView(record: EvidenceRegistryRecord, artifacts: ArtifactRecord[]): FlightRecorderEvidenceView {
  return {
    evidence_id: record.evidenceId,
    verification_status: record.verificationStatus,
    supported_claim: record.provenance.supportedClaim,
    artifact_hash: record.artifactHash,
    created_at: record.createdAt,
    artifact_ids: artifacts.filter((artifact) => artifact.content_hash === record.artifactHash).map((artifact) => artifact.artifact_id),
  };
}

function memoryView(record: StoredMemory): FlightRecorderMemoryView {
  return {
    memory_id: record.candidate.memory_id,
    status: record.provenance.status,
    decision: record.provenance.decision,
    confidence: record.provenance.confidence,
    provenance: record.candidate.provenance,
    source_task: record.provenance.originating_task,
    source_session: record.candidate.session_id,
    evidence_ids: [...(record.provenance.evidence_ids ?? [])],
    artifact_ids: [...(record.provenance.artifact_ids ?? [])],
    persisted: record.provenance.status === 'ACTIVE',
    ttl_expires_at: record.provenance.expires_at,
    store: 'reference',
  };
}

function coverageFromGraph(graph: SessionWorkGraph): FlightRecorderCoverage {
  const sessionStarted = graph.events.find((event) => event.type === 'session.started');
  const profile = asString(asRecord(sessionStarted?.data).profile);
  const paths: FlightRecorderCoveragePath[] = ['filesystem', 'git', 'shell', 'http', 'mcp'].map((path) => {
    const used = graph.execution_proofs.some((proof) => proof.executor.toLowerCase() === path);
    return { path, status: used ? 'MANAGED' : 'UNKNOWN', consequential: true };
  });
  const managed = paths.filter((path) => path.status === 'MANAGED').length;
  const unmanaged = paths.filter((path) => path.status === 'UNMANAGED').length;
  const disabled = paths.filter((path) => path.status === 'DISABLED').length;
  return {
    profile,
    paths,
    managed_enabled_count: managed,
    unmanaged_enabled_count: unmanaged,
    disabled_count: disabled,
    summary: `${managed} of ${paths.length} observed consequential execution path types were managed in this session. Unused paths are shown as UNKNOWN, not as unmanaged.`,
  };
}

function knownLimitations(proofs: FlightRecorderProofView[]): string[] {
  const base = [
    'SafeLoop governs routed/managed execution paths, not arbitrary OS activity.',
    'The Flight Recorder reconstructs recorded causal links and does not fabricate missing edges.',
  ];
  const specific = Array.from(new Set(proofs.map((proof) => proof.limitation)));
  return [...base, ...specific];
}

export function buildFlightRecorderSession(sessionId: string, options: SafeloopStorageOptions = {}): FlightRecorderSession {
  const graph = buildSessionWorkGraph(sessionId, options);
  const prevented = buildPreventedActions(graph.events);
  const proofs = graph.execution_proofs.map(proofView);
  return {
    schema_version: 1,
    summary: summaryFromGraph(graph, prevented),
    coverage: coverageFromGraph(graph),
    timeline: buildTimeline(graph),
    prevented_actions: prevented,
    execution_proofs: proofs,
    evidence: graph.evidence.map((record) => evidenceView(record, graph.artifacts)),
    artifacts: graph.artifacts.map((artifact) => ({ ...artifact })),
    memory: graph.memories.map(memoryView),
    known_limitations: knownLimitations(proofs),
    diagnostics: graph.diagnostics,
  };
}

function sessionIds(options: SafeloopStorageOptions): string[] {
  const ids = new Set<string>();
  for (const event of readEvents(options)) {
    if (event.sessionId) ids.add(event.sessionId);
    const workEvent = extractRuntimeWorkEvent(event);
    if (workEvent?.session_id) ids.add(workEvent.session_id);
  }
  return Array.from(ids).sort();
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_FLIGHT_RECORDER_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('invalid_limit');
  return Math.min(limit, MAX_FLIGHT_RECORDER_LIMIT);
}

export function listFlightRecorderSessions(options: SafeloopStorageOptions = {}, page: { limit?: number; cursor?: string } = {}): FlightRecorderIndex {
  const ids = sessionIds(options);
  const limit = normalizeLimit(page.limit);
  const start = page.cursor ? ids.indexOf(page.cursor) + 1 : 0;
  if (page.cursor && start === 0) throw new Error('invalid_cursor');
  const pageIds = ids.slice(start, start + limit);
  const summaries = pageIds.map((sessionId) => buildFlightRecorderSession(sessionId, options).summary)
    .sort((left, right) => (right.last_event_at ?? '').localeCompare(left.last_event_at ?? ''));
  const next = start + pageIds.length < ids.length ? pageIds[pageIds.length - 1] : undefined;
  return {
    schema_version: 1,
    sessions: summaries,
    page: {
      limit,
      returned_count: summaries.length,
      total_count: ids.length,
      ...(next ? { next_cursor: next } : {}),
      has_more: Boolean(next),
      max_limit: MAX_FLIGHT_RECORDER_LIMIT,
    },
  };
}

export function exportFlightRecorderSession(sessionId: string, options: SafeloopStorageOptions = {}): FlightRecorderExportBundle {
  return {
    export_type: 'safeloop.flight_recorder.session',
    exported_at: new Date().toISOString(),
    includes_file_bodies: false,
    includes_full_process_output: false,
    ...buildFlightRecorderSession(sessionId, options),
  };
}
