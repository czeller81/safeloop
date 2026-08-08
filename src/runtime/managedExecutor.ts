/**
 * SafeLoop managed executor.
 *
 * This is the choke point the whole architecture exists to create. Everything
 * consequential that SafeLoop claims to govern passes through `execute()`, and
 * `execute()` will not dispatch to an executor plugin until it has, in order:
 *
 *   1. validated the request against the protocol schema
 *   2. re-canonicalized the submitted action and recomputed its fingerprint
 *      (never trusting a fingerprint supplied by the caller)
 *   3. verified the permit's signature, expiry, identity tuple, and fingerprint
 *   4. atomically consumed the permit, so it cannot be spent twice
 *   5. confirmed the circuit breaker is not open
 *   6. confirmed the hard budget is not exhausted
 *
 * Step 2 is what defeats argument substitution: an agent that proposes action A,
 * receives a permit, and then submits action B gets `fingerprint_mismatch`,
 * because the fingerprint is recomputed here from the bytes actually submitted.
 */

import { randomUUID } from 'crypto';
import { canonicalizeAction, fingerprintAction } from './canonicalAction';
import { redactSecrets } from './redaction';
import { assertProtocol } from './schemaValidator';
import { ExecutorArgumentError, type ExecutorOutcome, type ManagedExecutorPlugin } from './executors/types';
import type { PermitAuthority } from './executionPermit';
import type { BudgetTracker } from './budgets';
import {
  PROTOCOL_VERSION,
  type ActionKind,
  type ActionProposal,
  type ExecutionPermit,
  type ExecutionRejectionReason,
  type ExecutionResult,
} from './protocol';

export interface BreakerGate {
  /** True when consequential managed execution must stop. */
  isOpen(): boolean;
  state(): string;
  reason(): string | null;
}

export interface ExecutionRecorder {
  recordEvidence(input: {
    kind: string;
    description: string;
    content_hash?: string;
    agent_id: string;
    task_id: string;
    tenant_id: string;
  }): string;
  recordArtifact(input: {
    path: string;
    content_hash: string;
    operation: string;
    agent_id: string;
    task_id: string;
    tenant_id: string;
  }): string;
  recordEvent(input: {
    type: string;
    agent_id: string;
    task_id?: string;
    session_id?: string;
    tenant_id?: string;
    action_fingerprint?: string;
    decision?: string;
    summary: string;
    detail?: Record<string, unknown>;
  }): void;
}

export interface ManagedExecutorConfig {
  permits: PermitAuthority;
  executors: ManagedExecutorPlugin[];
  recorder: ExecutionRecorder;
  breaker?: BreakerGate;
  budget?: BudgetTracker;
  workspace?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ManagedExecuteInput {
  permit: ExecutionPermit | undefined;
  action: ActionProposal;
  timeout_ms?: number;
}

export interface ManagedExecutor {
  execute(input: ManagedExecuteInput): Promise<ExecutionResult>;
  supports(kind: ActionKind): boolean;
  kinds(): ActionKind[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

function rejection(
  reason: ExecutionRejectionReason,
  detail: string,
  permitId: string,
  fingerprint: string,
): ExecutionResult {
  return {
    protocol_version: PROTOCOL_VERSION,
    execution_id: `execution-${Date.now()}-${randomUUID().slice(0, 8)}`,
    permit_id: permitId,
    action_fingerprint: fingerprint,
    status: 'REJECTED',
    rejection_reason: reason,
    evidence_ids: [],
    artifact_ids: [],
    detail: { rejection_detail: detail },
  };
}

export function createManagedExecutor(config: ManagedExecutorConfig): ManagedExecutor {
  const plugins = new Map<ActionKind, ManagedExecutorPlugin>();
  for (const plugin of config.executors) plugins.set(plugin.kind, plugin);

  const defaultTimeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return {
    supports(kind) {
      return plugins.has(kind);
    },
    kinds() {
      return Array.from(plugins.keys()).sort();
    },

    async execute(input: ManagedExecuteInput): Promise<ExecutionResult> {
      // 1. Protocol validation on the trust boundary.
      try {
        assertProtocol('action-proposal', input.action);
      } catch (error) {
        return rejection('invalid_runtime_state', String((error as Error).message), input.permit?.permit_id ?? '', '');
      }

      // 2. Recompute the fingerprint from the submitted bytes. A caller-supplied
      //    fingerprint is never trusted — that is the substitution attack.
      const canonical = canonicalizeAction(input.action);
      const fingerprint = fingerprintAction(canonical).fingerprint;
      const permitId = input.permit?.permit_id ?? '';

      const expected = {
        action_fingerprint: fingerprint,
        agent_id: canonical.agent_id,
        task_id: canonical.task_id,
        session_id: canonical.session_id,
        scenario_id: canonical.scenario_id,
        tenant_id: canonical.tenant_id,
      };

      // 3 + 4. Verify and atomically consume in one step.
      const permitCheck = config.permits.redeem(input.permit, expected);
      if (!permitCheck.valid) {
        config.recorder.recordEvent({
          type: 'tool.denied',
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          tenant_id: canonical.tenant_id,
          action_fingerprint: fingerprint,
          decision: 'DENY',
          summary: `Managed execution rejected: ${permitCheck.reason}`,
          detail: { rejection_reason: permitCheck.reason, detail: permitCheck.detail },
        });
        return rejection(permitCheck.reason ?? 'missing_permit', permitCheck.detail ?? 'permit rejected', permitId, fingerprint);
      }

      // 5. Circuit breaker admission.
      if (config.breaker?.isOpen()) {
        const reason = config.breaker.reason() ?? 'circuit breaker is open';
        config.recorder.recordEvent({
          type: 'tool.denied',
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          tenant_id: canonical.tenant_id,
          action_fingerprint: fingerprint,
          decision: 'PAUSE',
          summary: `Managed execution blocked by circuit breaker: ${reason}`,
          detail: { breaker_state: config.breaker.state(), reason },
        });
        return {
          ...rejection('breaker_open', reason, permitId, fingerprint),
          status: 'BLOCKED_BY_BREAKER',
        };
      }

      // 6. Hard budget admission.
      const budgetVerdict = config.budget?.check();
      if (budgetVerdict && !budgetVerdict.permitted) {
        config.recorder.recordEvent({
          type: 'tool.denied',
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          tenant_id: canonical.tenant_id,
          action_fingerprint: fingerprint,
          decision: 'PAUSE',
          summary: `Managed execution blocked by budget: ${budgetVerdict.reason}`,
          detail: { exhausted: budgetVerdict.exhausted, usage: budgetVerdict.usage },
        });
        return {
          ...rejection('budget_exhausted', budgetVerdict.reason ?? 'budget exhausted', permitId, fingerprint),
          status: 'BLOCKED_BY_BUDGET',
        };
      }

      const plugin = plugins.get(canonical.action_kind);
      if (!plugin) {
        return rejection(
          'unsupported_action_kind',
          `no managed executor is registered for action kind: ${canonical.action_kind}`,
          permitId,
          fingerprint,
        );
      }

      // The permit is spent; from here the side effect is authorized to happen
      // exactly once, and every outcome becomes evidence.
      config.budget?.recordAction();
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();

      let outcome: ExecutorOutcome;
      try {
        outcome = await plugin.execute({
          action: canonical,
          workspace: config.workspace,
          timeoutMs: input.timeout_ms ?? defaultTimeout,
          maxOutputBytes,
          redact: redactSecrets,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const reason: ExecutionRejectionReason = error instanceof ExecutorArgumentError ? 'executor_error' : 'executor_error';
        config.recorder.recordEvent({
          type: 'tool.failed',
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          session_id: canonical.session_id,
          tenant_id: canonical.tenant_id,
          action_fingerprint: fingerprint,
          decision: 'DENY',
          summary: `Managed execution failed: ${message}`,
          detail: { error: redactSecrets(message) },
        });
        return {
          protocol_version: PROTOCOL_VERSION,
          execution_id: `execution-${Date.now()}-${randomUUID().slice(0, 8)}`,
          permit_id: permitId,
          action_fingerprint: fingerprint,
          status: 'FAILED',
          rejection_reason: reason,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedMs,
          evidence_ids: [],
          artifact_ids: [],
          detail: { error: redactSecrets(message) },
        };
      }

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startedMs;

      const artifactIds = (outcome.artifacts ?? []).map((artifact) =>
        config.recorder.recordArtifact({
          path: artifact.path,
          content_hash: artifact.content_hash,
          operation: artifact.operation,
          agent_id: canonical.agent_id,
          task_id: canonical.task_id,
          tenant_id: canonical.tenant_id,
        }));

      const evidenceId = config.recorder.recordEvidence({
        kind: `execution.${canonical.action_kind}`,
        description: `${canonical.action_kind} ${canonical.operation} → ${outcome.status}`,
        content_hash: fingerprint,
        agent_id: canonical.agent_id,
        task_id: canonical.task_id,
        tenant_id: canonical.tenant_id,
      });

      config.recorder.recordEvent({
        type: outcome.status === 'EXECUTED' ? 'tool.executed' : 'tool.failed',
        agent_id: canonical.agent_id,
        task_id: canonical.task_id,
        session_id: canonical.session_id,
        tenant_id: canonical.tenant_id,
        action_fingerprint: fingerprint,
        decision: input.permit?.disposition,
        summary: `Managed ${canonical.action_kind} ${canonical.operation}: ${outcome.status}`,
        detail: {
          ...outcome.detail,
          exit_code: outcome.exit_code,
          permit_id: permitId,
          approval_id: input.permit?.approval_id,
          duration_ms: durationMs,
        },
      });

      return {
        protocol_version: PROTOCOL_VERSION,
        execution_id: `execution-${Date.now()}-${randomUUID().slice(0, 8)}`,
        permit_id: permitId,
        action_fingerprint: fingerprint,
        status: outcome.status,
        exit_code: outcome.exit_code,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        evidence_ids: [evidenceId],
        artifact_ids: artifactIds,
        detail: outcome.detail,
      };
    },
  };
}
