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
import { createMemoryGateway, type MemoryGateway } from './memoryGateway';
import { createGovernedMemoryStore, type GovernedMemoryStore, type MemoryWriteResult } from './memoryStore';
import { evaluateProfile, loadProfile, moreSevere, type GovernanceProfile } from './profiles';
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
  pendingApprovals: Map<string, { request: ReturnType<ApprovalAuthority['request']>; proposal: ActionProposal }>;
  parent_session_id?: string;
  finished_at?: string;
}

export type RuntimeErrorCode =
  | 'unauthenticated'
  | 'unknown_session'
  | 'unknown_task'
  | 'session_finished'
  | 'identity_substitution'
  | 'privilege_widening'
  | 'unknown_approval_request'
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
}

export interface SafeloopRuntime {
  startSession(input: StartSessionInput): SessionHandle;
  startTask(credential: string, input: { session_id: string; task_id?: string; goal?: string }): TaskContext;
  propose(credential: string, input: { session_id: string; task_id: string; action: ActionProposal }): GovernanceDecision;
  grantApproval(input: { approval_request_id: string; approver: string; ttl_ms?: number }): ApprovalGrant;
  redeemApproval(credential: string, input: { session_id: string; task_id: string; token: BoundApprovalToken; action: ActionProposal }): ApprovalRedemption;
  execute(credential: string, input: { session_id: string; permit: ExecutionPermit | undefined; action: ActionProposal; timeout_ms?: number }): Promise<ExecutionResult>;
  proposeMemory(credential: string, input: { session_id: string; task_id: string; candidate: MemoryCandidate }): MemoryDecision;
  persistMemory(credential: string, input: { session_id: string; candidate: MemoryCandidate; decision: MemoryDecision; permit?: MemoryPersistencePermit }): MemoryWriteResult;
  activeMemories(credential: string, sessionId: string): ReturnType<GovernedMemoryStore['active']>;
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
    finished_at?: string;
  }>;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(6).toString('hex')}`;
}

/** Wraps the existing circuit breaker as an admission gate for the executor. */
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
  const memoryStore = createGovernedMemoryStore(memoryGateway, storageOptions);

  const sessions = new Map<string, SessionState>();
  const credentials = new Map<string, string>(); // credential → session_id
  const approvalRequests = new Map<string, { sessionId: string; taskId: string; proposal: ActionProposal }>();

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

      if (decision.allowed) {
        decision.execution_permit = permits.issue({
          action_fingerprint: fingerprint,
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          scenario_id: canonical.scenario_id,
          tenant_id: canonical.tenant_id,
          disposition,
        });
      } else if (decision.requires_approval) {
        const request = approvals.request({
          action_fingerprint: fingerprint,
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          scenario_id: canonical.scenario_id,
          tenant_id: canonical.tenant_id,
          reason: decision.explanation,
          risk_score: decision.risk_score,
        });
        decision.approval_request = request;
        state.pendingApprovals.set(request.approval_request_id, { request, proposal: bound });
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
        summary: `${disposition}: ${describeCanonicalAction(canonical)}`,
        detail: {
          matched_rules: profileEvaluation.matched_rules,
          risk_score: decision.risk_score,
          workspace_relation: profileEvaluation.facts.workspace,
          destructive: profileEvaluation.facts.destructive,
          sensitive_path: profileEvaluation.facts.sensitive_path,
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
      const request = state?.pendingApprovals.get(input.approval_request_id)?.request;
      if (!state || !request) {
        throw new RuntimeError('unknown_approval_request', `approval request is no longer pending: ${input.approval_request_id}`);
      }

      const grant = approvals.grant(request, input.approver, input.ttl_ms);
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

      const redemption = approvals.redeem(input.token, {
        action_fingerprint: fingerprint,
        agent_id: canonical.agent_id,
        task_id: canonical.task_id,
        session_id: canonical.session_id,
        scenario_id: canonical.scenario_id,
        tenant_id: canonical.tenant_id,
        approval_was_required: stillRequiresApproval,
      });

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

    persistMemory(credential, input): MemoryWriteResult {
      const state = authenticate(credential, input.session_id);
      const permit = input.permit ?? input.decision.persistence_permit;
      const candidate: MemoryCandidate = {
        ...input.candidate,
        agent_id: state.session.agent.agent_id,
        session_id: state.session.session_id,
        tenant_id: state.session.tenant_id,
        // The permit records which task was actually governed, so it is the
        // authority here. Taking the task from the caller instead would let a
        // candidate governed under task A be activated while claiming task B.
        task_id: permit?.task_id ?? input.candidate.task_id,
      };
      return memoryStore.persist(candidate, input.decision, permit);
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
