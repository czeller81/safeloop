/**
 * SafeLoop runtime core.
 *
 * Owns the state that must not be caller-supplied: sessions, tasks, identity,
 * scenario, profile, breaker state, budgets, approvals, permits, evidence, and
 * memory decisions. Adapters and SDKs talk to this; they never hold policy.
 *
 * The identity rule this module enforces is the one that makes the rest
 * meaningful: after a session is established, the *caller* cannot change who it
 * is. An adapter passes a session credential and a task id; agent, tenant,
 * scenario, and workspace come from the runtime's own session record. An agent
 * that asks to act as another tenant is not trusted to be telling the truth
 * about which tenant it is.
 */

import { randomBytes } from 'crypto';
import { canonicalizeAction, describeCanonicalAction, fingerprintAction } from './canonicalAction';
import { createApprovalAuthority, type ApprovalAuthority } from './boundApproval';
import { createPermitAuthority, type PermitAuthority } from './executionPermit';
import { createBudgetTracker, type BudgetTracker } from './budgets';
import { createManagedExecutor, type BreakerGate, type ManagedExecutor } from './managedExecutor';
import { createRuntimeRecorder, type RuntimeRecorder } from './recorder';
import { sep } from 'path';
import { resolveRealPath } from './workspace';
import {
  captureExecutionContext,
  compareAuthorizationContext,
  type AuthorizationContext,
} from './executionContext';
import { createMemoryGateway, type MemoryGateway, type MemoryPersistenceAuthorization } from './memoryGateway';
import { createGovernedMemoryStore, type GovernedMemoryStore, type MemoryWriteResult } from './memoryStore';
import { evaluateProfile, loadProfile, moreSevere, type GovernanceProfile, type RuntimeControlDeclaration } from './profiles';
import { createShellExecutor } from './executors/shell';
import { createFilesystemExecutor } from './executors/filesystem';
import { createGitExecutor } from './executors/git';
import { createHttpExecutor, type HttpFetch } from './executors/http';
import { createMcpExecutor, type McpInvoker } from './executors/mcp';
import { loadRuntimeSecret } from './runtimeSecret';
import { evaluateRuntimePolicy, createRuntimeCircuitBreaker, type RuntimeCircuitBreaker } from '../runtimeGovernance';
import {
  PROTOCOL_VERSION,
  type ActionProposal,
  type AgentIdentity,
  type ApprovalGrant,
  type ApprovalRedemption,
  type BoundApprovalToken,
  type ExecutionPermit,
  type ExecutionResult,
  type GovernanceDecision,
  type ManagedPathDeclaration,
  type MemoryCandidate,
  type MemoryDecision,
  type MemoryPersistencePermit,
  type RuntimeDispositionCode,
  type RuntimeControlStatus,
  type RuntimeControlVerification,
  type RuntimeHealth,
  type SessionContext,
  type TaskContext,
} from './protocol';
import type { SafeloopStorageOptions } from '../localStorage';

export const RUNTIME_VERSION = '0.2.0';

export interface StartSessionInput {
  agent: AgentIdentity;
  tenant_id: string;
  workspace?: string;
  profile?: string;
  scenario_id?: string;
  trace_id?: string;
  /** Present only for delegated sub-agent sessions. */
  parent_session_id?: string;
  parent_credential?: string;
}

export interface SessionHandle {
  session: SessionContext;
  /** Bearer credential the adapter must present on every subsequent call. */
  credential: string;
  profile: GovernanceProfile;
  managed_paths: ManagedPathDeclaration[];
}

export interface SessionState {
  session: SessionContext;
  credential: string;
  profile: GovernanceProfile;
  budget: BudgetTracker;
  breaker: RuntimeCircuitBreaker;
  tasks: Map<string, TaskContext>;
  pendingApprovals: Map<string, {
    request: ReturnType<ApprovalAuthority['request']>;
    proposal: ActionProposal;
    /**
     * The host state resolved when the operator was asked. Re-checked at
     * redemption so an approval cannot be spent on a location that moved after
     * the decision was made (SL-RC3-CRIT-001).
     */
    context: AuthorizationContext;
    /**
     * The approval minted for this request, once one has been. One human
     * decision authorizes one execution, so a second grant is refused rather
     * than quietly minting a second independently redeemable token
     * (SL-RC3-HIGH-004).
     */
    granted_approval_id?: string;
  }>;
  parent_session_id?: string;
  finished_at?: string;
  /** Adapter-reported control verifications, keyed by control_id. */
  controlVerifications: Map<string, RuntimeControlVerification>;
  /** Set when a control the profile requires could not be confirmed. */
  blocked_reason?: string;
}

export type RuntimeErrorCode =
  | 'unauthenticated'
  | 'unknown_session'
  | 'unknown_task'
  | 'session_finished'
  | 'identity_substitution'
  | 'privilege_widening'
  | 'unknown_approval_request'
  | 'approval_already_granted'
  | 'invalid_request';

export class RuntimeError extends Error {
  constructor(public readonly code: RuntimeErrorCode, message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export interface SafeloopRuntimeConfig {
  storageOptions?: SafeloopStorageOptions;
  defaultProfile?: string;
  workspace?: string;
  secret?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  fetchImpl?: HttpFetch;
  mcpInvoke?: McpInvoker;
  /**
   * Replace the bundled reference memory store. The reference store exists to
   * prove the binding architecture and to serve conformance runs; it is not
   * the preferred memory engine and is not required. Deployments with their
   * own store either inject it here or skip it entirely and call
   * `authorizeMemoryPersistence` before activating anything.
   */
  memoryStore?: GovernedMemoryStore;
}

export interface SafeloopRuntime {
  startSession(input: StartSessionInput): SessionHandle;
  startTask(credential: string, input: { session_id: string; task_id?: string; goal?: string }): TaskContext;
  propose(credential: string, input: { session_id: string; task_id: string; action: ActionProposal }): GovernanceDecision;
  grantApproval(input: { approval_request_id: string; approver: string; ttl_ms?: number }): ApprovalGrant;
  redeemApproval(credential: string, input: { session_id: string; task_id: string; token: BoundApprovalToken; action: ActionProposal }): ApprovalRedemption;
  execute(credential: string, input: { session_id: string; permit: ExecutionPermit | undefined; action: ActionProposal; timeout_ms?: number }): Promise<ExecutionResult>;
  proposeMemory(credential: string, input: { session_id: string; task_id: string; candidate: MemoryCandidate }): MemoryDecision;
  /**
   * Verify and consume a persistence permit without storing anything, so an
   * external memory engine can own durable storage while SafeLoop still
   * governs whether the candidate may become active.
   */
  authorizeMemoryPersistence(credential: string, input: { session_id: string; candidate: MemoryCandidate; permit?: MemoryPersistencePermit }): MemoryPersistenceAuthorization;
  persistMemory(credential: string, input: { session_id: string; candidate: MemoryCandidate; decision: MemoryDecision; permit?: MemoryPersistencePermit }): MemoryWriteResult;
  activeMemories(credential: string, sessionId: string): ReturnType<GovernedMemoryStore['active']>;
  /**
   * Record an adapter's verification of a declared runtime control. Reporting
   * only — enforcement remains with the adapter, which fails closed on its own.
   */
  reportControlVerification(credential: string, input: {
    session_id: string; control_id: string; passed: boolean; verified_by?: string; detail?: string;
  }): RuntimeControlStatus;
  controlStatus(sessionId: string): RuntimeControlStatus[];
  finishTask(credential: string, input: { session_id: string; task_id: string }): void;
  finishSession(credential: string, sessionId: string): void;
  health(): RuntimeHealth;
  status(): RuntimeStatus;
  sessions(): SessionState[];
  approvals(): ApprovalAuthority;
  permits(): PermitAuthority;
  memory(): { gateway: MemoryGateway; store: GovernedMemoryStore };
  recorder(): RuntimeRecorder;
  executor(): ManagedExecutor;
}

export interface RuntimeStatus {
  protocol_version: string;
  runtime_version: string;
  started_at: string;
  active_sessions: number;
  sessions: Array<{
    session_id: string;
    agent_id: string;
    agent_name?: string;
    tenant_id: string;
    workspace?: string;
    profile: string;
    scenario_id?: string;
    tasks: string[];
    breaker_state: string;
    breaker_reason: string | null;
    budget_usage: ReturnType<BudgetTracker['usage']>;
    budget_remaining: ReturnType<BudgetTracker['remaining']>;
    pending_approvals: number;
    managed_paths: ManagedPathDeclaration[];
    runtime_controls: RuntimeControlStatus[];
    blocked_reason?: string;
    finished_at?: string;
  }>;
}

/**
 * Compute the honest state of a declared control.
 *
 * A profile declaring `intended_state: DISABLED` is an intention, not a fact.
 * When the declaration requires runtime verification, DISABLED is only claimed
 * once an adapter has confirmed it against the agent's own gate. Anything less
 * reports PENDING_VERIFICATION or VERIFICATION_FAILED, never DISABLED.
 */
export function computeControlStatus(
  declaration: RuntimeControlDeclaration,
  verification: RuntimeControlVerification | undefined,
): RuntimeControlStatus {
  const base = {
    control_id: declaration.control_id,
    name: declaration.name,
    consequential: declaration.consequential,
    enforcement: declaration.enforcement,
    policy: declaration.policy,
    boundary: declaration.boundary,
    rationale: declaration.rationale,
    verification,
  };

  if (declaration.intended_state !== 'DISABLED') {
    return { ...base, state: declaration.intended_state };
  }
  if (!declaration.requires_runtime_verification) {
    return { ...base, state: 'DISABLED' };
  }
  if (!verification || !verification.performed) {
    return { ...base, state: 'PENDING_VERIFICATION' };
  }
  return { ...base, state: verification.passed ? 'DISABLED' : 'VERIFICATION_FAILED' };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(6).toString('hex')}`;
}

/** Wraps the existing circuit breaker as an admission gate for the executor. */
/**
 * Turn the bound context into the fields an operator reads before deciding.
 *
 * Only what is relevant to the action kind: a filesystem approval that
 * advertised a branch, or a git approval that advertised a target file, would
 * be noise in the one place noise is most expensive. Every value here is one
 * the redemption is checked against, so the display cannot drift from what is
 * actually enforced.
 */
interface DescribedContext {
  resolved_target?: string;
  resolved_cwd?: string;
  repository_path?: string;
  head_ref?: string;
}

/**
 * One line naming where a held action would land, for the operator surfaces
 * that show a summary rather than the full request record.
 *
 * The action description alone names the path the agent *wrote*, which is
 * exactly the string a swapped symlink leaves unchanged. Saying where it
 * resolves is the difference between approving a name and approving a place.
 */
function summarizeAuthorizationContext(described: DescribedContext): string {
  const parts: string[] = [];
  if (described.resolved_target) parts.push(`resolves to ${described.resolved_target}`);
  if (described.repository_path) parts.push(`repository ${described.repository_path}`);
  if (described.head_ref) parts.push(`on ${described.head_ref}`);
  else if (described.resolved_cwd) parts.push(`in ${described.resolved_cwd}`);
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

function describeAuthorizationContext(
  actionKind: string,
  context: AuthorizationContext,
): DescribedContext {
  const described: DescribedContext = {};

  if (context.resolved_target) described.resolved_target = context.resolved_target;
  if (context.execution_cwd) described.resolved_cwd = context.execution_cwd;

  if (actionKind === 'git' && context.repository_identity) {
    // The signed identity is the git directory. Show the working tree for the
    // ordinary `<repo>/.git` shape, and the git directory itself for worktrees
    // and other indirections, where nothing shorter would be truthful.
    described.repository_path = context.repository_identity.endsWith(`${sep}.git`)
      ? context.repository_identity.slice(0, -`${sep}.git`.length)
      : context.repository_identity;
    // Absent head_ref means HEAD is not a branch; say so rather than say nothing.
    described.head_ref = context.head_ref || 'detached';
  }

  return described;
}

function breakerGate(breaker: RuntimeCircuitBreaker): BreakerGate {
  return {
    isOpen: () => {
      const state = breaker.status().state;
      return state === 'OPEN' || state === 'LOCKED';
    },
    state: () => breaker.status().state,
    reason: () => breaker.status().reason,
  };
}

export function createSafeloopRuntime(config: SafeloopRuntimeConfig = {}): SafeloopRuntime {
  const storageOptions = config.storageOptions ?? {};
  const secret = config.secret ?? loadRuntimeSecret(storageOptions);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const permits = createPermitAuthority({ storageOptions, secret });
  const approvals = createApprovalAuthority({ storageOptions, secret, permits });
  const recorder = createRuntimeRecorder(storageOptions);
  const memoryGateway = createMemoryGateway({ storageOptions, secret });
  const memoryStore = config.memoryStore ?? createGovernedMemoryStore(memoryGateway, storageOptions);

  const sessions = new Map<string, SessionState>();
  const credentials = new Map<string, string>(); // credential → session_id
  const approvalRequests = new Map<string, { sessionId: string; taskId: string; proposal: ActionProposal }>();
  /**
   * Proposal-time context, keyed by the approval id a grant mints. Redemption
   * receives a token, not a request id, so the binding has to be reachable from
   * the token. In-memory like the pending requests themselves: a runtime that
   * has forgotten the request cannot grant against it either.
   */
  const approvedContexts = new Map<string, AuthorizationContext>();

  function authenticate(credential: string, sessionId: string): SessionState {
    if (!credential) throw new RuntimeError('unauthenticated', 'a session credential is required');
    const boundSession = credentials.get(credential);
    if (!boundSession) throw new RuntimeError('unauthenticated', 'session credential is not recognised');
    if (boundSession !== sessionId) {
      // The credential is real but belongs to a different session: this is an
      // attempt to act inside someone else's session, not a typo.
      throw new RuntimeError('identity_substitution', 'session credential does not belong to the requested session');
    }
    const state = sessions.get(sessionId);
    if (!state) throw new RuntimeError('unknown_session', `unknown session: ${sessionId}`);
    if (state.finished_at) throw new RuntimeError('session_finished', `session ${sessionId} has already finished`);
    return state;
  }

  /**
   * Build the action the runtime will actually govern and execute. Identity
   * comes from the session record, never from the caller's proposal — this is
   * the single place that prevents context substitution.
   */
  function bindIdentity(state: SessionState, taskId: string, proposal: ActionProposal): ActionProposal {
    return {
      ...proposal,
      protocol_version: PROTOCOL_VERSION,
      agent_id: state.session.agent.agent_id,
      parent_agent_id: state.session.agent.parent_agent_id,
      task_id: taskId,
      session_id: state.session.session_id,
      scenario_id: state.session.scenario_id ?? '',
      tenant_id: state.session.tenant_id,
    };
  }

  /**
   * Identity on a memory candidate comes from the session, and the task comes
   * from the permit that governed it. Taking the task from the caller instead
   * would let a candidate governed under task A be activated while claiming
   * task B. Shared by authorization and reference-store persistence so both
   * normalize identically — a mismatch between them would produce fingerprints
   * that differ for no security reason.
   */
  function bindCandidate(
    state: SessionState,
    candidate: MemoryCandidate,
    permit?: MemoryPersistencePermit,
  ): MemoryCandidate {
    return {
      ...candidate,
      agent_id: state.session.agent.agent_id,
      session_id: state.session.session_id,
      tenant_id: state.session.tenant_id,
      task_id: permit?.task_id ?? candidate.task_id,
    };
  }

  function executorFor(state: SessionState): ManagedExecutor {
    return createManagedExecutor({
      permits,
      recorder,
      breaker: breakerGate(state.breaker),
      budget: state.budget,
      workspace: state.session.workspace,
      timeoutMs: config.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
      executors: [
        createShellExecutor(),
        createFilesystemExecutor(),
        createGitExecutor(),
        createHttpExecutor({ fetchImpl: config.fetchImpl }),
        createMcpExecutor({ invoke: config.mcpInvoke }),
      ],
    });
  }

  const runtime: SafeloopRuntime = {
    startSession(input): SessionHandle {
      const profile = loadProfile(input.profile ?? config.defaultProfile ?? 'coding');

      // Delegation: a sub-agent session inherits its parent's ceilings and can
      // never widen them.
      let parentState: SessionState | undefined;
      if (input.parent_session_id) {
        if (!input.parent_credential) {
          throw new RuntimeError('unauthenticated', 'delegated sessions must present the parent session credential');
        }
        parentState = authenticate(input.parent_credential, input.parent_session_id);

        if (input.tenant_id !== parentState.session.tenant_id) {
          throw new RuntimeError('privilege_widening', 'a delegated session cannot change tenant');
        }
        if (input.scenario_id && input.scenario_id !== parentState.session.scenario_id) {
          throw new RuntimeError('privilege_widening', 'a delegated session cannot change scenario');
        }
        if (profile.id !== parentState.profile.id) {
          // Comparing full rule sets is not enough: a different profile could
          // be looser in ways no simple diff catches. Inheritance is exact.
          throw new RuntimeError('privilege_widening', 'a delegated session must inherit its parent profile');
        }
      }

      const sessionId = newId('session');
      const credential = randomBytes(32).toString('hex');

      const session: SessionContext = {
        session_id: sessionId,
        tenant_id: input.tenant_id,
        agent: {
          ...input.agent,
          parent_agent_id: input.agent.parent_agent_id ?? parentState?.session.agent.agent_id,
        },
        workspace: input.workspace ?? parentState?.session.workspace ?? config.workspace,
        profile: profile.id,
        scenario_id: input.scenario_id ?? parentState?.session.scenario_id ?? profile.id,
        started_at: new Date().toISOString(),
        trace_id: input.trace_id ?? parentState?.session.trace_id ?? newId('trace'),
      };

      // A delegated session may only tighten budgets, never raise them.
      const inheritedLimits = parentState
        ? (() => {
            const parentRemaining = parentState.budget.remaining();
            const own = profile.budgets;
            const tighten = (limit: number | undefined, remaining: number | null): number | undefined => {
              if (remaining === null) return limit;
              return typeof limit === 'number' ? Math.min(limit, remaining) : remaining;
            };
            return {
              maximum_actions: tighten(own.maximum_actions, parentRemaining.actions),
              maximum_runtime_ms: tighten(own.maximum_runtime_ms, parentRemaining.runtime),
              maximum_tokens: tighten(own.maximum_tokens, parentRemaining.tokens),
              maximum_cost_usd: tighten(own.maximum_cost_usd, parentRemaining.cost),
              maximum_retries: tighten(own.maximum_retries, parentRemaining.retries),
            };
          })()
        : profile.budgets;

      const state: SessionState = {
        session,
        credential,
        profile,
        budget: createBudgetTracker(inheritedLimits),
        breaker: createRuntimeCircuitBreaker({ storageOptions }),
        tasks: new Map(),
        pendingApprovals: new Map(),
        parent_session_id: input.parent_session_id,
        controlVerifications: new Map(),
      };

      sessions.set(sessionId, state);
      credentials.set(credential, sessionId);

      recorder.recordEvent({
        type: 'agent.started',
        agent_id: session.agent.agent_id,
        session_id: sessionId,
        tenant_id: session.tenant_id,
        summary: `Session started for ${session.agent.agent_name ?? session.agent.agent_id} under profile ${profile.id}`,
        detail: {
          profile: profile.id,
          workspace: session.workspace,
          scenario_id: session.scenario_id,
          parent_session_id: input.parent_session_id,
          runtime_version: RUNTIME_VERSION,
        },
      });

      for (const declaration of profile.runtime_controls ?? []) {
        const status = computeControlStatus(declaration, undefined);
        recorder.recordEvent({
          type: 'runtime.control.declared',
          agent_id: session.agent.agent_id,
          session_id: sessionId,
          tenant_id: session.tenant_id,
          decision: status.state,
          summary: `${declaration.name}: ${status.state}`,
          detail: {
            controlId: declaration.control_id,
            controlName: declaration.name,
            controlState: status.state,
            consequential: declaration.consequential,
            enforcement: declaration.enforcement,
            policy: declaration.policy,
            boundary: declaration.boundary,
            rationale: declaration.rationale,
            profile: profile.id,
          },
        });
      }

      return { session, credential, profile, managed_paths: profile.managed_paths };
    },

    startTask(credential, input): TaskContext {
      const state = authenticate(credential, input.session_id);
      const task: TaskContext = {
        task_id: input.task_id ?? newId('task'),
        session_id: state.session.session_id,
        tenant_id: state.session.tenant_id,
        goal: input.goal,
        started_at: new Date().toISOString(),
        trace_id: state.session.trace_id,
      };
      state.tasks.set(task.task_id, task);

      recorder.recordEvent({
        type: 'task.started',
        agent_id: state.session.agent.agent_id,
        task_id: task.task_id,
        session_id: state.session.session_id,
        tenant_id: state.session.tenant_id,
        summary: `Task started: ${task.goal ?? task.task_id}`,
      });
      return task;
    },

    propose(credential, input): GovernanceDecision {
      const state = authenticate(credential, input.session_id);
      if (!state.tasks.has(input.task_id)) {
        throw new RuntimeError('unknown_task', `unknown task: ${input.task_id}`);
      }

      const bound = bindIdentity(state, input.task_id, input.action);
      const canonical = canonicalizeAction(bound);
      const fingerprint = fingerprintAction(canonical).fingerprint;

      // Deterministic profile rules first.
      const profileEvaluation = evaluateProfile(state.profile, canonical, state.session.workspace);

      // Then the existing risk engine, reused rather than duplicated.
      const riskDecision = evaluateRuntimePolicy({
        taskId: input.task_id,
        sessionId: state.session.session_id,
        agentId: state.session.agent.agent_id,
        agentName: state.session.agent.agent_name,
        agentType: state.session.agent.agent_type,
        model: state.session.agent.model,
        provider: state.session.agent.provider,
        tenantId: state.session.tenant_id,
        tool: canonical.tool || canonical.action_kind,
        action: describeCanonicalAction(canonical),
        target: canonical.target || canonical.resource,
        argumentsHash: fingerprint,
        context: { tenantId: state.session.tenant_id, failClosedForHighRisk: true },
      });

      // The more severe of the two wins. Neither engine can loosen the other.
      const disposition: RuntimeDispositionCode = moreSevere(
        profileEvaluation.disposition,
        riskDecision.disposition as RuntimeDispositionCode,
      );

      state.breaker.evaluate(
        {
          taskId: input.task_id,
          sessionId: state.session.session_id,
          agentId: state.session.agent.agent_id,
          tenantId: state.session.tenant_id,
          tool: canonical.tool || canonical.action_kind,
          action: describeCanonicalAction(canonical),
          target: canonical.target,
          argumentsHash: fingerprint,
        },
        { ...riskDecision, disposition },
      );

      const decision: GovernanceDecision = {
        protocol_version: PROTOCOL_VERSION,
        decision_id: newId('decision'),
        disposition,
        allowed: disposition === 'ALLOW' || disposition === 'ALLOW_WITH_WARNING',
        requires_approval: disposition === 'REQUIRE_APPROVAL',
        action_fingerprint: fingerprint,
        risk_score: riskDecision.event.risk_score ?? 0,
        triggered_policies: [...profileEvaluation.matched_rules, ...riskDecision.triggeredPolicies],
        explanation: [...profileEvaluation.explanations, riskDecision.explanation].filter(Boolean).join(' | '),
        recommended_remediation: riskDecision.recommendedRemediation,
        evaluated_at: new Date().toISOString(),
      };

      // Resolve the host state this decision is about, once, here. For an
      // allowed action this is the same capture as before. For a held action it
      // is the change: the facts are pinned at the moment the operator is
      // asked, not at the moment the agent comes back to collect.
      //
      // Only computed for outcomes that can lead to execution — a denied action
      // has nothing to bind, and probing git for one would add subprocesses to
      // the refusal path.
      // Set only for held actions: the operator-facing view of that context.
      let describedForOperator: DescribedContext | undefined;
      const authorizationContext: AuthorizationContext | undefined =
        decision.allowed || decision.requires_approval
          ? {
            workspace_relation: profileEvaluation.facts.workspace,
            workspace_root: state.session.workspace ? resolveRealPath(state.session.workspace) : undefined,
            ...captureExecutionContext(canonical, state.session.workspace),
          }
          : undefined;

      if (decision.allowed) {
        decision.execution_permit = permits.issue({
          action_fingerprint: fingerprint,
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          scenario_id: canonical.scenario_id,
          tenant_id: canonical.tenant_id,
          disposition,
          // Signed into the permit so the executor can detect the target
          // resolving somewhere else before the side effect runs.
          ...authorizationContext,
        });
      } else if (decision.requires_approval) {
        const context = authorizationContext as AuthorizationContext;
        describedForOperator = describeAuthorizationContext(canonical.action_kind, context);
        const request = approvals.request({
          action_fingerprint: fingerprint,
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          scenario_id: canonical.scenario_id,
          tenant_id: canonical.tenant_id,
          reason: decision.explanation,
          risk_score: decision.risk_score,
          // The operator is shown the place, not just the hash of the request.
          ...describedForOperator,
        });
        decision.approval_request = request;
        state.pendingApprovals.set(request.approval_request_id, { request, proposal: bound, context });
        approvalRequests.set(request.approval_request_id, {
          sessionId: state.session.session_id,
          taskId: input.task_id,
          proposal: bound,
        });
      }

      recorder.recordEvent({
        type: decision.allowed ? 'tool.allowed' : decision.requires_approval ? 'approval.requested' : 'tool.denied',
        agent_id: canonical.agent_id,
        task_id: canonical.task_id,
        session_id: canonical.session_id,
        tenant_id: canonical.tenant_id,
        action_fingerprint: fingerprint,
        decision: disposition,
        summary: `${disposition}: ${describeCanonicalAction(canonical)}${describedForOperator ? summarizeAuthorizationContext(describedForOperator) : ''}`,
        detail: {
          matched_rules: profileEvaluation.matched_rules,
          risk_score: decision.risk_score,
          workspace_relation: profileEvaluation.facts.workspace,
          destructive: profileEvaluation.facts.destructive,
          sensitive_path: profileEvaluation.facts.sensitive_path,
          // The ledger is the operator's other surface onto a held action, so
          // the resolved location belongs in it too, not only on the request.
          ...(describedForOperator ?? {}),
        },
      });

      return decision;
    },

    grantApproval(input): ApprovalGrant {
      const pending = approvalRequests.get(input.approval_request_id);
      if (!pending) {
        throw new RuntimeError('unknown_approval_request', `unknown approval request: ${input.approval_request_id}`);
      }
      const state = sessions.get(pending.sessionId);
      const held = state?.pendingApprovals.get(input.approval_request_id);
      const request = held?.request;
      if (!state || !held || !request) {
        throw new RuntimeError('unknown_approval_request', `approval request is no longer pending: ${input.approval_request_id}`);
      }

      // SL-RC3-HIGH-004: the single-use claim is keyed by approval id, and every
      // grant mints a new one, so N grants against one request used to yield N
      // independently redeemable tokens from a single human decision. The
      // request is the unit of consent; it is spent here.
      if (held.granted_approval_id) {
        throw new RuntimeError(
          'approval_already_granted',
          `approval request ${input.approval_request_id} has already been granted as ${held.granted_approval_id}; propose the action again to request a new decision`,
        );
      }

      const grant = approvals.grant(request, input.approver, input.ttl_ms);
      held.granted_approval_id = grant.approval_id;
      // Carry the proposal-time context onto the identifier the redemption will
      // actually present. The operator decided about this context; the token
      // now has a way back to it.
      approvedContexts.set(grant.approval_id, held.context);
      recorder.recordEvent({
        type: 'approval.granted',
        agent_id: request.agent_id,
        task_id: request.task_id,
        session_id: request.session_id,
        tenant_id: request.tenant_id,
        action_fingerprint: request.action_fingerprint,
        decision: 'REQUIRE_APPROVAL',
        summary: `Approval granted by ${input.approver}`,
        detail: { approval_id: grant.approval_id, approval_request_id: request.approval_request_id },
      });
      return grant;
    },

    redeemApproval(credential, input): ApprovalRedemption {
      const state = authenticate(credential, input.session_id);
      const bound = bindIdentity(state, input.task_id, input.action);
      const canonical = canonicalizeAction(bound);
      const fingerprint = fingerprintAction(canonical).fingerprint;

      // Re-evaluate: a token may only lift a hold that policy still applies.
      const profileEvaluation = evaluateProfile(state.profile, canonical, state.session.workspace);
      const stillRequiresApproval = profileEvaluation.disposition === 'REQUIRE_APPROVAL';

      const redeemInput = {
        action_fingerprint: fingerprint,
        agent_id: canonical.agent_id,
        task_id: canonical.task_id,
        session_id: canonical.session_id,
        scenario_id: canonical.scenario_id,
        tenant_id: canonical.tenant_id,
        approval_was_required: stillRequiresApproval,
      };

      const record = (redemption: ApprovalRedemption): ApprovalRedemption => {
        recorder.recordEvent({
          type: redemption.redeemed ? 'approval.granted' : 'approval.denied',
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          tenant_id: canonical.tenant_id,
          action_fingerprint: fingerprint,
          decision: redemption.redeemed ? 'ALLOW' : 'DENY',
          summary: redemption.redeemed
            ? `Approval redeemed for ${describeCanonicalAction(canonical)}`
            : `Approval redemption rejected: ${redemption.failure}`,
          detail: { approval_id: redemption.approval_id, failure: redemption.failure, reason: redemption.reason },
        });
        return redemption;
      };

      // SL-RC3-CRIT-001. Everything below happens before the token is consumed,
      // so an approval refused here survives for a human to look at again.
      //
      // Token integrity first, without consuming, so a forged or expired token
      // is still diagnosed as forged or expired rather than as a context
      // mismatch — the precise boundary is what the ledger and the conformance
      // suite read.
      const validation = approvals.validate(input.token, redeemInput);
      if (validation.failure) return record(validation);

      // The operator approved a specific place on this host. Find what they
      // were shown.
      const approvalId = input.token.approval_id;
      const approvedContext = approvedContexts.get(approvalId);
      if (!approvedContext) {
        return record({
          protocol_version: PROTOCOL_VERSION,
          redeemed: false,
          approval_id: approvalId,
          failure: 'execution_context_changed_at_redemption',
          reason: 'no proposal-time execution context is on record for this approval, so what the operator approved cannot be confirmed',
        });
      }

      // Resolve the same facts again, now. Any difference means the ground moved
      // between the decision and the collection.
      const currentContext: AuthorizationContext = {
        workspace_relation: profileEvaluation.facts.workspace,
        workspace_root: state.session.workspace ? resolveRealPath(state.session.workspace) : undefined,
        ...captureExecutionContext(canonical, state.session.workspace),
      };

      const comparison = compareAuthorizationContext(approvedContext, currentContext);
      if (!comparison.matches) {
        const redemption: ApprovalRedemption = {
          protocol_version: PROTOCOL_VERSION,
          redeemed: false,
          approval_id: approvalId,
          failure: 'execution_context_changed_at_redemption',
          reason: `the execution context changed after this action was approved: ${comparison.changed.join(', ')}`,
        };
        recorder.recordEvent({
          type: 'approval.denied',
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          tenant_id: canonical.tenant_id,
          action_fingerprint: fingerprint,
          decision: 'DENY',
          summary: `Approval redemption rejected: ${redemption.failure}`,
          detail: {
            approval_id: approvalId,
            failure: redemption.failure,
            reason: redemption.reason,
            changed_fields: comparison.changed,
            ...comparison.detail,
          },
        });
        return redemption;
      }

      // Signed with the values the operator was shown, not with the values just
      // re-resolved. They are equal, and using the approved ones means no gap
      // between this comparison and the signature can matter.
      return record(approvals.redeem(input.token, { ...redeemInput, ...approvedContext }));
    },

    async execute(credential, input): Promise<ExecutionResult> {
      const state = authenticate(credential, input.session_id);
      // The permit carries the task; the action is rebound to it so a caller
      // cannot execute under one permit while claiming another task.
      const taskId = input.permit?.task_id ?? '';
      const bound = bindIdentity(state, taskId, input.action);
      return executorFor(state).execute({
        permit: input.permit,
        action: bound,
        timeout_ms: input.timeout_ms,
      });
    },

    proposeMemory(credential, input): MemoryDecision {
      const state = authenticate(credential, input.session_id);
      const candidate: MemoryCandidate = {
        ...input.candidate,
        agent_id: state.session.agent.agent_id,
        task_id: input.task_id,
        session_id: state.session.session_id,
        tenant_id: state.session.tenant_id,
      };
      return memoryGateway.propose(candidate, {
        scenario: { scenarioId: state.session.scenario_id ?? state.profile.id, memoryWritePolicy: state.profile.memory_write_policy },
        minimumConfidence: state.profile.minimum_memory_confidence,
      });
    },

    /**
     * Bind a candidate to its permit and consume the permit, WITHOUT storing
     * anything.
     *
     * This is the call an adapter makes when its own memory engine — vector,
     * graph, or a host agent's native store — owns durable storage. SafeLoop
     * governs whether a candidate may become active; it does not need to be
     * the database. Without this exposed at the protocol boundary, the only
     * way to complete the lifecycle over the wire was `persistMemory`, which
     * writes into SafeLoop's reference store — making that store mandatory in
     * practice for every non-TypeScript adapter.
     *
     * The permit is consumed here, so an adapter cannot authorize once and
     * then also spend the same permit through `persistMemory`.
     */
    authorizeMemoryPersistence(credential, input): MemoryPersistenceAuthorization {
      const state = authenticate(credential, input.session_id);
      return memoryGateway.authorizePersistence(input.permit, bindCandidate(state, input.candidate, input.permit));
    },

    persistMemory(credential, input): MemoryWriteResult {
      const state = authenticate(credential, input.session_id);
      const permit = input.permit ?? input.decision.persistence_permit;
      return memoryStore.persist(bindCandidate(state, input.candidate, permit), input.decision, permit);
    },

    reportControlVerification(credential, input): RuntimeControlStatus {
      const state = authenticate(credential, input.session_id);
      const declaration = (state.profile.runtime_controls ?? [])
        .find((control) => control.control_id === input.control_id);
      if (!declaration) {
        throw new RuntimeError('invalid_request', `profile ${state.profile.id} declares no control "${input.control_id}"`);
      }

      const verification: RuntimeControlVerification = {
        performed: true,
        passed: input.passed,
        verified_by: input.verified_by,
        verified_at: new Date().toISOString(),
        detail: input.detail,
      };
      state.controlVerifications.set(input.control_id, verification);

      const status = computeControlStatus(declaration, verification);
      if (status.state === 'VERIFICATION_FAILED') {
        // The adapter fails closed on its own; the runtime records why the
        // session could not proceed so an operator sees a blocked session
        // rather than a generic startup error.
        state.blocked_reason =
          `Runtime control verification failed: ${declaration.name} could not be confirmed ${declaration.intended_state.toLowerCase()}.`;
      }

      recorder.recordEvent({
        type: input.passed ? 'runtime.control.verified' : 'runtime.control.failed',
        agent_id: state.session.agent.agent_id,
        session_id: state.session.session_id,
        tenant_id: state.session.tenant_id,
        decision: status.state,
        summary: `${declaration.name}: ${status.state}`,
        detail: {
          controlId: declaration.control_id,
          controlName: declaration.name,
          controlState: status.state,
          consequential: declaration.consequential,
          enforcement: declaration.enforcement,
          // Names and effects only. Values never reach the ledger.
          policy: declaration.policy,
          boundary: declaration.boundary,
          rationale: declaration.rationale,
          verifiedBy: input.verified_by,
          verificationDetail: input.detail,
          profile: state.profile.id,
        },
      });

      return status;
    },

    controlStatus(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) return [];
      return (state.profile.runtime_controls ?? []).map((declaration) =>
        computeControlStatus(declaration, state.controlVerifications.get(declaration.control_id)));
    },

    activeMemories(credential, sessionId) {
      const state = authenticate(credential, sessionId);
      return memoryStore.active(state.session.tenant_id);
    },

    finishTask(credential, input): void {
      const state = authenticate(credential, input.session_id);
      const task = state.tasks.get(input.task_id);
      if (!task) throw new RuntimeError('unknown_task', `unknown task: ${input.task_id}`);
      state.tasks.delete(input.task_id);
      recorder.recordEvent({
        type: 'task.completed',
        agent_id: state.session.agent.agent_id,
        task_id: task.task_id,
        session_id: state.session.session_id,
        tenant_id: state.session.tenant_id,
        summary: `Task completed: ${task.goal ?? task.task_id}`,
      });
    },

    finishSession(credential, sessionId): void {
      const state = authenticate(credential, sessionId);
      state.finished_at = new Date().toISOString();
      credentials.delete(credential);
      recorder.recordEvent({
        type: 'agent.stopped',
        agent_id: state.session.agent.agent_id,
        session_id: sessionId,
        tenant_id: state.session.tenant_id,
        summary: `Session finished for ${state.session.agent.agent_id}`,
        detail: { budget_usage: state.budget.usage(), breaker_state: state.breaker.status().state },
      });
    },

    health(): RuntimeHealth {
      return {
        protocol_version: PROTOCOL_VERSION,
        runtime_version: RUNTIME_VERSION,
        status: 'HEALTHY',
        transport: [],
        started_at: startedAt,
        uptime_ms: Date.now() - startedMs,
        active_sessions: Array.from(sessions.values()).filter((state) => !state.finished_at).length,
        pid: process.pid,
      };
    },

    status(): RuntimeStatus {
      return {
        protocol_version: PROTOCOL_VERSION,
        runtime_version: RUNTIME_VERSION,
        started_at: startedAt,
        active_sessions: Array.from(sessions.values()).filter((state) => !state.finished_at).length,
        sessions: Array.from(sessions.values()).map((state) => ({
          session_id: state.session.session_id,
          agent_id: state.session.agent.agent_id,
          agent_name: state.session.agent.agent_name,
          tenant_id: state.session.tenant_id,
          workspace: state.session.workspace,
          profile: state.profile.id,
          scenario_id: state.session.scenario_id,
          tasks: Array.from(state.tasks.keys()),
          breaker_state: state.breaker.status().state,
          breaker_reason: state.breaker.status().reason,
          budget_usage: state.budget.usage(),
          budget_remaining: state.budget.remaining(),
          pending_approvals: state.pendingApprovals.size,
          managed_paths: state.profile.managed_paths,
          runtime_controls: (state.profile.runtime_controls ?? []).map((declaration) =>
            computeControlStatus(declaration, state.controlVerifications.get(declaration.control_id))),
          blocked_reason: state.blocked_reason,
          finished_at: state.finished_at,
        })),
      };
    },

    sessions: () => Array.from(sessions.values()),
    approvals: () => approvals,
    permits: () => permits,
    memory: () => ({ gateway: memoryGateway, store: memoryStore }),
    recorder: () => recorder,
    executor: () => createManagedExecutor({
      permits,
      recorder,
      executors: [
        createShellExecutor(),
        createFilesystemExecutor(),
        createGitExecutor(),
        createHttpExecutor({ fetchImpl: config.fetchImpl }),
        createMcpExecutor({ invoke: config.mcpInvoke }),
      ],
    }),
  };

  return runtime;
}
