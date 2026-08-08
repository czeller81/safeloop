/**
 * SafeLoop Runtime Protocol — safeloop.runtime.v1
 *
 * This module is the TypeScript *projection* of a language-neutral protocol.
 * The normative definition lives in `protocol/schemas/*.json` (JSON Schema).
 * TypeScript types here must never carry semantics the schemas do not express:
 *
 *   "SafeLoop can be implemented in TypeScript.
 *    SafeLoop cannot be dependent on TypeScript."
 *
 * Every structure below is plain JSON: no classes, no Dates, no Maps, no
 * functions, no symbols. Any conforming client in any language can produce and
 * consume these payloads.
 */

export const PROTOCOL_VERSION = 'safeloop.runtime.v1';

/** Action families SafeLoop can canonicalize and manage. */
export type ActionKind =
  | 'shell'
  | 'filesystem'
  | 'git'
  | 'http'
  | 'mcp'
  | 'memory'
  | 'delegation'
  | 'custom';

export type RuntimeDispositionCode =
  | 'ALLOW'
  | 'ALLOW_WITH_WARNING'
  | 'REQUIRE_APPROVAL'
  | 'PAUSE'
  | 'DENY'
  | 'STOP_AGENT';

export type MemoryDecisionCode =
  | 'ALLOW'
  | 'ALLOW_WITH_TTL'
  | 'MERGE'
  | 'QUARANTINE'
  | 'REQUIRE_REVIEW'
  | 'REJECT';

/** MANAGED / UNMANAGED / DISABLED path model (Stage S). */
export type ManagedPathState = 'MANAGED' | 'UNMANAGED' | 'DISABLED';

// --- Identity & context ---------------------------------------------------

export interface AgentIdentity {
  agent_id: string;
  agent_name?: string;
  agent_type?: string;
  model?: string;
  provider?: string;
  parent_agent_id?: string;
  human_operator?: string;
}

export interface SessionContext {
  session_id: string;
  tenant_id: string;
  agent: AgentIdentity;
  workspace?: string;
  profile?: string;
  scenario_id?: string;
  started_at: string;
  trace_id?: string;
}

export interface TaskContext {
  task_id: string;
  session_id: string;
  tenant_id: string;
  goal?: string;
  started_at: string;
  trace_id?: string;
}

export interface ScenarioContext {
  scenario_id: string;
  goal?: string;
  allowed_actions?: string[];
  forbidden_actions?: string[];
  allowed_tools?: string[];
  forbidden_tools?: string[];
  require_approval_for?: string[];
  memory_write_policy?: 'allow' | 'allow_with_ttl' | 'require_review' | 'quarantine' | 'reject';
  maximum_cost_usd?: number;
  maximum_tokens?: number;
  maximum_runtime_ms?: number;
  maximum_tool_calls?: number;
  max_loops?: number;
}

// --- Action model ---------------------------------------------------------

/**
 * What an agent asks to do, before any normalization.
 * Adapters build this from native agent tool calls.
 */
export interface ActionProposal {
  protocol_version?: string;
  action_kind: ActionKind;
  tool?: string;
  operation?: string;
  arguments?: Record<string, unknown>;
  cwd?: string;
  target?: string;
  resource?: string;
  method?: string;
  agent_id: string;
  parent_agent_id?: string;
  task_id?: string;
  session_id?: string;
  scenario_id?: string;
  tenant_id?: string;
  trace_id?: string;
  /** Free-form adapter metadata; never part of the fingerprint. */
  metadata?: Record<string, unknown>;
}

/**
 * The deterministic normalized form of an ActionProposal.
 * Two logically identical proposals always canonicalize identically.
 */
export interface CanonicalAction {
  protocol_version: string;
  action_kind: ActionKind;
  tool: string;
  operation: string;
  arguments: Record<string, unknown>;
  cwd: string;
  target: string;
  resource: string;
  method: string;
  agent_id: string;
  parent_agent_id: string;
  task_id: string;
  session_id: string;
  scenario_id: string;
  tenant_id: string;
  /**
   * Correlation lineage. Deliberately EXCLUDED from the fingerprint:
   * an approval requested in one trace must remain redeemable by the
   * execution that follows it. See docs/APPROVAL_MODEL.md.
   */
  trace_id: string;
}

export interface ActionFingerprint {
  protocol_version: string;
  /** Lowercase hex SHA-256 over the canonical serialization. */
  fingerprint: string;
  algorithm: 'sha256';
  /** The exact bytes that were hashed, for audit reproducibility. */
  canonical_form: string;
}

export interface GovernanceDecision {
  protocol_version: string;
  decision_id: string;
  disposition: RuntimeDispositionCode;
  allowed: boolean;
  requires_approval: boolean;
  action_fingerprint: string;
  risk_score: number;
  triggered_policies: string[];
  explanation: string;
  recommended_remediation: string[];
  evaluated_at: string;
  /** Present only when the decision authorizes immediate execution. */
  execution_permit?: ExecutionPermit;
  /** Present when the disposition is REQUIRE_APPROVAL. */
  approval_request?: ApprovalRequestRecord;
}

// --- Approvals ------------------------------------------------------------

export interface ApprovalRequestRecord {
  protocol_version: string;
  approval_request_id: string;
  action_fingerprint: string;
  agent_id: string;
  task_id: string;
  session_id: string;
  scenario_id: string;
  tenant_id: string;
  reason: string;
  risk_score: number;
  requested_at: string;
}

export interface ApprovalGrant {
  protocol_version: string;
  approval_id: string;
  approval_request_id: string;
  approver: string;
  granted_at: string;
  token: BoundApprovalToken;
}

/**
 * An integrity-protected, action-bound, single-use authorization.
 * `signature` is HMAC-SHA256 over the bound claim set with a runtime secret.
 */
export interface BoundApprovalToken {
  protocol_version: string;
  approval_id: string;
  action_fingerprint: string;
  agent_id: string;
  task_id: string;
  session_id: string;
  scenario_id: string;
  tenant_id: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  policy_version: string;
  approver: string;
  signature: string;
}

export type ApprovalRedemptionFailure =
  | 'forged'
  | 'expired'
  | 'revoked'
  | 'consumed'
  | 'fingerprint_mismatch'
  | 'agent_mismatch'
  | 'task_mismatch'
  | 'session_mismatch'
  | 'scenario_mismatch'
  | 'tenant_mismatch'
  | 'not_approval_required'
  | 'unknown_token'
  | 'state_corrupted';

export interface ApprovalRedemption {
  protocol_version: string;
  redeemed: boolean;
  approval_id: string;
  failure?: ApprovalRedemptionFailure;
  reason?: string;
  redeemed_at?: string;
  /** Issued only on successful redemption. */
  execution_permit?: ExecutionPermit;
}

// --- Execution ------------------------------------------------------------

/**
 * A permit is the ONLY thing a managed executor accepts. It binds an exact
 * canonical action to an authorization that expires and can be consumed once.
 */
export interface ExecutionPermit {
  protocol_version: string;
  permit_id: string;
  action_fingerprint: string;
  agent_id: string;
  task_id: string;
  session_id: string;
  scenario_id: string;
  tenant_id: string;
  disposition: RuntimeDispositionCode;
  approval_id?: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  signature: string;
}

export interface ExecutionRequest {
  protocol_version: string;
  permit: ExecutionPermit;
  action: ActionProposal;
  timeout_ms?: number;
}

export type ExecutionStatus =
  | 'EXECUTED'
  | 'REJECTED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'BLOCKED_BY_BREAKER'
  | 'BLOCKED_BY_BUDGET';

export type ExecutionRejectionReason =
  | 'missing_permit'
  | 'permit_forged'
  | 'permit_expired'
  | 'permit_consumed'
  | 'fingerprint_mismatch'
  | 'identity_mismatch'
  | 'tenant_mismatch'
  | 'task_mismatch'
  | 'breaker_open'
  | 'budget_exhausted'
  | 'invalid_runtime_state'
  | 'unsupported_action_kind'
  | 'executor_error';

export interface ExecutionResult {
  protocol_version: string;
  execution_id: string;
  permit_id: string;
  action_fingerprint: string;
  status: ExecutionStatus;
  rejection_reason?: ExecutionRejectionReason;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  evidence_ids: string[];
  artifact_ids: string[];
  detail?: Record<string, unknown>;
}

// --- Memory ---------------------------------------------------------------

export interface MemoryCandidate {
  protocol_version?: string;
  memory_id: string;
  memory_type: string;
  situation: string;
  action?: string;
  outcome?: string;
  lesson: string;
  confidence?: number;
  evidence?: string[];
  provenance?: string;
  reuse_conditions?: string[];
  do_not_generalize?: boolean;
  tenant_id?: string;
  agent_id?: string;
  task_id?: string;
  session_id?: string;
  trace_id?: string;
  source_artifacts?: string[];
  requested_ttl?: string;
  contradicts?: string[];
  supersedes?: string[];
  contains_sensitive_data?: boolean;
  created_at?: string;
}

export interface MemoryCandidateFingerprint {
  protocol_version: string;
  fingerprint: string;
  algorithm: 'sha256';
  canonical_form: string;
}

export interface MemoryDecision {
  protocol_version: string;
  memory_decision_id: string;
  decision: MemoryDecisionCode;
  allowed: boolean;
  candidate_fingerprint: string;
  reasons: string[];
  recommended_remediation: string[];
  decided_at: string;
  /** Issued only when the decision authorizes durable activation. */
  persistence_permit?: MemoryPersistencePermit;
}

export interface MemoryPersistencePermit {
  protocol_version: string;
  permit_id: string;
  memory_decision_id: string;
  candidate_fingerprint: string;
  memory_id: string;
  agent_id: string;
  task_id: string;
  tenant_id: string;
  decision: MemoryDecisionCode;
  ttl?: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  signature: string;
}

export interface MemoryProvenanceRecord {
  protocol_version: string;
  memory_id: string;
  candidate_fingerprint: string;
  originating_agent: string;
  originating_task: string;
  tenant_id: string;
  evidence_ids: string[];
  artifact_ids: string[];
  confidence: number;
  decision: MemoryDecisionCode;
  created_at: string;
  verified_at?: string;
  expires_at?: string;
  supersedes: string[];
  contradicts: string[];
  reuse_conditions: string[];
  do_not_generalize: boolean;
  status: 'ACTIVE' | 'QUARANTINED' | 'REVIEW_REQUIRED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
}

// --- Evidence & events ----------------------------------------------------

export interface EvidenceRecord {
  protocol_version: string;
  evidence_id: string;
  kind: string;
  description: string;
  content_hash?: string;
  uri?: string;
  agent_id: string;
  task_id: string;
  tenant_id: string;
  recorded_at: string;
}

export interface ArtifactRecord {
  protocol_version: string;
  artifact_id: string;
  path: string;
  content_hash: string;
  operation: string;
  agent_id: string;
  task_id: string;
  tenant_id: string;
  recorded_at: string;
}

export interface RuntimeEvent {
  protocol_version: string;
  event_id: string;
  type: string;
  timestamp: string;
  agent_id: string;
  task_id?: string;
  session_id?: string;
  tenant_id?: string;
  action_fingerprint?: string;
  decision?: string;
  detail?: Record<string, unknown>;
}

// --- Managed paths, health, conformance ----------------------------------

export interface ManagedPathDeclaration {
  path: string;
  state: ManagedPathState;
  consequential: boolean;
  /** True when this declaration can block full-profile certification. */
  certification_impact: boolean;
  mechanism?: string;
  notes?: string;
}

export interface RuntimeHealth {
  protocol_version: string;
  runtime_version: string;
  status: 'HEALTHY' | 'DEGRADED' | 'STOPPING';
  transport: string[];
  started_at: string;
  uptime_ms: number;
  active_sessions: number;
  pid: number;
}

export type ConformanceStatus =
  | 'CORE_CONFORMANT'
  | 'RUNTIME_CONFORMANT'
  | 'PROFILE_CONFORMANT'
  | 'PASS_WITH_LIMITATIONS'
  | 'NOT_CONFORMANT';

export interface ConformanceCheckResult {
  id: string;
  name: string;
  category: string;
  required: boolean;
  /**
   * False when the profile under test does not enable the capability this
   * check exercises. Not applicable is neither a pass nor a failure, and is
   * excluded from the status calculation.
   */
  applicable?: boolean;
  passed: boolean;
  expected: string;
  actual: string;
  detail?: string;
}

export interface ConformanceResult {
  protocol_version: string;
  status: ConformanceStatus;
  profile: string;
  adapter: string;
  total: number;
  passed: number;
  failed: number;
  /** Checks excluded because the profile does not enable what they exercise. */
  not_applicable?: number;
  limitations: string[];
  managed_paths: ManagedPathDeclaration[];
  checks: ConformanceCheckResult[];
  generated_at: string;
}
