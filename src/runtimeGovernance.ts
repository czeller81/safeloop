import { appendEvent, type SafeloopStreamEvent, type SafeloopStreamEventInput } from './eventStream';
import type { SafeloopStorageOptions } from './localStorage';

export type RuntimeGovernanceEventType =
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'agent.started'
  | 'agent.paused'
  | 'agent.resumed'
  | 'agent.stopped'
  | 'decision.proposed'
  | 'decision.recorded'
  | 'tool.requested'
  | 'tool.allowed'
  | 'tool.denied'
  | 'tool.executed'
  | 'tool.failed'
  | 'risk.detected'
  | 'risk.cleared'
  | 'policy.evaluated'
  | 'policy.passed'
  | 'policy.failed'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'approval.expired'
  | 'artifact.created'
  | 'artifact.modified'
  | 'artifact.deleted'
  | 'external_action.requested'
  | 'external_action.executed'
  | 'memory.write.requested'
  | 'memory.write.allowed'
  | 'memory.write.quarantined'
  | 'memory.write.rejected'
  | 'handoff.created'
  | 'handoff.accepted'
  | 'circuit_breaker.triggered'
  | 'circuit_breaker.cleared';

export type RuntimeDisposition =
  | 'ALLOW'
  | 'ALLOW_WITH_WARNING'
  | 'REQUIRE_APPROVAL'
  | 'PAUSE'
  | 'DENY'
  | 'STOP_AGENT';

export type RiskDimensionId =
  | 'DATA_EXPOSURE'
  | 'PRIVILEGE_ESCALATION'
  | 'DESTRUCTIVE_ACTION'
  | 'EXTERNAL_COMMUNICATION'
  | 'FINANCIAL_ACTION'
  | 'PRODUCTION_CHANGE'
  | 'IDENTITY_OR_PERMISSION_CHANGE'
  | 'SECURITY_IMPACT'
  | 'LEGAL_OR_COMPLIANCE'
  | 'PERSONAL_DATA'
  | 'COST_ANOMALY'
  | 'LOOP_ANOMALY'
  | 'UNVERIFIED_EVIDENCE'
  | 'MEMORY_POISONING'
  | 'AGENT_HANDOFF_RISK'
  | 'MODEL_UNCERTAINTY';

export type RuntimeSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RuntimeRiskDimension {
  id: RiskDimensionId;
  score: number;
  severity: RuntimeSeverity;
  reason: string;
  evidence: string[];
  policyIds: string[];
}

export interface RuntimeGovernanceEvent {
  event_id: string;
  type: RuntimeGovernanceEventType | string;
  timestamp: string;
  task_id?: string;
  session_id?: string;
  agent_id: string;
  agent_name?: string;
  agent_type?: string;
  model?: string;
  provider?: string;
  user_id?: string;
  tenant_id?: string;
  tool?: string;
  action?: string;
  target?: string;
  arguments_hash?: string;
  policy_ids?: string[];
  risk_score?: number;
  risk_dimensions?: RuntimeRiskDimension[];
  confidence?: number;
  decision?: RuntimeDisposition | string;
  decision_reason?: string;
  approval_id?: string;
  evidence_ids?: string[];
  artifact_ids?: string[];
  cost?: number;
  token_usage?: RuntimeTokenUsage;
  latency?: number;
  parent_event_id?: string;
  trace_id?: string;
  provenance?: RuntimeProvenance;
  metadata?: Record<string, unknown>;
}

export interface RuntimeTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
}

export type EvidenceVerificationStatus =
  | 'VERIFIED_FACT'
  | 'OBSERVATION'
  | 'INFERENCE'
  | 'ASSUMPTION'
  | 'SPECULATION'
  | 'UNVERIFIED';

export interface RuntimeProvenance {
  source: string;
  sourceUri?: string;
  artifactHash?: string;
  verificationStatus?: EvidenceVerificationStatus;
  confidence?: number;
}

export interface RuntimePolicyRule {
  id: string;
  description: string;
  disposition: Exclude<RuntimeDisposition, 'ALLOW'>;
  match: {
    tools?: string[];
    actions?: string[];
    targets?: string[];
    riskDimensions?: RiskDimensionId[];
  };
  requiresEvidence?: boolean;
}

export interface RuntimeScenarioContract {
  scenarioId: string;
  goal?: string;
  allowedActions?: string[];
  forbiddenActions?: string[];
  allowedTools?: string[];
  forbiddenTools?: string[];
  allowedSystems?: string[];
  dataBoundaries?: string[];
  maximumCostUsd?: number;
  maximumTokens?: number;
  maximumRuntimeMs?: number;
  maximumToolCalls?: number;
  maxLoops?: number;
  requireApprovalFor?: string[];
  requiredEvidenceFor?: string[];
  memoryWritePolicy?: 'allow' | 'allow_with_ttl' | 'require_review' | 'quarantine' | 'reject';
}

export interface RuntimeExecutionContext {
  scenario?: RuntimeScenarioContract;
  priorEvents?: RuntimeGovernanceEvent[];
  hasHumanApproval?: boolean;
  approvalExpiresAt?: string;
  failClosedForHighRisk?: boolean;
  tenantId?: string;
  cumulativeCost?: number;
  cumulativeTokens?: number;
  loopCount?: number;
  retryCount?: number;
}

export interface RuntimePolicyEvaluationInput {
  taskId?: string;
  sessionId?: string;
  agentId: string;
  agentName?: string;
  agentType?: string;
  model?: string;
  provider?: string;
  tenantId?: string;
  tool?: string;
  action: string;
  target?: string;
  argumentsHash?: string;
  evidenceIds?: string[];
  artifactIds?: string[];
  cost?: number;
  tokenUsage?: RuntimeTokenUsage;
  latency?: number;
  confidence?: number;
  context?: RuntimeExecutionContext;
  policies?: RuntimePolicyRule[];
  metadata?: Record<string, unknown>;
}

export interface RuntimePolicyDecision {
  disposition: RuntimeDisposition;
  allowed: boolean;
  requiresApproval: boolean;
  shouldPause: boolean;
  shouldStopAgent: boolean;
  triggeredPolicies: string[];
  riskDimensions: RuntimeRiskDimension[];
  explanation: string;
  requiredApprovalLevel?: string;
  evidenceUsed: string[];
  confidence: number;
  recommendedRemediation: string[];
  event: RuntimeGovernanceEvent;
}

export type CircuitBreakerState = 'CLOSED' | 'WARNING' | 'OPEN' | 'LOCKED';

export interface RuntimeCircuitBreakerConfig {
  maxRepeatedToolCalls?: number;
  maxDeniedActions?: number;
  maxFailures?: number;
  maximumCostUsd?: number;
  maximumTokens?: number;
  lockOnCriticalRisk?: boolean;
  storageOptions?: SafeloopStorageOptions;
}

export interface RuntimeCircuitBreakerStatus {
  state: CircuitBreakerState;
  reason: string | null;
  triggeredAt: string | null;
  counts: {
    repeatedToolCalls: number;
    deniedActions: number;
    failures: number;
  };
}

export interface RuntimeCircuitBreaker {
  evaluate(input: RuntimePolicyEvaluationInput, decision: RuntimePolicyDecision): RuntimeCircuitBreakerStatus;
  status(): RuntimeCircuitBreakerStatus;
  reset(reason?: string): RuntimeCircuitBreakerStatus;
}

export type MemoryDecision = 'ALLOW' | 'ALLOW_WITH_TTL' | 'MERGE' | 'QUARANTINE' | 'REQUIRE_REVIEW' | 'REJECT';

export interface CandidateMemory {
  memory_id: string;
  memory_type: string;
  source_task?: string;
  agent?: string;
  situation: string;
  action?: string;
  outcome?: string;
  lesson: string;
  confidence?: number;
  evidence?: string[];
  reuse_conditions?: string[];
  do_not_generalize?: boolean;
  tenant?: string;
  ttl?: string;
  created_at?: string;
  containsSensitiveData?: boolean;
}

export interface MemoryGovernanceDecision {
  decision: MemoryDecision;
  allowed: boolean;
  reasons: string[];
  requiredEvidence: string[];
  recommendedRemediation: string[];
  event: RuntimeGovernanceEvent;
}

function now(): string {
  return new Date().toISOString();
}

function makeEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalizeList(values?: string[]): string[] {
  return Array.isArray(values)
    ? Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    : [];
}

function includesPattern(values: string[] | undefined, candidate?: string): boolean {
  if (!candidate) return false;
  const lower = candidate.toLowerCase();
  return (values ?? []).some((value) => lower.includes(value.toLowerCase()));
}

function severityForScore(score: number): RuntimeSeverity {
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function addRisk(
  risks: RuntimeRiskDimension[],
  id: RiskDimensionId,
  score: number,
  reason: string,
  evidence: string[] = [],
  policyIds: string[] = [],
): void {
  const existing = risks.find((risk) => risk.id === id);
  if (existing) {
    existing.score = Math.max(existing.score, score);
    existing.severity = severityForScore(existing.score);
    existing.evidence = normalizeList([...existing.evidence, ...evidence]);
    existing.policyIds = normalizeList([...existing.policyIds, ...policyIds]);
    existing.reason = existing.score >= score ? existing.reason : reason;
    return;
  }
  risks.push({
    id,
    score,
    severity: severityForScore(score),
    reason,
    evidence: normalizeList(evidence),
    policyIds: normalizeList(policyIds),
  });
}

function actionContains(input: RuntimePolicyEvaluationInput, patterns: string[]): boolean {
  const text = [input.action, input.tool, input.target].filter(Boolean).join(' ').toLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

function inferRiskDimensions(input: RuntimePolicyEvaluationInput): RuntimeRiskDimension[] {
  const risks: RuntimeRiskDimension[] = [];
  const evidence = normalizeList([...(input.evidenceIds ?? []), ...(input.artifactIds ?? [])]);

  if (actionContains(input, ['delete', 'remove', 'drop', 'format', 'overwrite', 'rm -rf'])) {
    addRisk(risks, 'DESTRUCTIVE_ACTION', 85, 'Action appears destructive.', evidence, ['runtime.destructive-action']);
  }
  if (actionContains(input, ['sudo', 'admin', 'chmod', 'permission', 'role', 'iam', 'identity'])) {
    addRisk(risks, 'PRIVILEGE_ESCALATION', 80, 'Action touches privileged execution or identity boundaries.', evidence, ['runtime.privilege']);
  }
  if (actionContains(input, ['grant access', 'revoke access', 'create user', 'delete user', 'service account', 'api key'])) {
    addRisk(risks, 'IDENTITY_OR_PERMISSION_CHANGE', 85, 'Action may change identity, permissions, or credentials.', evidence, ['runtime.identity-permission-change']);
  }
  if (actionContains(input, ['deploy', 'production', 'release', 'publish'])) {
    addRisk(risks, 'PRODUCTION_CHANGE', 75, 'Action may affect production, publishing, or release state.', evidence, ['runtime.production-change']);
  }
  if (actionContains(input, ['email', 'slack', 'teams', 'webhook', 'http', 'curl', 'post', 'send'])) {
    addRisk(risks, 'EXTERNAL_COMMUNICATION', 70, 'Action may communicate outside the local runtime.', evidence, ['runtime.external-communication']);
  }
  if (actionContains(input, ['student', 'pii', 'ssn', 'ferpa', 'medical', 'password', 'secret'])) {
    addRisk(risks, 'PERSONAL_DATA', 85, 'Action may involve sensitive or personal data.', evidence, ['runtime.personal-data']);
  }
  if (actionContains(input, ['export records', 'upload data', 'copy database', 'share dataset', 'exfiltrate'])) {
    addRisk(risks, 'DATA_EXPOSURE', 80, 'Action may expose internal or tenant data.', evidence, ['runtime.data-exposure']);
  }
  if (actionContains(input, ['payment', 'purchase', 'invoice', 'refund', 'charge card', 'wire transfer'])) {
    addRisk(risks, 'FINANCIAL_ACTION', 80, 'Action may move money or create a financial obligation.', evidence, ['runtime.financial-action']);
  }
  if (actionContains(input, ['security policy', 'firewall', 'credential', 'secret rotation', 'disable mfa', 'encryption'])) {
    addRisk(risks, 'SECURITY_IMPACT', 85, 'Action may affect security controls or credentials.', evidence, ['runtime.security-impact']);
  }
  if (actionContains(input, ['legal hold', 'compliance', 'ferpa', 'coppa', 'contract', 'subpoena'])) {
    addRisk(risks, 'LEGAL_OR_COMPLIANCE', 75, 'Action may affect legal, regulatory, or contractual obligations.', evidence, ['runtime.legal-compliance']);
  }
  if (actionContains(input, ['handoff', 'delegate', 'transfer ownership'])) {
    addRisk(risks, 'AGENT_HANDOFF_RISK', 45, 'Action transfers work or authority between agents.', evidence, ['runtime.agent-handoff-risk']);
  }
  if (typeof input.cost === 'number' && typeof input.context?.scenario?.maximumCostUsd === 'number') {
    const nextCost = (input.context.cumulativeCost ?? 0) + input.cost;
    if (nextCost > input.context.scenario.maximumCostUsd) {
      addRisk(risks, 'COST_ANOMALY', 80, `Estimated cost exceeds scenario budget (${nextCost} > ${input.context.scenario.maximumCostUsd}).`, evidence, ['runtime.cost-budget']);
    }
  }
  const totalTokens = input.tokenUsage?.totalTokens ?? ((input.tokenUsage?.inputTokens ?? 0) + (input.tokenUsage?.outputTokens ?? 0));
  if (typeof input.context?.scenario?.maximumTokens === 'number' && (input.context.cumulativeTokens ?? 0) + totalTokens > input.context.scenario.maximumTokens) {
    addRisk(risks, 'COST_ANOMALY', 75, 'Token usage exceeds scenario budget.', evidence, ['runtime.token-budget']);
  }
  if (typeof input.context?.scenario?.maxLoops === 'number' && (input.context.loopCount ?? 0) >= input.context.scenario.maxLoops) {
    addRisk(risks, 'LOOP_ANOMALY', 80, 'Scenario loop count has reached its configured maximum.', evidence, ['runtime.loop-budget']);
  }
  if ((input.confidence ?? 1) < 0.5) {
    addRisk(risks, 'MODEL_UNCERTAINTY', 45, 'Action confidence is below the configured confidence floor.', evidence, ['runtime.low-confidence']);
  }
  if (input.action.toLowerCase().includes('memory') || input.tool?.toLowerCase().includes('memory')) {
    addRisk(risks, 'MEMORY_POISONING', 45, 'Durable memory writes require provenance checks.', evidence, ['runtime.memory-governance']);
  }

  return risks;
}

function applyScenarioContract(input: RuntimePolicyEvaluationInput, risks: RuntimeRiskDimension[], triggeredPolicies: string[], remediation: string[]): void {
  const scenario = input.context?.scenario;
  if (!scenario) return;

  if (includesPattern(scenario.forbiddenActions, input.action)) {
    addRisk(risks, 'SECURITY_IMPACT', 90, `Action is forbidden by scenario contract: ${input.action}`, input.evidenceIds, ['scenario.forbidden-action']);
    triggeredPolicies.push('scenario.forbidden-action');
    remediation.push('Choose an action explicitly allowed by the active scenario contract.');
  }
  if (scenario.allowedActions?.length && !includesPattern(scenario.allowedActions, input.action)) {
    addRisk(risks, 'AGENT_HANDOFF_RISK', 55, `Action is outside scenario allowed actions: ${input.action}`, input.evidenceIds, ['scenario.action-drift']);
    triggeredPolicies.push('scenario.action-drift');
    remediation.push('Request approval before continuing outside the scenario contract.');
  }
  if (input.tool && includesPattern(scenario.forbiddenTools, input.tool)) {
    addRisk(risks, 'SECURITY_IMPACT', 90, `Tool is forbidden by scenario contract: ${input.tool}`, input.evidenceIds, ['scenario.forbidden-tool']);
    triggeredPolicies.push('scenario.forbidden-tool');
    remediation.push('Use an approved tool for this scenario.');
  }
  if (input.tool && scenario.allowedTools?.length && !includesPattern(scenario.allowedTools, input.tool)) {
    addRisk(risks, 'AGENT_HANDOFF_RISK', 60, `Tool is outside scenario allowed tools: ${input.tool}`, input.evidenceIds, ['scenario.tool-drift']);
    triggeredPolicies.push('scenario.tool-drift');
    remediation.push('Route the tool request through human review or update the scenario contract.');
  }
  if (input.target && scenario.allowedSystems?.length && !includesPattern(scenario.allowedSystems, input.target)) {
    addRisk(risks, 'DATA_EXPOSURE', 70, `Target is outside scenario allowed systems: ${input.target}`, input.evidenceIds, ['scenario.system-boundary']);
    triggeredPolicies.push('scenario.system-boundary');
    remediation.push('Keep actions inside the configured system boundary.');
  }
  if (includesPattern(scenario.requireApprovalFor, input.action) || includesPattern(scenario.requireApprovalFor, input.tool)) {
    triggeredPolicies.push('scenario.approval-required');
    remediation.push('Collect human approval before executing this action.');
  }
  if (includesPattern(scenario.requiredEvidenceFor, input.action) && !input.evidenceIds?.length && !input.artifactIds?.length) {
    addRisk(risks, 'UNVERIFIED_EVIDENCE', 65, 'Scenario requires evidence before this action.', [], ['scenario.evidence-required']);
    triggeredPolicies.push('scenario.evidence-required');
    remediation.push('Attach supporting evidence before continuing.');
  }
}

function applyCustomPolicies(input: RuntimePolicyEvaluationInput, risks: RuntimeRiskDimension[], triggeredPolicies: string[], remediation: string[]): RuntimeDisposition[] {
  const dispositions: RuntimeDisposition[] = [];
  for (const policy of input.policies ?? []) {
    const matchesTool = !policy.match.tools?.length || includesPattern(policy.match.tools, input.tool);
    const matchesAction = !policy.match.actions?.length || includesPattern(policy.match.actions, input.action);
    const matchesTarget = !policy.match.targets?.length || includesPattern(policy.match.targets, input.target);
    const matchesRisk = !policy.match.riskDimensions?.length || policy.match.riskDimensions.some((id) => risks.some((risk) => risk.id === id));
    if (matchesTool && matchesAction && matchesTarget && matchesRisk) {
      triggeredPolicies.push(policy.id);
      dispositions.push(policy.disposition);
      if (policy.requiresEvidence && !input.evidenceIds?.length && !input.artifactIds?.length) {
        addRisk(risks, 'UNVERIFIED_EVIDENCE', 70, `Policy requires evidence: ${policy.description}`, [], [policy.id]);
        remediation.push('Attach evidence before the action is allowed.');
      }
    }
  }
  return dispositions;
}

function chooseDisposition(input: RuntimePolicyEvaluationInput, risks: RuntimeRiskDimension[], customDispositions: RuntimeDisposition[], triggeredPolicies: string[]): RuntimeDisposition {
  const hasCritical = risks.some((risk) => risk.severity === 'critical');
  const hasHigh = risks.some((risk) => risk.severity === 'high');
  const requiresApproval = triggeredPolicies.some((id) => id.includes('approval-required'));
  const expiredApproval = input.context?.approvalExpiresAt ? Date.parse(input.context.approvalExpiresAt) < Date.now() : false;

  if (customDispositions.includes('DENY') || triggeredPolicies.includes('scenario.forbidden-action') || triggeredPolicies.includes('scenario.forbidden-tool')) return 'DENY';
  if (customDispositions.includes('STOP_AGENT') || (hasCritical && input.context?.failClosedForHighRisk !== false)) return 'STOP_AGENT';
  if (expiredApproval) return 'REQUIRE_APPROVAL';
  if (customDispositions.includes('PAUSE')) return 'PAUSE';
  if ((requiresApproval || hasHigh || customDispositions.includes('REQUIRE_APPROVAL')) && !input.context?.hasHumanApproval) return 'REQUIRE_APPROVAL';
  if (risks.some((risk) => risk.severity === 'medium') || customDispositions.includes('ALLOW_WITH_WARNING')) return 'ALLOW_WITH_WARNING';
  return 'ALLOW';
}

function decisionFlags(disposition: RuntimeDisposition): Pick<RuntimePolicyDecision, 'allowed' | 'requiresApproval' | 'shouldPause' | 'shouldStopAgent'> {
  return {
    allowed: disposition === 'ALLOW' || disposition === 'ALLOW_WITH_WARNING',
    requiresApproval: disposition === 'REQUIRE_APPROVAL',
    shouldPause: disposition === 'PAUSE' || disposition === 'REQUIRE_APPROVAL',
    shouldStopAgent: disposition === 'STOP_AGENT' || disposition === 'DENY',
  };
}

export function normalizeRuntimeEvent(input: RuntimeGovernanceEvent | SafeloopStreamEvent): RuntimeGovernanceEvent {
  const metadata = input.metadata ? { ...input.metadata } : undefined;
  const event = input as RuntimeGovernanceEvent & SafeloopStreamEvent;
  return {
    event_id: event.event_id ?? event.id,
    type: event.type,
    timestamp: event.timestamp,
    task_id: event.task_id ?? (metadata?.taskId as string | undefined),
    session_id: event.session_id ?? event.sessionId,
    agent_id: event.agent_id ?? event.agentId,
    agent_name: event.agent_name ?? event.agentName,
    agent_type: event.agent_type ?? (metadata?.agentType as string | undefined),
    model: event.model ?? (metadata?.model as string | undefined),
    provider: event.provider ?? (metadata?.provider as string | undefined),
    user_id: event.user_id ?? (metadata?.userId as string | undefined),
    tenant_id: event.tenant_id ?? (metadata?.tenantId as string | undefined),
    tool: event.tool ?? (metadata?.tool as string | undefined),
    action: event.action ?? (metadata?.action as string | undefined),
    target: event.target ?? (metadata?.target as string | undefined),
    arguments_hash: event.arguments_hash ?? (metadata?.argumentsHash as string | undefined),
    policy_ids: event.policy_ids ?? (metadata?.policyIds as string[] | undefined),
    risk_score: event.risk_score ?? (metadata?.riskScore as number | undefined),
    risk_dimensions: event.risk_dimensions,
    confidence: event.confidence ?? (metadata?.confidence as number | undefined),
    decision: event.decision ?? (metadata?.decision as string | undefined),
    decision_reason: event.decision_reason ?? (metadata?.reason as string | undefined) ?? (metadata?.rationale as string | undefined),
    approval_id: event.approval_id ?? (metadata?.approvalId as string | undefined),
    evidence_ids: event.evidence_ids ?? (metadata?.evidenceIds as string[] | undefined),
    artifact_ids: event.artifact_ids ?? (metadata?.artifactIds as string[] | undefined),
    cost: event.cost ?? (metadata?.estimatedCost as number | undefined),
    token_usage: event.token_usage,
    latency: event.latency ?? (metadata?.durationMs as number | undefined),
    parent_event_id: event.parent_event_id ?? (metadata?.parentEventId as string | undefined),
    trace_id: event.trace_id ?? (metadata?.traceId as string | undefined),
    provenance: event.provenance,
    metadata,
  };
}

export function evaluateRuntimePolicy(input: RuntimePolicyEvaluationInput): RuntimePolicyDecision {
  const riskDimensions = inferRiskDimensions(input);
  const triggeredPolicies = normalizeList(riskDimensions.flatMap((risk) => risk.policyIds));
  const recommendedRemediation: string[] = [];
  applyScenarioContract(input, riskDimensions, triggeredPolicies, recommendedRemediation);
  const customDispositions = applyCustomPolicies(input, riskDimensions, triggeredPolicies, recommendedRemediation);
  const disposition = chooseDisposition(input, riskDimensions, customDispositions, triggeredPolicies);
  const flags = decisionFlags(disposition);
  const evidenceUsed = normalizeList([...(input.evidenceIds ?? []), ...(input.artifactIds ?? [])]);
  const confidence = input.confidence ?? (riskDimensions.some((risk) => risk.id === 'MODEL_UNCERTAINTY') ? 0.45 : 0.85);
  const explanation = riskDimensions.length > 0
    ? riskDimensions.map((risk) => `${risk.id}: ${risk.reason}`).join(' ')
    : 'No deterministic runtime governance rule was triggered.';

  const event: RuntimeGovernanceEvent = {
    event_id: makeEventId('policy'),
    type: disposition === 'ALLOW' || disposition === 'ALLOW_WITH_WARNING' ? 'policy.passed' : 'policy.failed',
    timestamp: now(),
    task_id: input.taskId,
    session_id: input.sessionId,
    agent_id: input.agentId,
    agent_name: input.agentName,
    agent_type: input.agentType,
    model: input.model,
    provider: input.provider,
    tenant_id: input.tenantId ?? input.context?.tenantId,
    tool: input.tool,
    action: input.action,
    target: input.target,
    arguments_hash: input.argumentsHash,
    policy_ids: triggeredPolicies,
    risk_score: riskDimensions.reduce((max, risk) => Math.max(max, risk.score), 0),
    risk_dimensions: riskDimensions,
    confidence,
    decision: disposition,
    decision_reason: explanation,
    evidence_ids: input.evidenceIds,
    artifact_ids: input.artifactIds,
    cost: input.cost,
    token_usage: input.tokenUsage,
    latency: input.latency,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };

  return {
    disposition,
    ...flags,
    triggeredPolicies,
    riskDimensions,
    explanation,
    requiredApprovalLevel: flags.requiresApproval ? 'human_operator' : undefined,
    evidenceUsed,
    confidence,
    recommendedRemediation: normalizeList(recommendedRemediation),
    event,
  };
}

function toStreamEvent(event: RuntimeGovernanceEvent): SafeloopStreamEventInput {
  return {
    id: event.event_id,
    type: event.type,
    timestamp: event.timestamp,
    agentId: event.agent_id,
    agentName: event.agent_name,
    caseId: event.task_id,
    sessionId: event.session_id,
    summary: event.decision_reason ?? `${event.type}: ${event.action ?? event.tool ?? 'runtime event'}`,
    metadata: {
      ...(event.metadata ?? {}),
      runtimeGovernance: true,
      taskId: event.task_id,
      agentType: event.agent_type,
      tenantId: event.tenant_id,
      tool: event.tool,
      action: event.action,
      target: event.target,
      policyIds: event.policy_ids,
      riskScore: event.risk_score,
      riskDimensions: event.risk_dimensions,
      confidence: event.confidence,
      decision: event.decision,
      reason: event.decision_reason,
      evidenceIds: event.evidence_ids,
      artifactIds: event.artifact_ids,
      cost: event.cost,
      tokenUsage: event.token_usage,
      latency: event.latency,
      parentEventId: event.parent_event_id,
      traceId: event.trace_id,
      provenance: event.provenance,
    },
  };
}

export function recordRuntimeGovernanceEvent(
  event: RuntimeGovernanceEvent,
  options: SafeloopStorageOptions = {},
): SafeloopStreamEvent {
  return appendEvent(toStreamEvent(event), options);
}

export function createRuntimeCircuitBreaker(config: RuntimeCircuitBreakerConfig = {}): RuntimeCircuitBreaker {
  const maxRepeatedToolCalls = config.maxRepeatedToolCalls ?? 3;
  const maxDeniedActions = config.maxDeniedActions ?? 2;
  const maxFailures = config.maxFailures ?? 3;
  const lockOnCriticalRisk = config.lockOnCriticalRisk ?? true;
  const seenToolCalls = new Map<string, number>();
  let deniedActions = 0;
  let failures = 0;
  let state: CircuitBreakerState = 'CLOSED';
  let reason: string | null = null;
  let triggeredAt: string | null = null;

  function snapshot(): RuntimeCircuitBreakerStatus {
    return {
      state,
      reason,
      triggeredAt,
      counts: {
        repeatedToolCalls: Math.max(0, ...Array.from(seenToolCalls.values())),
        deniedActions,
        failures,
      },
    };
  }

  function transition(nextState: CircuitBreakerState, nextReason: string, input: RuntimePolicyEvaluationInput): void {
    if (state === 'LOCKED') return;
    if (state === nextState && reason === nextReason) return;
    state = nextState;
    reason = nextReason;
    triggeredAt = now();
    if (nextState !== 'CLOSED') {
      recordRuntimeGovernanceEvent({
        event_id: makeEventId('circuit'),
        type: 'circuit_breaker.triggered',
        timestamp: triggeredAt,
        task_id: input.taskId,
        session_id: input.sessionId,
        agent_id: input.agentId,
        agent_name: input.agentName,
        agent_type: input.agentType,
        tool: input.tool,
        action: input.action,
        target: input.target,
        decision: nextState === 'WARNING' ? 'ALLOW_WITH_WARNING' : nextState === 'OPEN' ? 'PAUSE' : 'STOP_AGENT',
        decision_reason: nextReason,
        metadata: { circuitState: nextState },
      }, config.storageOptions);
    }
  }

  return {
    evaluate(input: RuntimePolicyEvaluationInput, decision: RuntimePolicyDecision): RuntimeCircuitBreakerStatus {
      const key = [input.tool ?? 'unknown-tool', input.action, input.target ?? 'unknown-target', input.argumentsHash ?? ''].join('|');
      seenToolCalls.set(key, (seenToolCalls.get(key) ?? 0) + 1);
      if (decision.disposition === 'DENY' || decision.disposition === 'STOP_AGENT') deniedActions += 1;
      if (decision.event.type === 'tool.failed' || input.action.toLowerCase().includes('failed')) failures += 1;

      const repeatedToolCalls = seenToolCalls.get(key) ?? 0;
      const maxRisk = Math.max(0, ...decision.riskDimensions.map((risk) => risk.score));
      const totalTokens = (input.context?.cumulativeTokens ?? 0) + (input.tokenUsage?.totalTokens ?? 0);
      const totalCost = (input.context?.cumulativeCost ?? 0) + (input.cost ?? 0);

      if (lockOnCriticalRisk && maxRisk >= 90) {
        transition('LOCKED', 'Critical runtime risk triggered fail-closed circuit lock.', input);
      } else if (deniedActions >= maxDeniedActions) {
        transition('OPEN', `Denied action threshold reached (${deniedActions}/${maxDeniedActions}).`, input);
      } else if (failures >= maxFailures) {
        transition('OPEN', `Failure threshold reached (${failures}/${maxFailures}).`, input);
      } else if (repeatedToolCalls >= maxRepeatedToolCalls) {
        transition('WARNING', `Repeated tool-call threshold reached (${repeatedToolCalls}/${maxRepeatedToolCalls}).`, input);
      } else if (typeof config.maximumTokens === 'number' && totalTokens > config.maximumTokens) {
        transition('OPEN', `Token threshold exceeded (${totalTokens}/${config.maximumTokens}).`, input);
      } else if (typeof config.maximumCostUsd === 'number' && totalCost > config.maximumCostUsd) {
        transition('OPEN', `Cost threshold exceeded (${totalCost}/${config.maximumCostUsd}).`, input);
      }

      return snapshot();
    },
    status: snapshot,
    reset(resetReason?: string): RuntimeCircuitBreakerStatus {
      seenToolCalls.clear();
      deniedActions = 0;
      failures = 0;
      state = 'CLOSED';
      reason = resetReason ?? null;
      triggeredAt = null;
      return snapshot();
    },
  };
}

export function verifyCandidateMemory(
  memory: CandidateMemory,
  options: {
    scenario?: RuntimeScenarioContract;
    minimumConfidence?: number;
    storageOptions?: SafeloopStorageOptions;
  } = {},
): MemoryGovernanceDecision {
  const reasons: string[] = [];
  const remediation: string[] = [];
  const evidence = normalizeList(memory.evidence);
  const minimumConfidence = options.minimumConfidence ?? 0.7;
  let decision: MemoryDecision = 'ALLOW';

  if (!memory.situation.trim() || !memory.lesson.trim()) {
    decision = 'REJECT';
    reasons.push('Candidate memory must include a situation and lesson.');
    remediation.push('Provide the task situation and the lesson before retrying.');
  }
  if (memory.containsSensitiveData) {
    decision = decision === 'REJECT' ? decision : 'REQUIRE_REVIEW';
    reasons.push('Candidate memory may contain sensitive data.');
    remediation.push('Review tenant ownership and remove sensitive details before durable storage.');
  }
  if (memory.do_not_generalize) {
    decision = decision === 'REJECT' ? decision : 'QUARANTINE';
    reasons.push('Candidate memory is marked do_not_generalize.');
    remediation.push('Keep this memory scoped to the original task or attach narrower reuse conditions.');
  }
  if ((memory.confidence ?? 0) < minimumConfidence) {
    decision = decision === 'REJECT' ? decision : 'QUARANTINE';
    reasons.push(`Candidate confidence is below threshold (${memory.confidence ?? 0} < ${minimumConfidence}).`);
    remediation.push('Attach stronger outcome evidence before writing durable memory.');
  }
  if (evidence.length === 0 && decision === 'ALLOW') {
    decision = 'REQUIRE_REVIEW';
    reasons.push('Candidate memory has no supporting evidence.');
    remediation.push('Attach evidence from a completed task, artifact, or verified observation.');
  }
  if (options.scenario?.memoryWritePolicy === 'reject') {
    decision = 'REJECT';
    reasons.push('Scenario contract rejects durable memory writes.');
  } else if (options.scenario?.memoryWritePolicy === 'require_review' && decision === 'ALLOW') {
    decision = 'REQUIRE_REVIEW';
    reasons.push('Scenario contract requires review for durable memory writes.');
  } else if (options.scenario?.memoryWritePolicy === 'quarantine' && decision === 'ALLOW') {
    decision = 'QUARANTINE';
    reasons.push('Scenario contract quarantines memory writes.');
  } else if (options.scenario?.memoryWritePolicy === 'allow_with_ttl' && decision === 'ALLOW') {
    decision = 'ALLOW_WITH_TTL';
    reasons.push('Scenario contract allows memory writes only with a TTL.');
  }

  const eventType: RuntimeGovernanceEventType =
    decision === 'ALLOW' || decision === 'ALLOW_WITH_TTL'
      ? 'memory.write.allowed'
      : decision === 'REJECT'
        ? 'memory.write.rejected'
        : 'memory.write.quarantined';
  const event: RuntimeGovernanceEvent = {
    event_id: makeEventId('memory'),
    type: eventType,
    timestamp: now(),
    task_id: memory.source_task,
    agent_id: memory.agent ?? 'memory-guard',
    agent_name: memory.agent,
    tenant_id: memory.tenant,
    action: 'memory.write',
    target: memory.memory_type,
    evidence_ids: evidence,
    confidence: memory.confidence,
    decision,
    decision_reason: reasons.length > 0 ? reasons.join(' ') : 'Candidate memory passed deterministic provenance checks.',
    metadata: {
      memoryId: memory.memory_id,
      memoryType: memory.memory_type,
      reuseConditions: memory.reuse_conditions,
      ttl: memory.ttl,
      createdAt: memory.created_at,
    },
  };
  recordRuntimeGovernanceEvent(event, options.storageOptions);

  return {
    decision,
    allowed: decision === 'ALLOW' || decision === 'ALLOW_WITH_TTL',
    reasons: reasons.length > 0 ? reasons : ['Candidate memory passed deterministic provenance checks.'],
    requiredEvidence: evidence,
    recommendedRemediation: normalizeList(remediation),
    event,
  };
}
