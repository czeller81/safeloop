import {
  addCaseContext,
  attachArtifact,
  hasParticipant,
  recordCaseDecision,
  recordCaseRisk,
  recordHandoff,
  requestCaseApproval,
  resolveCaseApproval,
  setCaseStatus,
} from './caseFile';
import type {
  CaseApprovalRecord,
  CaseAttachment,
  CaseAttachmentType,
  CaseDecisionEntry,
  CaseFile,
  CaseFileStatus,
  CaseHandoffRecord,
  CaseRiskEntry,
  CaseRiskSeverity,
} from './caseTypes';
import { generateHandoffManifest } from './handoffManifest';
import type { HandoffManifest } from './caseTypes';
import { appendEvent } from './eventStream';
import {
  exportSafeloopQueryJSON,
  exportSafeloopQueryMarkdown,
  querySafeloop,
  type SafeloopQueryResult,
  type SafeloopReportQuery,
} from './safeloopQuery';

export type AgentType =
  | 'hermes'
  | 'opencode'
  | 'claude-code'
  | 'codex'
  | 'replit-agent'
  | 'custom'
  | 'human';

export type AgentCapability =
  | 'canReadFiles'
  | 'canWriteFiles'
  | 'canRunCommands'
  | 'canRequestApproval'
  | 'canHandoff'
  | 'canGenerateReports';

export type AgentCapabilities = Partial<Record<AgentCapability, boolean>>;

export interface AgentAdapter {
  id: string;
  name: string;
  agentType: AgentType;
  version?: string;
  capabilities?: AgentCapabilities;
}

export type AgentAdapterEventType =
  | 'task.started'
  | 'context.loaded'
  | 'decision.made'
  | 'risk.detected'
  | 'approval.requested'
  | 'approval.resolved'
  | 'artifact.changed'
  | 'model.usage'
  | 'token.cost'
  | 'steering.applied'
  | 'test.completed'
  | 'handoff.created'
  | 'task.completed'
  | 'report.generated';

export interface AgentAdapterEventBase<TType extends AgentAdapterEventType, TMetadata> {
  id: string;
  type: TType;
  timestamp: string;
  agentId: string;
  agentName?: string;
  participantId?: string;
  caseId?: string;
  summary: string;
  metadata?: TMetadata;
}

export interface TaskStartedMetadata {
  goal?: string;
  project?: string;
  owner?: string;
}

export interface ContextLoadedMetadata {
  source?: string;
  notes?: string[];
  references?: string[];
}

export interface DecisionMadeMetadata {
  decision?: string;
  rationale?: string;
  tradeoffs?: string[];
  relatedContextIds?: string[];
}

export interface RiskDetectedMetadata {
  risk?: string;
  severity?: CaseRiskSeverity;
  mitigation?: string;
}

export interface ApprovalRequestedMetadata {
  reason?: string;
  approver?: string;
  references?: string[];
  subject?: string;
  requestedFor?: string;
}

export interface ApprovalResolvedMetadata {
  approvalId: string;
  decision: 'approved' | 'rejected';
  approver: string;
  note?: string;
}

export interface ArtifactChangedMetadata {
  path?: string;
  artifactType: CaseAttachmentType;
  changeSummary?: string;
  description?: string;
}

export interface ModelUsageMetadata {
  provider?: string;
  model?: string;
  modelArchitecture?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  project?: string;
  taskId?: string;
  taskName?: string;
  activeParameters?: string;
  totalParameters?: string;
}

export interface SteeringAppliedMetadata {
  steeringProfileId?: string;
  promptVersion?: string;
  instructionVersion?: string;
  model?: string;
  tokens?: number;
  cost?: number;
  releaseReadiness?: number;
}

export interface TestCompletedMetadata {
  name?: string;
  status?: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
}

export interface HandoffCreatedMetadata {
  from?: string;
  to?: string;
  notes?: string;
  recommendedNextActions?: string[];
}

export interface TaskCompletedMetadata {
  result?: string;
  outputSummary?: string;
}

export interface ReportGeneratedMetadata {
  reportType: string;
  path?: string;
}

export interface AgentAdapterEventMap {
  'task.started': AgentAdapterEventBase<'task.started', TaskStartedMetadata>;
  'context.loaded': AgentAdapterEventBase<'context.loaded', ContextLoadedMetadata>;
  'decision.made': AgentAdapterEventBase<'decision.made', DecisionMadeMetadata>;
  'risk.detected': AgentAdapterEventBase<'risk.detected', RiskDetectedMetadata>;
  'approval.requested': AgentAdapterEventBase<'approval.requested', ApprovalRequestedMetadata>;
  'approval.resolved': AgentAdapterEventBase<'approval.resolved', ApprovalResolvedMetadata>;
  'artifact.changed': AgentAdapterEventBase<'artifact.changed', ArtifactChangedMetadata>;
  'model.usage': AgentAdapterEventBase<'model.usage', ModelUsageMetadata>;
  'token.cost': AgentAdapterEventBase<'token.cost', ModelUsageMetadata>;
  'steering.applied': AgentAdapterEventBase<'steering.applied', SteeringAppliedMetadata>;
  'test.completed': AgentAdapterEventBase<'test.completed', TestCompletedMetadata>;
  'handoff.created': AgentAdapterEventBase<'handoff.created', HandoffCreatedMetadata>;
  'task.completed': AgentAdapterEventBase<'task.completed', TaskCompletedMetadata>;
  'report.generated': AgentAdapterEventBase<'report.generated', ReportGeneratedMetadata>;
}

export type AgentAdapterEvent = AgentAdapterEventMap[AgentAdapterEventType];

export interface AgentGeneratedReport {
  eventId: string;
  timestamp: string;
  reportType: string;
  path: string | null;
  summary: string;
}

export interface AgentSessionSummary {
  eventCount: number;
  startedCount: number;
  contextCount: number;
  decisionCount: number;
  riskCount: number;
  approvalRequestCount: number;
  approvalResolutionCount: number;
  artifactCount: number;
  handoffCount: number;
  completionCount: number;
  reportCount: number;
  completed: boolean;
}

export interface AgentSession {
  id: string;
  adapter: AgentAdapter;
  caseFile: CaseFile;
  events: AgentAdapterEvent[];
  generatedReports: AgentGeneratedReport[];
  completedAt: string | null;
  summary: AgentSessionSummary;
  emit(event: AgentAdapterEvent): AgentSession;
  complete(): AgentSession;
  createQueryReport(query: SafeloopReportQuery): SafeloopQueryResult;
  createHandoffManifest(): HandoffManifest;
}

export interface AgentSessionJSON {
  id: string;
  generatedAt: string;
  adapter: AgentAdapter;
  caseFile: CaseFile;
  events: AgentAdapterEvent[];
  generatedReports: AgentGeneratedReport[];
  summary: AgentSessionSummary;
  completedAt: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStringArray(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized = values
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

function requireNonEmpty(value: string | undefined | null, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function validateCaseId(caseFile: CaseFile, event: AgentAdapterEvent): void {
  if (event.caseId && event.caseId !== caseFile.id) {
    throw new Error(`Event caseId does not match case file: ${event.caseId}`);
  }
}

function resolveKnownParticipantId(caseFile: CaseFile, candidate?: string): string | undefined {
  if (!candidate) {
    return undefined;
  }
  const normalized = candidate.trim();
  if (!normalized) {
    return undefined;
  }
  return hasParticipant(caseFile, normalized) ? normalized : undefined;
}

function buildTaskStartedContext(event: AgentAdapterEventMap['task.started']): string {
  const metadata = (event.metadata ?? {}) as TaskStartedMetadata;
  const details = normalizeStringArray([metadata.goal ?? '', metadata.project ?? '', metadata.owner ?? '']).join(' · ');
  return details ? `Task started: ${event.summary} (${details})` : `Task started: ${event.summary}`;
}

function buildContextLoadedNotes(event: AgentAdapterEventMap['context.loaded']): string[] {
  const metadata = (event.metadata ?? {}) as ContextLoadedMetadata;
  return [
    ...(metadata.source ? [`Source: ${metadata.source}`] : []),
    ...(metadata.notes ?? []),
  ];
}

function buildDecisionRationale(event: AgentAdapterEventMap['decision.made']): string {
  const metadata = (event.metadata ?? {}) as DecisionMadeMetadata;
  const rationale = metadata.rationale?.trim() || event.summary;
  const tradeoffs = normalizeStringArray(metadata.tradeoffs);
  return tradeoffs.length > 0 ? `${rationale}\nTradeoffs: ${tradeoffs.join('; ')}` : rationale;
}

function buildRiskMitigation(event: AgentAdapterEventMap['risk.detected']): string {
  const metadata = (event.metadata ?? {}) as RiskDetectedMetadata;
  return metadata.mitigation?.trim() || event.summary;
}

function buildApprovalSubject(event: AgentAdapterEventMap['approval.requested']): string {
  const metadata = (event.metadata ?? {}) as ApprovalRequestedMetadata;
  return metadata.subject?.trim() || event.summary || 'Approval requested';
}

function buildApprovalReason(event: AgentAdapterEventMap['approval.requested']): string {
  const metadata = (event.metadata ?? {}) as ApprovalRequestedMetadata;
  return metadata.reason?.trim() || event.summary;
}

function buildArtifactDescription(event: AgentAdapterEventMap['artifact.changed']): string {
  const metadata = (event.metadata ?? {}) as ArtifactChangedMetadata;
  return metadata.changeSummary?.trim() || metadata.description?.trim() || event.summary;
}

function buildHandoffNotes(event: AgentAdapterEventMap['handoff.created']): string {
  const metadata = (event.metadata ?? {}) as HandoffCreatedMetadata;
  return metadata.notes?.trim() || event.summary;
}

function buildCompletionRationale(event: AgentAdapterEventMap['task.completed']): string {
  const metadata = (event.metadata ?? {}) as TaskCompletedMetadata;
  const result = metadata.result?.trim() || 'success';
  const outputSummary = metadata.outputSummary?.trim();
  return outputSummary ? `${result}\n${outputSummary}` : result;
}

function buildGeneratedReport(event: AgentAdapterEventMap['report.generated']): AgentGeneratedReport {
  const metadata = (event.metadata ?? {}) as ReportGeneratedMetadata;
  return {
    eventId: event.id,
    timestamp: event.timestamp,
    reportType: metadata.reportType,
    path: metadata.path ? metadata.path.trim() : null,
    summary: event.summary,
  };
}

function updateSummary(session: AgentSession): void {
  const events = session.events;
  session.summary = {
    eventCount: events.length,
    startedCount: events.filter((event) => event.type === 'task.started').length,
    contextCount: events.filter((event) => event.type === 'context.loaded').length,
    decisionCount: events.filter((event) => event.type === 'decision.made').length,
    riskCount: events.filter((event) => event.type === 'risk.detected').length,
    approvalRequestCount: events.filter((event) => event.type === 'approval.requested').length,
    approvalResolutionCount: events.filter((event) => event.type === 'approval.resolved').length,
    artifactCount: events.filter((event) => event.type === 'artifact.changed').length,
    handoffCount: events.filter((event) => event.type === 'handoff.created').length,
    completionCount: events.filter((event) => event.type === 'task.completed').length,
    reportCount: events.filter((event) => event.type === 'report.generated').length,
    completed: session.completedAt !== null,
  };
}

export function processAgentEvent(caseFile: CaseFile, event: AgentAdapterEvent): CaseFile {
  validateCaseId(caseFile, event);
  appendEvent({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    agentId: event.agentId,
    agentName: event.agentName,
    participantId: event.participantId,
    caseId: event.caseId ?? caseFile.id,
    summary: event.summary,
    metadata: event.metadata ? { ...(event.metadata as Record<string, unknown>) } : undefined,
  });

  const participantId = resolveKnownParticipantId(caseFile, event.participantId ?? event.agentId ?? event.agentName);
  const agentName = requireNonEmpty(event.agentName ?? event.agentId, 'agentName/agentId');

  switch (event.type) {
    case 'task.started': {
      const metadata = (event.metadata ?? {}) as TaskStartedMetadata;
      const sourceCase = metadata.goal || metadata.project || metadata.owner ? buildTaskStartedContext(event) : event.summary;
      const nextCase = addCaseContext(caseFile, {
        contextUsed: sourceCase,
        references: normalizeStringArray([metadata.project ?? '', metadata.goal ?? '']),
        notes: normalizeStringArray([metadata.owner ?? '']),
        createdBy: participantId,
      });
      if (nextCase.status !== 'open') {
        return setCaseStatus(nextCase, 'open');
      }
      return nextCase;
    }

    case 'context.loaded': {
      const metadata = (event.metadata ?? {}) as ContextLoadedMetadata;
      return addCaseContext(caseFile, {
        contextUsed: event.summary,
        references: normalizeStringArray(metadata.references),
        notes: buildContextLoadedNotes(event),
        createdBy: participantId,
      });
    }

    case 'decision.made': {
      const metadata = (event.metadata ?? {}) as DecisionMadeMetadata;
      return recordCaseDecision(caseFile, {
        decision: metadata.decision?.trim() || event.summary,
        rationale: buildDecisionRationale(event),
        relatedContextIds: normalizeStringArray(metadata.relatedContextIds),
        owner: agentName,
        createdBy: participantId,
      });
    }

    case 'risk.detected': {
      const metadata = (event.metadata ?? {}) as RiskDetectedMetadata;
      return recordCaseRisk(caseFile, {
        risk: metadata.risk?.trim() || event.summary,
        severity: metadata.severity ?? 'medium',
        mitigation: buildRiskMitigation(event),
        status: 'open',
        createdBy: participantId,
      });
    }

    case 'approval.requested': {
      const metadata = (event.metadata ?? {}) as ApprovalRequestedMetadata;
      return requestCaseApproval(caseFile, {
        subject: buildApprovalSubject(event),
        requestedBy: agentName,
        requestedFor: metadata.approver?.trim() || metadata.requestedFor?.trim() || caseFile.owner,
        reason: buildApprovalReason(event),
        references: normalizeStringArray(metadata.references),
        requestedByParticipantId: participantId,
      });
    }

    case 'approval.resolved': {
      const metadata = (event.metadata ?? {}) as ApprovalResolvedMetadata;
      return resolveCaseApproval(caseFile, requireNonEmpty(metadata.approvalId, 'approvalId'), {
        status: metadata.decision,
        approver: metadata.approver?.trim() || agentName,
        note: metadata.note?.trim() || event.summary,
        resolvedByParticipantId: participantId,
      });
    }

    case 'artifact.changed': {
      const metadata = (event.metadata ?? {}) as ArtifactChangedMetadata;
      return attachArtifact(caseFile, {
        type: metadata.artifactType,
        label: event.summary || metadata.path || 'Artifact change',
        path: metadata.path?.trim(),
        description: buildArtifactDescription(event),
        metadata: {
          agentId: event.agentId,
          agentName: event.agentName,
          eventId: event.id,
          changeSummary: metadata.changeSummary,
        },
      });
    }

    case 'model.usage':
    case 'token.cost':
    case 'steering.applied':
    case 'test.completed':
      return caseFile;

    case 'handoff.created': {
      const metadata = (event.metadata ?? {}) as HandoffCreatedMetadata;
      return recordHandoff(caseFile, {
        currentOwner: metadata.from?.trim() || agentName || caseFile.owner,
        nextOwner: metadata.to?.trim() || caseFile.owner,
        handoffNotes: buildHandoffNotes(event),
        recommendedNextActions: normalizeStringArray(metadata.recommendedNextActions),
        fromParticipantId: participantId,
        toParticipantId: resolveKnownParticipantId(caseFile, metadata.to),
      });
    }

    case 'task.completed': {
      const completionMetadata = (event.metadata ?? {}) as TaskCompletedMetadata;
      const nextCase = recordCaseDecision(caseFile, {
        decision: `Task completed: ${(completionMetadata.result ?? 'success').trim()}`,
        rationale: buildCompletionRationale(event),
        createdBy: participantId,
      });
      return setCaseStatus(nextCase, 'completed');
    }

    case 'report.generated': {
      const metadata = (event.metadata ?? {}) as ReportGeneratedMetadata;
      return attachArtifact(caseFile, {
        type: 'report',
        label: metadata.reportType,
        path: metadata.path?.trim(),
        description: event.summary,
        metadata: {
          agentId: event.agentId,
          agentName: event.agentName,
          eventId: event.id,
          reportType: metadata.reportType,
        },
      });
    }

    default: {
      return caseFile;
    }
  }
}

function cloneEvent<T extends AgentAdapterEvent>(event: T): T {
  return {
    ...event,
    metadata: event.metadata ? { ...(event.metadata as Record<string, unknown>) } : event.metadata,
  } as T;
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : 'None';
}

function renderObjectLines(label: string, values: Record<string, string | number | boolean | null | undefined>): string[] {
  const lines = [`* ${label}`];
  Object.entries(values).forEach(([key, value]) => {
    lines.push(`  * ${key}: ${value ?? 'None'}`);
  });
  return lines;
}

function formatEvent(event: AgentAdapterEvent): string[] {
  const lines = [`* ${event.type}`];
  lines.push(`  * id: ${event.id}`);
  lines.push(`  * timestamp: ${event.timestamp}`);
  lines.push(`  * agent: ${event.agentName ?? event.agentId}`);
  if (event.caseId) {
    lines.push(`  * caseId: ${event.caseId}`);
  }
  lines.push(`  * summary: ${event.summary}`);
  if (event.metadata) {
    lines.push(`  * metadata: ${JSON.stringify(event.metadata)}`);
  }
  return lines;
}

function buildSessionMarkdownSection(title: string, lines: string[]): string[] {
  return ['## ' + title, '', ...(lines.length > 0 ? lines : ['None'])];
}

function summarizeSessionEvents(events: AgentAdapterEvent[]): string[] {
  return events.flatMap((event) => formatEvent(event));
}

function summarizeDecisions(caseFile: CaseFile): string[] {
  return caseFile.decisionLog.length > 0
    ? caseFile.decisionLog.map((entry) => `* ${entry.decision} — ${entry.rationale}`)
    : ['None'];
}

function summarizeRisks(caseFile: CaseFile): string[] {
  return caseFile.riskLog.length > 0
    ? caseFile.riskLog.map((entry) => `* ${entry.risk} (${entry.severity}) — ${entry.mitigation}`)
    : ['None'];
}

function summarizeApprovals(caseFile: CaseFile): string[] {
  return caseFile.approvals.length > 0
    ? caseFile.approvals.map((entry) => `* ${entry.subject} — ${entry.status} by ${entry.approver ?? 'None'}`)
    : ['None'];
}

function summarizeArtifacts(caseFile: CaseFile): string[] {
  return caseFile.attachments.length > 0
    ? caseFile.attachments.map((entry) => `* ${entry.label} (${entry.type})`)
    : ['None'];
}

function summarizeHandoffs(caseFile: CaseFile): string[] {
  return caseFile.handoffRecords.length > 0
    ? caseFile.handoffRecords.map((entry) => `* ${entry.currentOwner} → ${entry.nextOwner}`)
    : ['None'];
}

function summarizeGeneratedReports(session: AgentSession): string[] {
  return session.generatedReports.length > 0
    ? session.generatedReports.map((entry) =>
        `* ${entry.reportType}${entry.path ? ` — ${entry.path}` : ''}`,
      )
    : ['None'];
}

export function createAgentSession(options: { adapter: AgentAdapter; caseFile: CaseFile }): AgentSession {
  const adapter = {
    ...options.adapter,
    capabilities: options.adapter.capabilities ? { ...options.adapter.capabilities } : undefined,
  };
  const session: AgentSession = {
    id: createId('agent-session'),
    adapter,
    caseFile: options.caseFile,
    events: [],
    generatedReports: [],
    completedAt: null,
    summary: {
      eventCount: 0,
      startedCount: 0,
      contextCount: 0,
      decisionCount: 0,
      riskCount: 0,
      approvalRequestCount: 0,
      approvalResolutionCount: 0,
      artifactCount: 0,
      handoffCount: 0,
      completionCount: 0,
      reportCount: 0,
      completed: false,
    },
    emit(event: AgentAdapterEvent): AgentSession {
      if (session.completedAt) {
        throw new Error('Agent session is already complete');
      }
      const nextEvent = cloneEvent(event);
      session.caseFile = processAgentEvent(session.caseFile, nextEvent);
      session.events.push(nextEvent);
      if (nextEvent.type === 'report.generated') {
        session.generatedReports.push(buildGeneratedReport(nextEvent));
      }
      updateSummary(session);
      return session;
    },
    complete(): AgentSession {
      if (!session.completedAt) {
        session.completedAt = now();
        updateSummary(session);
      }
      return session;
    },
    createQueryReport(query: SafeloopReportQuery): SafeloopQueryResult {
      return querySafeloop(session.caseFile, query);
    },
    createHandoffManifest(): HandoffManifest {
      return generateHandoffManifest(session.caseFile);
    },
  };

  updateSummary(session);
  return session;
}

export function exportAgentSessionJSON(session: AgentSession): AgentSessionJSON {
  return {
    id: session.id,
    generatedAt: now(),
    adapter: {
      ...session.adapter,
      capabilities: session.adapter.capabilities ? { ...session.adapter.capabilities } : undefined,
    },
    caseFile: session.caseFile,
    events: session.events.map(cloneEvent),
    generatedReports: session.generatedReports.map((report) => ({ ...report })),
    summary: { ...session.summary },
    completedAt: session.completedAt,
  };
}

export function exportAgentSessionMarkdown(session: AgentSession): string {
  const lines: string[] = ['# Safeloop Agent Session', ''];

  lines.push(...buildSessionMarkdownSection('Agent', [
    `* id: ${session.adapter.id}`,
    `* name: ${session.adapter.name}`,
    `* agentType: ${session.adapter.agentType}`,
    `* version: ${session.adapter.version ?? 'None'}`,
    `* capabilities: ${JSON.stringify(session.adapter.capabilities ?? {})}`,
  ]));

  lines.push('');
  lines.push(...buildSessionMarkdownSection('Case', [
    `* id: ${session.caseFile.id}`,
    `* goal: ${session.caseFile.goal}`,
    `* owner: ${session.caseFile.owner}`,
    `* project: ${session.caseFile.project}`,
    `* status: ${session.caseFile.status}`,
  ]));

  lines.push('');
  lines.push(...buildSessionMarkdownSection('Events', summarizeSessionEvents(session.events)));
  lines.push('');
  lines.push(...buildSessionMarkdownSection('Decisions', summarizeDecisions(session.caseFile)));
  lines.push('');
  lines.push(...buildSessionMarkdownSection('Risks', summarizeRisks(session.caseFile)));
  lines.push('');
  lines.push(...buildSessionMarkdownSection('Approvals', summarizeApprovals(session.caseFile)));
  lines.push('');
  lines.push(...buildSessionMarkdownSection('Artifacts', summarizeArtifacts(session.caseFile)));
  lines.push('');
  lines.push(...buildSessionMarkdownSection('Handoffs', summarizeHandoffs(session.caseFile)));
  lines.push('');
  lines.push(...buildSessionMarkdownSection('Completion', [
    `* completedAt: ${session.completedAt ?? 'None'}`,
    `* completed: ${session.summary.completed ? 'yes' : 'no'}`,
  ]));
  lines.push('');
  lines.push(...buildSessionMarkdownSection('Generated Reports', summarizeGeneratedReports(session)));

  return lines.join('\n').trim();
}
