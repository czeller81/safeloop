import { createScenarioLoop } from '../src/scenarioLoop';
import { readEvents } from '../src/eventStream';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeTempBaseDir(): string {
  const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-scenario-'));
  mkdirSync(join(baseDir, '.safeloop'), { recursive: true });
  return baseDir;
}

describe('scenarioLoop: dimension-coded scenario governance', () => {
  test('loop continues after allowed safe command', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'test-scenario',
        goal: 'produce verified result',
        successCondition: 'output contains test-pass',
        maxAttempts: 5,
        blockedCommands: ['rm -rf'],
        requireApprovalFor: ['git push'],
      },
      sessionId: 'test-session',
      storageOptions: { baseDir },
    });

    const result = loop.step({
      stepIndex: 0,
      actionType: 'command',
      command: 'node -e "console.log(\'step-ok\')"',
      description: 'Run safe test command',
    });

    expect(result.decision).toBe('continue');
    expect(result.shouldContinue).toBe(true);
    expect(result.outcome).toBe('allowed');
    expect(result.commandOutput).toContain('step-ok');
    expect(loop.isStopped()).toBe(false);
  });

  test('loop blocks and stops after dangerous command', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'test-scenario-danger',
        goal: 'test blocking',
        successCondition: 'n/a',
        blockedCommands: ['rm -rf', 'format c:'],
      },
      storageOptions: { baseDir },
    });

    const result = loop.step({
      stepIndex: 0,
      actionType: 'command',
      command: 'rm -rf /',
      description: 'Attempt dangerous command',
    });

    expect(result.decision).toBe('block');
    expect(result.shouldContinue).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.commandOutput).toBeUndefined();
    expect(loop.isStopped()).toBe(true);
  });

  test('loop escalates and stops after approval-required command', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'test-scenario-approval',
        goal: 'test escalation',
        successCondition: 'deployed',
        requireApprovalFor: ['git push', 'deploy'],
      },
      storageOptions: { baseDir },
    });

    const result = loop.step({
      stepIndex: 0,
      actionType: 'command',
      command: 'git push origin master',
      description: 'Deploy to production',
    });

    expect(result.decision).toBe('escalate');
    expect(result.shouldContinue).toBe(false);
    expect(result.outcome).toBe('escalated');
    expect(result.commandOutput).toBeUndefined();
    expect(loop.isStopped()).toBe(true);
  });

  test('loop stops when success condition is met via successSignal', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'test-scenario-success',
        goal: 'produce verified result',
        successCondition: 'all tests pass',
        maxAttempts: 10,
      },
      storageOptions: { baseDir },
    });

    // Step 0: normal work
    const r1 = loop.step({
      stepIndex: 0,
      actionType: 'validation',
      description: 'Running validation checks',
    });
    expect(r1.decision).toBe('continue');
    expect(r1.shouldContinue).toBe(true);

    // Step 1: success signal
    const r2 = loop.step({
      stepIndex: 1,
      actionType: 'validation',
      description: 'All tests pass',
      successSignal: true,
    });
    expect(r2.decision).toBe('success');
    expect(r2.shouldContinue).toBe(false);
    expect(r2.outcome).toBe('success');
    expect(loop.isStopped()).toBe(true);
  });

  test('loop stops when max attempts is reached', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'test-scenario-max',
        goal: 'test max attempts',
        successCondition: 'never',
        maxAttempts: 3,
      },
      storageOptions: { baseDir },
    });

    // Steps 0, 1, 2 should be fine
    loop.step({ stepIndex: 0, actionType: 'validation', description: 'step 0' });
    loop.step({ stepIndex: 1, actionType: 'validation', description: 'step 1' });
    loop.step({ stepIndex: 2, actionType: 'validation', description: 'step 2' });

    // Step 3 should hit max attempts (maxAttempts=3, stepIndex >= 3)
    const result = loop.step({ stepIndex: 3, actionType: 'validation', description: 'step 3 over limit' });
    expect(result.decision).toBe('stop');
    expect(result.shouldContinue).toBe(false);
    expect(result.reason).toContain('Max attempts');
    expect(loop.isStopped()).toBe(true);
  });

  test('events are emitted for each step', () => {
    const baseDir = makeTempBaseDir();
    const storageOptions = { baseDir };
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'test-events',
        goal: 'produce events',
        successCondition: 'done',
        blockedCommands: ['rm -rf'],
        requireApprovalFor: ['deploy'],
      },
      sessionId: 'evt-session',
      storageOptions,
    });

    // 1. allowed command
    loop.step({ stepIndex: 0, actionType: 'command', command: 'node -e "1"', description: 'safe' });

    // Reset loop for next test (create new loop since first is not stopped)
    const loop2 = createScenarioLoop({
      contract: {
        scenarioId: 'test-events-2',
        goal: 'events test 2',
        successCondition: 'done',
        blockedCommands: ['rm -rf'],
      },
      sessionId: 'evt-session',
      storageOptions,
    });

    // 2. blocked command
    loop2.step({ stepIndex: 0, actionType: 'command', command: 'rm -rf .', description: 'danger' });

    const events = readEvents(storageOptions);
    // command.allowed + scenario.step for step 0 of loop1
    // command.blocked + scenario.step for step 0 of loop2
    const scenarioEvents = events.filter(e => e.type === 'scenario.step');
    expect(scenarioEvents.length).toBe(2);
    expect(scenarioEvents[0].summary).toContain('continue');
    expect(scenarioEvents[1].summary).toContain('block');

    // metadata contains scenario details
    const meta = scenarioEvents[0].metadata as any;
    expect(meta.scenarioId).toBe('test-events');
    expect(meta.decision).toBe('continue');
    expect(meta.shouldContinue).toBe(true);
  });

  test('loop uses createCommandGuard for guarded command execution', () => {
    const baseDir = makeTempBaseDir();
    const storageOptions = { baseDir };
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'guard-integration',
        goal: 'prove guard integration',
        successCondition: 'output verified',
        blockedCommands: ['rm -rf'],
      },
      storageOptions,
    });

    // The guard should execute the safe command
    const result = loop.step({
      stepIndex: 0,
      actionType: 'command',
      command: 'node -e "console.log(\'guarded-ok\')"',
    });

    expect(result.decision).toBe('continue');
    expect(result.commandOutput).toContain('guarded-ok');

    // Verify command.allowed event was also emitted by the guard
    const events = readEvents(storageOptions);
    const guardEvent = events.find(e => e.type === 'command.allowed');
    expect(guardEvent).toBeDefined();
    expect(guardEvent!.summary).toContain('guarded-ok');
  });

  test('stopped loop refuses further steps', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'stopped-test',
        goal: 'test stopped state',
        successCondition: 'done',
        blockedCommands: ['danger'],
      },
      storageOptions: { baseDir },
    });

    // Block the loop
    loop.step({ stepIndex: 0, actionType: 'command', command: 'danger zone' });
    expect(loop.isStopped()).toBe(true);

    // Next step should be refused
    const result = loop.step({ stepIndex: 1, actionType: 'validation', description: 'should not run' });
    expect(result.decision).toBe('stop');
    expect(result.shouldContinue).toBe(false);
    expect(result.reason).toContain('already stopped');
  });

  test('non-command external action is blocked by runtime risk before side effect', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'external-risk',
        goal: 'avoid external publish',
        successCondition: 'blocked',
      },
      storageOptions: { baseDir },
    });

    const result = loop.step({
      stepIndex: 0,
      actionType: 'external_api_call',
      target: 'production',
      description: 'publish release to production webhook',
    });

    expect(result.decision).toBe('escalate');
    expect(result.shouldContinue).toBe(false);
    expect(loop.isStopped()).toBe(true);
  });

  test('allowed target boundary blocks out-of-scope non-command target', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'target-boundary',
        goal: 'stay local',
        successCondition: 'done',
        allowedTargets: ['local-vector-db'],
      },
      storageOptions: { baseDir },
    });

    const result = loop.step({
      stepIndex: 0,
      actionType: 'file_write',
      target: 'external-cloud-bucket',
      description: 'write indexed records',
    });

    expect(result.decision).toBe('block');
    expect(result.shouldContinue).toBe(false);
  });

  test('required evidence rule escalates before continuing', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'evidence-required',
        goal: 'prove before release',
        successCondition: 'done',
        requiredEvidenceFor: ['release readiness'],
      },
      storageOptions: { baseDir },
    });

    const result = loop.step({
      stepIndex: 0,
      actionType: 'validation',
      description: 'release readiness check',
    });

    expect(result.decision).toBe('escalate');
    expect(result.shouldContinue).toBe(false);
  });

  test('cost budget breach stops routed scenario work', () => {
    const baseDir = makeTempBaseDir();
    const loop = createScenarioLoop({
      contract: {
        scenarioId: 'cost-budget',
        goal: 'stay under budget',
        successCondition: 'done',
        maxCost: 0.01,
      },
      storageOptions: { baseDir },
    });

    const result = loop.step({
      stepIndex: 0,
      actionType: 'validation',
      description: 'expensive model call',
      cost: 1,
    });

    expect(result.decision).toBe('escalate');
    expect(result.shouldContinue).toBe(false);
  });
});
