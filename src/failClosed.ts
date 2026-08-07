/**
 * SafeLoop Fail-Closed Policy Engine Wrapper
 *
 * Provides centralized error-handling semantics for runtime governance.
 * If policy evaluation throws, times out, returns malformed data,
 * or becomes unavailable:
 *
 * - HIGH-RISK operations fail closed (DENY / STOP_AGENT)
 * - Low-risk/read-only operations may fail open if explicitly configured
 *
 * This ensures no consequential side effects can occur when the
 * governance engine itself is in a degraded state.
 */

import { appendEvent } from './eventStream';
import {
  evaluateRuntimePolicy,
  type RuntimePolicyDecision,
  type RuntimePolicyEvaluationInput,
  type RuntimeDisposition,
  type RuntimeGovernanceEvent,
} from './runtimeGovernance';
import type { SafeloopStorageOptions } from './localStorage';

// --- Types ---

export type FailMode = 'closed' | 'open';

export interface FailClosedConfig {
  /** Default fail mode for unconfigured actions (default: 'closed') */
  defaultFailMode?: FailMode;
  /** Actions that may fail open (low-risk/read-only patterns) */
  failOpenPatterns?: string[];
  /** Maximum evaluation time before treating as timeout (ms, default: 5000) */
  timeoutMs?: number;
  /** Storage options for ledger recording */
  storageOptions?: SafeloopStorageOptions;
}

export interface FailClosedDecision extends RuntimePolicyDecision {
  /** Whether this decision was produced by the fail-closed fallback */
  failClosedFallback: boolean;
  /** The original error if fail-closed was triggered */
  failureReason?: string;
}

export interface GovernedPolicyEngine {
  /** Evaluate with fail-closed guarantees */
  evaluate(input: RuntimePolicyEvaluationInput): FailClosedDecision;
}

// --- Implementation ---

function now(): string {
  return new Date().toISOString();
}

function makeEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function isLowRiskAction(action: string, tool: string | undefined, patterns: string[]): boolean {
  const text = [action, tool ?? ''].join(' ').toLowerCase();
  return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
}

function createDenyDecision(
  input: RuntimePolicyEvaluationInput,
  failureReason: string,
  disposition: RuntimeDisposition = 'DENY',
): FailClosedDecision {
  const event: RuntimeGovernanceEvent = {
    event_id: makeEventId('failclosed'),
    type: 'policy.failed',
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
    decision: disposition,
    decision_reason: `Fail-closed: ${failureReason}`,
    metadata: { failClosed: true, failureReason },
  };

  return {
    disposition,
    allowed: false,
    requiresApproval: false,
    shouldPause: disposition === 'PAUSE',
    shouldStopAgent: disposition === 'STOP_AGENT' || disposition === 'DENY',
    triggeredPolicies: ['system.fail-closed'],
    riskDimensions: [],
    explanation: `Governance engine failure: ${failureReason}. Action denied under fail-closed policy.`,
    evidenceUsed: [],
    confidence: 0,
    recommendedRemediation: ['Investigate governance engine failure before retrying.'],
    event,
    failClosedFallback: true,
    failureReason,
  };
}

function createAllowFallback(
  input: RuntimePolicyEvaluationInput,
  failureReason: string,
): FailClosedDecision {
  const event: RuntimeGovernanceEvent = {
    event_id: makeEventId('failopen'),
    type: 'policy.passed',
    timestamp: now(),
    task_id: input.taskId,
    session_id: input.sessionId,
    agent_id: input.agentId,
    agent_name: input.agentName,
    agent_type: input.agentType,
    tool: input.tool,
    action: input.action,
    target: input.target,
    decision: 'ALLOW_WITH_WARNING',
    decision_reason: `Fail-open (low-risk): ${failureReason}`,
    metadata: { failOpen: true, failureReason },
  };

  return {
    disposition: 'ALLOW_WITH_WARNING',
    allowed: true,
    requiresApproval: false,
    shouldPause: false,
    shouldStopAgent: false,
    triggeredPolicies: ['system.fail-open'],
    riskDimensions: [],
    explanation: `Governance engine failure: ${failureReason}. Low-risk action allowed with warning under fail-open policy.`,
    evidenceUsed: [],
    confidence: 0,
    recommendedRemediation: ['Investigate governance engine failure.'],
    event,
    failClosedFallback: true,
    failureReason,
  };
}

function isValidDecision(result: unknown): result is RuntimePolicyDecision {
  if (!result || typeof result !== 'object') return false;
  const obj = result as Record<string, unknown>;
  if (typeof obj.disposition !== 'string') return false;
  if (typeof obj.allowed !== 'boolean') return false;
  const validDispositions = ['ALLOW', 'ALLOW_WITH_WARNING', 'REQUIRE_APPROVAL', 'PAUSE', 'DENY', 'STOP_AGENT'];
  if (!validDispositions.includes(obj.disposition as string)) return false;
  if (!obj.event || typeof obj.event !== 'object') return false;
  return true;
}

export function createGovernedPolicyEngine(config: FailClosedConfig = {}): GovernedPolicyEngine {
  const defaultFailMode = config.defaultFailMode ?? 'closed';
  const failOpenPatterns = config.failOpenPatterns ?? ['read', 'list', 'get', 'status', 'check', 'query', 'search'];
  const storageOptions = config.storageOptions ?? {};

  function recordFailure(decision: FailClosedDecision): void {
    appendEvent({
      id: decision.event.event_id,
      type: decision.event.type,
      agentId: decision.event.agent_id,
      agentName: decision.event.agent_name,
      caseId: decision.event.task_id,
      sessionId: decision.event.session_id,
      summary: decision.explanation,
      metadata: {
        failClosed: !decision.allowed,
        failOpen: decision.allowed,
        failureReason: decision.failureReason,
        disposition: decision.disposition,
      },
    }, storageOptions);
  }

  function shouldFailOpen(input: RuntimePolicyEvaluationInput): boolean {
    if (defaultFailMode === 'open') return true;
    return isLowRiskAction(input.action, input.tool, failOpenPatterns);
  }

  return {
    evaluate(input: RuntimePolicyEvaluationInput): FailClosedDecision {
      let result: unknown;

      try {
        result = evaluateRuntimePolicy(input);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const failureReason = `Policy evaluation threw: ${message}`;

        if (shouldFailOpen(input)) {
          const decision = createAllowFallback(input, failureReason);
          recordFailure(decision);
          return decision;
        }

        const decision = createDenyDecision(input, failureReason, 'DENY');
        recordFailure(decision);
        return decision;
      }

      // Validate the decision structure
      if (!isValidDecision(result)) {
        const failureReason = 'Policy engine returned malformed decision.';

        if (shouldFailOpen(input)) {
          const decision = createAllowFallback(input, failureReason);
          recordFailure(decision);
          return decision;
        }

        const decision = createDenyDecision(input, failureReason, 'DENY');
        recordFailure(decision);
        return decision;
      }

      return { ...result, failClosedFallback: false };
    },
  };
}
