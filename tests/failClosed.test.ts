import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createGovernedPolicyEngine, type RuntimePolicyEvaluationInput } from '../src';
import * as runtimeGovernance from '../src/runtimeGovernance';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-failclosed-'));
}

function highRiskInput(overrides: Partial<RuntimePolicyEvaluationInput> = {}): RuntimePolicyEvaluationInput {
  return {
    agentId: 'agent-1',
    action: 'deploy to production',
    tool: 'deploy',
    target: 'production',
    ...overrides,
  };
}

function lowRiskInput(overrides: Partial<RuntimePolicyEvaluationInput> = {}): RuntimePolicyEvaluationInput {
  return {
    agentId: 'agent-1',
    action: 'read local status',
    tool: 'terminal',
    target: 'local-workspace',
    ...overrides,
  };
}

describe('fail-closed policy engine', () => {
  test('normal policy evaluation passes through unchanged', () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({ storageOptions: { baseDir } });

    const result = engine.evaluate(lowRiskInput());
    expect(result.failClosedFallback).toBe(false);
    expect(result.disposition).toBe('ALLOW');
    expect(result.allowed).toBe(true);
  });

  test('policy engine exception denies high-risk actions (fail-closed)', () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({ storageOptions: { baseDir } });

    // Mock evaluateRuntimePolicy to throw
    const spy = jest.spyOn(runtimeGovernance, 'evaluateRuntimePolicy').mockImplementation(() => {
      throw new Error('Policy engine unavailable');
    });

    try {
      const result = engine.evaluate(highRiskInput());
      expect(result.failClosedFallback).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.disposition).toBe('DENY');
      expect(result.failureReason).toContain('Policy engine unavailable');
      expect(result.triggeredPolicies).toContain('system.fail-closed');

      // Verify event was recorded to ledger
      const ledger = readFileSync(join(baseDir, '.safeloop', 'events.jsonl'), 'utf8');
      expect(ledger).toContain('policy.failed');
      expect(ledger).toContain('failClosed');
    } finally {
      spy.mockRestore();
    }
  });

  test('policy engine exception allows low-risk read actions (fail-open)', () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({ storageOptions: { baseDir } });

    const spy = jest.spyOn(runtimeGovernance, 'evaluateRuntimePolicy').mockImplementation(() => {
      throw new Error('Policy engine unavailable');
    });

    try {
      const result = engine.evaluate(lowRiskInput({ action: 'read file contents' }));
      expect(result.failClosedFallback).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.disposition).toBe('ALLOW_WITH_WARNING');
      expect(result.failureReason).toContain('Policy engine unavailable');
      expect(result.triggeredPolicies).toContain('system.fail-open');
    } finally {
      spy.mockRestore();
    }
  });

  test('malformed decision denies high-risk actions', () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({ storageOptions: { baseDir } });

    const spy = jest.spyOn(runtimeGovernance, 'evaluateRuntimePolicy').mockImplementation(() => {
      return { garbage: true } as any;
    });

    try {
      const result = engine.evaluate(highRiskInput());
      expect(result.failClosedFallback).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.disposition).toBe('DENY');
      expect(result.failureReason).toContain('malformed');
    } finally {
      spy.mockRestore();
    }
  });

  test('malformed decision allows low-risk actions with warning', () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({ storageOptions: { baseDir } });

    const spy = jest.spyOn(runtimeGovernance, 'evaluateRuntimePolicy').mockImplementation(() => {
      return null as any;
    });

    try {
      const result = engine.evaluate(lowRiskInput({ action: 'list directory' }));
      expect(result.failClosedFallback).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.disposition).toBe('ALLOW_WITH_WARNING');
    } finally {
      spy.mockRestore();
    }
  });

  test('governance engine failure is recorded to ledger', () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({ storageOptions: { baseDir } });

    const spy = jest.spyOn(runtimeGovernance, 'evaluateRuntimePolicy').mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    try {
      engine.evaluate(highRiskInput({ action: 'delete records', target: 'database' }));

      const ledger = readFileSync(join(baseDir, '.safeloop', 'events.jsonl'), 'utf8');
      expect(ledger).toContain('policy.failed');
      expect(ledger).toContain('Database connection failed');
      expect(ledger).toContain('failClosed');
    } finally {
      spy.mockRestore();
    }
  });

  test('side effects do not occur for high-risk actions on engine failure', () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({ storageOptions: { baseDir } });

    const spy = jest.spyOn(runtimeGovernance, 'evaluateRuntimePolicy').mockImplementation(() => {
      throw new Error('Service unavailable');
    });

    try {
      // These are all high-risk actions that must NOT proceed
      const actions = [
        'delete production database',
        'deploy to production',
        'send external email',
        'change permissions',
        'execute payment',
        'publish release',
      ];

      for (const action of actions) {
        const result = engine.evaluate(highRiskInput({ action }));
        expect(result.allowed).toBe(false);
        expect(result.shouldStopAgent).toBe(true);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test('explicitly configured fail-open overrides default for all actions', () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({
      defaultFailMode: 'open',
      storageOptions: { baseDir },
    });

    const spy = jest.spyOn(runtimeGovernance, 'evaluateRuntimePolicy').mockImplementation(() => {
      throw new Error('Unavailable');
    });

    try {
      // Even a high-risk action will fail open when explicitly configured
      const result = engine.evaluate(highRiskInput({ action: 'deploy to production' }));
      expect(result.failClosedFallback).toBe(true);
      expect(result.allowed).toBe(true);
      expect(result.disposition).toBe('ALLOW_WITH_WARNING');
    } finally {
      spy.mockRestore();
    }
  });

  test('async policy resolves before timeout', async () => {
    const engine = createGovernedPolicyEngine({
      timeoutMs: 100,
      evaluator: async (input) => runtimeGovernance.evaluateRuntimePolicy(input),
    });

    const result = await engine.evaluateAsync(lowRiskInput());
    expect(result.failClosedFallback).toBe(false);
    expect(result.disposition).toBe('ALLOW');
  });

  test('high-risk async policy timeout denies and records ledger event', async () => {
    const baseDir = makeTempDir();
    const engine = createGovernedPolicyEngine({
      timeoutMs: 5,
      storageOptions: { baseDir },
      evaluator: async () => new Promise((resolve) => {
        setTimeout(() => resolve(runtimeGovernance.evaluateRuntimePolicy(highRiskInput())), 50);
      }),
    });

    const result = await engine.evaluateAsync(highRiskInput({ action: 'deploy production release' }));
    expect(result.failClosedFallback).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.disposition).toBe('DENY');
    expect(result.failureReason).toContain('timed out');

    const ledger = readFileSync(join(baseDir, '.safeloop', 'events.jsonl'), 'utf8');
    expect(ledger).toContain('policy.failed');
    expect(ledger).toContain('timed out');
  });

  test('low-risk timeout can explicitly fail open', async () => {
    const engine = createGovernedPolicyEngine({
      timeoutMs: 5,
      failOpenPatterns: ['read local status'],
      evaluator: async () => new Promise((resolve) => {
        setTimeout(() => resolve(runtimeGovernance.evaluateRuntimePolicy(lowRiskInput())), 50);
      }),
    });

    const result = await engine.evaluateAsync(lowRiskInput());
    expect(result.failClosedFallback).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.disposition).toBe('ALLOW_WITH_WARNING');
  });

  test('zero, negative, and malformed timeout values fall back to safe default', async () => {
    for (const timeoutMs of [0, -1, Number.NaN]) {
      const engine = createGovernedPolicyEngine({
        timeoutMs,
        evaluator: async (input) => runtimeGovernance.evaluateRuntimePolicy(input),
      });
      const result = await engine.evaluateAsync(lowRiskInput());
      expect(result.failClosedFallback).toBe(false);
    }
  });

  test('side effect does not occur after high-risk timeout denial', async () => {
    const baseDir = makeTempDir();
    const sideEffectPath = join(baseDir, 'side-effect.txt');
    const engine = createGovernedPolicyEngine({
      timeoutMs: 5,
      evaluator: async () => new Promise((resolve) => {
        setTimeout(() => resolve(runtimeGovernance.evaluateRuntimePolicy(highRiskInput())), 50);
      }),
    });

    const decision = await engine.evaluateAsync(highRiskInput({ action: 'delete production database' }));
    if (decision.allowed) {
      throw new Error('test side effect');
    }

    expect(decision.allowed).toBe(false);
    expect(existsSync(sideEffectPath)).toBe(false);
  });
});
