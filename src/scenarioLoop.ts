/**
 * SafeLoop Scenario Loop
 *
 * Governs dimension-coded scenario-based agent loops:
 *   Scenario Contract → Step → Loop Decision → Guarded Action → Audit → Continue/Stop
 *
 * The loop continues only while the scenario remains safe, in scope, within
 * budget, and verifiable. Each step produces an auditable event.
 *
 * Enforcement boundary: SafeLoop can only govern steps that pass through this
 * loop controller. Direct agent actions outside the controller cannot be stopped.
 * Async approval resume is not implemented in this proof slice.
 */

import { createCommandGuard, type CommandGuard, type GuardResult } from './commandGuard';
import { appendEvent } from './eventStream';
import {
  createRuntimeCircuitBreaker,
  evaluateRuntimePolicy,
  recordRuntimeGovernanceEvent,
  type RuntimePolicyEvaluationInput,
} from './runtimeGovernance';
import type { PolicyGateConfig } from './index';
import type { SafeloopStorageOptions } from './localStorage';

// --- Types ---

export interface ScenarioContract {
  scenarioId: string;
  goal: string;
  successCondition: string;
  maxAttempts?: number;
  maxCost?: number;
  maxTokens?: number;
  maxRuntimeMs?: number;
  allowedCommands?: string[];
  blockedCommands?: string[];
  requireApprovalFor?: string[];
  allowedTargets?: string[];
  blockedTargets?: string[];
  requiredEvidenceFor?: string[];
  memoryWritePolicy?: 'allow' | 'allow_with_ttl' | 'require_review' | 'quarantine' | 'reject';
}

export interface ScenarioLoopStep {
  stepIndex: number;
  actionType: 'command' | 'external_api_call' | 'file_write' | 'validation' | 'unknown';
  target?: string;
  command?: string;
  description?: string;
  expectedOutcome?: string;
  evidenceIds?: string[];
  artifactIds?: string[];
  cost?: number;
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  /** If true, this step declares the success condition is met */
  successSignal?: boolean;
}

export type ScenarioLoopDecision =
  | 'continue'
  | 'warn'
  | 'block'
  | 'escalate'
  | 'success'
  | 'stop';

export interface ScenarioLoopResult {
  scenarioId: string;
  decision: ScenarioLoopDecision;
  shouldContinue: boolean;
  reason: string;
  stepIndex: number;
  outcome?: 'allowed' | 'blocked' | 'escalated' | 'success' | 'stopped';
  commandOutput?: string;
  exitCode?: number;
  eventId: string;
}

export interface ScenarioLoopConfig {
  contract: ScenarioContract;
  sessionId?: string;
  caseId?: string;
  agentId?: string;
  agentName?: string;
  storageOptions?: SafeloopStorageOptions;
  /** Oversight mode for the policy gate (default: HOTL) */
  oversightMode?: 'HITL' | 'HOTL' | 'HOOTL';
  /** Command execution timeout in ms (default: 10000) */
  timeoutMs?: number;
}

export interface ScenarioLoop {
  /** Evaluate and optionally execute a single step */
  step(input: ScenarioLoopStep): ScenarioLoopResult;
  /** Current step count */
  stepCount(): number;
  /** Whether the loop has been stopped (success, block, max attempts, etc.) */
  isStopped(): boolean;
  /** The scenario contract */
  contract(): ScenarioContract;
}

// --- Implementation ---

function generateEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function createScenarioLoop(config: ScenarioLoopConfig): ScenarioLoop {
  const { contract } = config;
  const storageOptions = config.storageOptions ?? {};
  const sessionId = config.sessionId;
  const caseId = config.caseId ?? contract.scenarioId;
  const agentId = config.agentId ?? 'scenario-loop';
  const agentName = config.agentName ?? 'ScenarioLoop';
  const oversightMode = config.oversightMode ?? 'HOTL';
  const maxAttempts = contract.maxAttempts ?? 10;

  let currentStep = 0;
  let stopped = false;
  const startedAt = Date.now();
  let cumulativeCost = 0;
  let cumulativeTokens = 0;

  // Build policy config from contract
  const policyConfig: PolicyGateConfig = {
    oversightMode,
    allowedCommands: contract.allowedCommands,
    blockedCommands: contract.blockedCommands,
    requireApprovalFor: contract.requireApprovalFor,
  };

  // Create command guard for command-type steps
  const guard: CommandGuard = createCommandGuard({
    policy: policyConfig,
    sessionId,
    caseId,
    agentId,
    agentName,
    storageOptions,
    timeoutMs: config.timeoutMs,
  });
  const circuitBreaker = createRuntimeCircuitBreaker({
    maxRepeatedToolCalls: 3,
    maxDeniedActions: 2,
    maximumCostUsd: contract.maxCost,
    maximumTokens: contract.maxTokens,
    storageOptions,
  });

  function emitStepEvent(step: ScenarioLoopStep, decision: ScenarioLoopDecision, outcome: string, reason: string): string {
    const eventId = generateEventId('scenario-step');
    appendEvent({
      id: eventId,
      type: 'scenario.step',
      agentId,
      agentName,
      caseId,
      sessionId,
      summary: `Step ${step.stepIndex}: ${decision} — ${reason}`,
      metadata: {
        scenarioId: contract.scenarioId,
        goal: contract.goal,
        stepIndex: step.stepIndex,
        actionType: step.actionType,
        target: step.target,
        command: step.command,
        description: step.description,
        decision,
        outcome,
        reason,
        shouldContinue: decision === 'continue' || decision === 'warn',
      },
    }, storageOptions);
    return eventId;
  }

  return {
    step(input: ScenarioLoopStep): ScenarioLoopResult {
      currentStep = input.stepIndex;
      cumulativeCost += input.cost ?? 0;
      const stepTokens = input.tokenUsage?.totalTokens ?? ((input.tokenUsage?.inputTokens ?? 0) + (input.tokenUsage?.outputTokens ?? 0));
      cumulativeTokens += stepTokens;

      // If already stopped, refuse further steps
      if (stopped) {
        const eventId = emitStepEvent(input, 'stop', 'stopped', 'Scenario loop already stopped');
        return {
          scenarioId: contract.scenarioId,
          decision: 'stop',
          shouldContinue: false,
          reason: 'Scenario loop already stopped',
          stepIndex: input.stepIndex,
          outcome: 'stopped',
          eventId,
        };
      }

      // Check max attempts
      if (input.stepIndex >= maxAttempts) {
        stopped = true;
        const eventId = emitStepEvent(input, 'stop', 'stopped', `Max attempts reached (${maxAttempts})`);
        return {
          scenarioId: contract.scenarioId,
          decision: 'stop',
          shouldContinue: false,
          reason: `Max attempts reached (${maxAttempts})`,
          stepIndex: input.stepIndex,
          outcome: 'stopped',
          eventId,
        };
      }

      if (typeof contract.maxRuntimeMs === 'number' && Date.now() - startedAt > contract.maxRuntimeMs) {
        stopped = true;
        const eventId = emitStepEvent(input, 'stop', 'stopped', `Runtime budget exceeded (${contract.maxRuntimeMs}ms)`);
        return {
          scenarioId: contract.scenarioId,
          decision: 'stop',
          shouldContinue: false,
          reason: `Runtime budget exceeded (${contract.maxRuntimeMs}ms)`,
          stepIndex: input.stepIndex,
          outcome: 'stopped',
          eventId,
        };
      }

      // Check success signal
      if (input.successSignal) {
        stopped = true;
        const eventId = emitStepEvent(input, 'success', 'success', `Success condition met: ${contract.successCondition}`);
        return {
          scenarioId: contract.scenarioId,
          decision: 'success',
          shouldContinue: false,
          reason: `Success condition met: ${contract.successCondition}`,
          stepIndex: input.stepIndex,
          outcome: 'success',
          eventId,
        };
      }

      // Check blocked targets
      if (input.target && contract.blockedTargets?.length) {
        const targetLower = input.target.toLowerCase();
        const blocked = contract.blockedTargets.some(t => targetLower.includes(t.toLowerCase()));
        if (blocked) {
          stopped = true;
          const eventId = emitStepEvent(input, 'block', 'blocked', `Target blocked by contract: ${input.target}`);
          return {
            scenarioId: contract.scenarioId,
            decision: 'block',
            shouldContinue: false,
            reason: `Target blocked by contract: ${input.target}`,
            stepIndex: input.stepIndex,
            outcome: 'blocked',
            eventId,
          };
        }
      }

      if (input.target && contract.allowedTargets?.length) {
        const targetLower = input.target.toLowerCase();
        const allowed = contract.allowedTargets.some(t => targetLower.includes(t.toLowerCase()));
        if (!allowed) {
          stopped = true;
          const eventId = emitStepEvent(input, 'block', 'blocked', `Target outside scenario boundary: ${input.target}`);
          return {
            scenarioId: contract.scenarioId,
            decision: 'block',
            shouldContinue: false,
            reason: `Target outside scenario boundary: ${input.target}`,
            stepIndex: input.stepIndex,
            outcome: 'blocked',
            eventId,
          };
        }
      }

      const runtimeInput: RuntimePolicyEvaluationInput = {
        taskId: caseId,
        sessionId,
        agentId,
        agentName,
        tool: input.actionType,
        action: input.command ?? input.description ?? input.actionType,
        target: input.target,
        evidenceIds: input.evidenceIds,
        artifactIds: input.artifactIds,
        cost: input.cost,
        tokenUsage: input.tokenUsage,
        context: {
          cumulativeCost,
          cumulativeTokens,
          loopCount: input.stepIndex,
          scenario: {
            scenarioId: contract.scenarioId,
            goal: contract.goal,
            allowedActions: contract.allowedCommands,
            forbiddenActions: contract.blockedCommands,
            allowedTools: contract.allowedCommands ? ['command'] : undefined,
            allowedSystems: contract.allowedTargets,
            maximumCostUsd: contract.maxCost,
            maximumTokens: contract.maxTokens,
            maximumRuntimeMs: contract.maxRuntimeMs,
            maxLoops: contract.maxAttempts,
            requireApprovalFor: contract.requireApprovalFor,
            requiredEvidenceFor: contract.requiredEvidenceFor,
            memoryWritePolicy: contract.memoryWritePolicy,
          },
        },
      };
      const runtimeDecision = evaluateRuntimePolicy(runtimeInput);
      recordRuntimeGovernanceEvent(runtimeDecision.event, storageOptions);
      const breakerStatus = circuitBreaker.evaluate(runtimeInput, runtimeDecision);
      if (!runtimeDecision.allowed) {
        stopped = true;
        const decisionType = runtimeDecision.requiresApproval || runtimeDecision.shouldPause ? 'escalate' : 'block';
        const eventId = emitStepEvent(input, decisionType, decisionType === 'block' ? 'blocked' : 'escalated', runtimeDecision.explanation);
        return {
          scenarioId: contract.scenarioId,
          decision: decisionType,
          shouldContinue: false,
          reason: runtimeDecision.explanation,
          stepIndex: input.stepIndex,
          outcome: decisionType === 'block' ? 'blocked' : 'escalated',
          eventId,
        };
      }
      if (breakerStatus.state === 'OPEN' || breakerStatus.state === 'LOCKED') {
        stopped = true;
        const eventId = emitStepEvent(input, 'stop', 'stopped', breakerStatus.reason ?? `Circuit breaker ${breakerStatus.state}`);
        return {
          scenarioId: contract.scenarioId,
          decision: 'stop',
          shouldContinue: false,
          reason: breakerStatus.reason ?? `Circuit breaker ${breakerStatus.state}`,
          stepIndex: input.stepIndex,
          outcome: 'stopped',
          eventId,
        };
      }

      // Handle command-type steps using the guard
      if (input.actionType === 'command' && input.command) {
        const guardResult: GuardResult = guard.run(input.command);

        if (guardResult.decision === 'allow') {
          const eventId = emitStepEvent(input, 'continue', 'allowed', `Command allowed: ${input.command}`);
          return {
            scenarioId: contract.scenarioId,
            decision: 'continue',
            shouldContinue: true,
            reason: `Command allowed: ${input.command}`,
            stepIndex: input.stepIndex,
            outcome: 'allowed',
            commandOutput: guardResult.output,
            exitCode: guardResult.exitCode,
            eventId,
          };
        }

        if (guardResult.decision === 'deny') {
          stopped = true;
          const reason = `Command blocked: ${guardResult.violations?.join('; ') ?? input.command}`;
          const eventId = emitStepEvent(input, 'block', 'blocked', reason);
          return {
            scenarioId: contract.scenarioId,
            decision: 'block',
            shouldContinue: false,
            reason,
            stepIndex: input.stepIndex,
            outcome: 'blocked',
            eventId,
          };
        }

        if (guardResult.decision === 'requires_approval') {
          stopped = true;
          const reason = `Approval required: ${guardResult.reasons?.join('; ') ?? input.command}`;
          const eventId = emitStepEvent(input, 'escalate', 'escalated', reason);
          return {
            scenarioId: contract.scenarioId,
            decision: 'escalate',
            shouldContinue: false,
            reason,
            stepIndex: input.stepIndex,
            outcome: 'escalated',
            eventId,
          };
        }
      }

      // Non-command steps (validation, file_write, external_api_call, unknown)
      // For non-command steps, allow by default and continue
      const eventId = emitStepEvent(input, 'continue', 'allowed', `Step allowed: ${input.description ?? input.actionType}`);
      return {
        scenarioId: contract.scenarioId,
        decision: 'continue',
        shouldContinue: true,
        reason: `Step allowed: ${input.description ?? input.actionType}`,
        stepIndex: input.stepIndex,
        outcome: 'allowed',
        eventId,
      };
    },

    stepCount(): number {
      return currentStep + 1;
    },

    isStopped(): boolean {
      return stopped;
    },

    contract(): ScenarioContract {
      return { ...contract };
    },
  };
}
