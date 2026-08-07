import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createRuntimeCircuitBreaker,
  evaluateRuntimePolicy,
  normalizeRuntimeEvent,
  verifyCandidateMemory,
  type RuntimePolicyEvaluationInput,
} from '../src';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-runtime-governance-'));
}

function cleanup(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function action(overrides: Partial<RuntimePolicyEvaluationInput> = {}): RuntimePolicyEvaluationInput {
  return {
    agentId: 'agent-1',
    action: 'read local status',
    tool: 'terminal',
    target: 'local-workspace',
    ...overrides,
  };
}

describe('runtime governance', () => {
  it('allows low-risk local actions with no triggered policies', () => {
    const decision = evaluateRuntimePolicy(action());

    expect(decision.disposition).toBe('ALLOW');
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.riskDimensions).toHaveLength(0);
    expect(decision.event.type).toBe('policy.passed');
  });

  it('requires approval for high-risk production publishing actions', () => {
    const decision = evaluateRuntimePolicy(action({
      action: 'publish release to production',
      tool: 'deploy',
      target: 'production',
    }));

    expect(decision.disposition).toBe('REQUIRE_APPROVAL');
    expect(decision.requiresApproval).toBe(true);
    expect(decision.riskDimensions.map((risk) => risk.id)).toContain('PRODUCTION_CHANGE');
    expect(decision.triggeredPolicies).toContain('runtime.production-change');
  });

  it('denies scenario-forbidden actions before execution', () => {
    const decision = evaluateRuntimePolicy(action({
      action: 'delete student records',
      target: 'student pii archive',
      context: {
        scenario: {
          scenarioId: 'k12-rag',
          forbiddenActions: ['delete student records'],
        },
      },
    }));

    expect(decision.disposition).toBe('DENY');
    expect(decision.allowed).toBe(false);
    expect(decision.shouldStopAgent).toBe(true);
    expect(decision.triggeredPolicies).toContain('scenario.forbidden-action');
  });

  it('evaluates execution-path budgets, not only isolated actions', () => {
    const decision = evaluateRuntimePolicy(action({
      action: 'query model',
      cost: 0.6,
      tokenUsage: { totalTokens: 700 },
      context: {
        cumulativeCost: 0.7,
        cumulativeTokens: 600,
        scenario: {
          scenarioId: 'budgeted-loop',
          maximumCostUsd: 1,
          maximumTokens: 1000,
        },
      },
    }));

    expect(decision.disposition).toBe('REQUIRE_APPROVAL');
    expect(decision.riskDimensions.map((risk) => risk.id)).toContain('COST_ANOMALY');
    expect(decision.explanation).toContain('Estimated cost exceeds scenario budget');
  });

  it('opens the circuit breaker for repeated identical tool calls', () => {
    const breaker = createRuntimeCircuitBreaker({ maxRepeatedToolCalls: 2 });
    const input = action({ action: 'call search', tool: 'search', target: 'local-index', argumentsHash: 'same' });
    const decision = evaluateRuntimePolicy(input);

    expect(breaker.evaluate(input, decision).state).toBe('CLOSED');
    const status = breaker.evaluate(input, decision);

    expect(status.state).toBe('WARNING');
    expect(status.reason).toContain('Repeated tool-call threshold');
  });

  it('locks the circuit breaker on critical fail-closed risk', () => {
    const tempDir = makeTempDir();
    try {
      const breaker = createRuntimeCircuitBreaker({ storageOptions: { baseDir: tempDir } });
      const input = action({
        action: 'delete records',
        context: {
          scenario: {
            scenarioId: 'locked',
            forbiddenActions: ['delete records'],
          },
        },
      });
      const status = breaker.evaluate(input, evaluateRuntimePolicy(input));

      expect(status.state).toBe('LOCKED');
      const ledger = readFileSync(join(tempDir, '.safeloop', 'events.jsonl'), 'utf8');
      expect(ledger).toContain('circuit_breaker.triggered');
    } finally {
      cleanup(tempDir);
    }
  });

  it('normalizes existing ledger events into runtime governance events', () => {
    const event = normalizeRuntimeEvent({
      id: 'evt-1',
      type: 'decision.made',
      timestamp: '2026-06-19T00:00:00.000Z',
      agentId: 'opencode',
      agentName: 'OpenCode',
      sessionId: 'sess-1',
      summary: 'Allowed local read',
      metadata: {
        taskId: 'task-1',
        tool: 'terminal',
        action: 'read',
        target: 'workspace',
        decision: 'ALLOW',
      },
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.agent_id).toBe('opencode');
    expect(event.task_id).toBe('task-1');
    expect(event.decision).toBe('ALLOW');
  });

  it('quarantines unsupported low-confidence candidate memory writes', () => {
    const tempDir = makeTempDir();
    try {
      const result = verifyCandidateMemory({
        memory_id: 'mem-1',
        memory_type: 'lesson',
        source_task: 'task-1',
        agent: 'hermes',
        situation: 'A retry was needed.',
        action: 'retry',
        outcome: 'unknown',
        lesson: 'Always retry this workflow.',
        confidence: 0.4,
        evidence: [],
      }, { storageOptions: { baseDir: tempDir } });

      expect(result.decision).toBe('QUARANTINE');
      expect(result.allowed).toBe(false);
      expect(result.reasons.join(' ')).toContain('confidence');
      expect(readFileSync(join(tempDir, '.safeloop', 'events.jsonl'), 'utf8')).toContain('memory.write.quarantined');
    } finally {
      cleanup(tempDir);
    }
  });

  it('rejects memory writes when the scenario contract rejects durable memory', () => {
    const tempDir = makeTempDir();
    try {
      const result = verifyCandidateMemory({
        memory_id: 'mem-2',
        memory_type: 'rule',
        situation: 'Task completed with evidence.',
        lesson: 'Use local source citations.',
        confidence: 0.95,
        evidence: ['evidence-1'],
      }, {
        scenario: {
          scenarioId: 'no-memory',
          memoryWritePolicy: 'reject',
        },
        storageOptions: { baseDir: tempDir },
      });

      expect(result.decision).toBe('REJECT');
      expect(result.allowed).toBe(false);
      expect(readFileSync(join(tempDir, '.safeloop', 'events.jsonl'), 'utf8')).toContain('memory.write.rejected');
    } finally {
      cleanup(tempDir);
    }
  });
});
