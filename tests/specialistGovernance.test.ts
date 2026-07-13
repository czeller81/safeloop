import {
  createEffectGuard,
  delegateSpecialistStep,
  evaluateSpecialistAction,
  reviewSpecialistResult,
  routeSpecialistTask,
  validateSpecialistTool,
} from '../src/specialistGovernance';
import { createMcpGateway } from '../src/mcp';
import { readEvents } from '../src/eventStream';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeTempBaseDir(prefix = 'safeloop-specialist-'): string {
  const baseDir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(baseDir, '.safeloop'), { recursive: true });
  return baseDir;
}

describe('specialist governance reliability', () => {
  test('video objectives route to video_director and never sales', () => {
    const routed = routeSpecialistTask({
      objective: 'Run a four-video visual-only MCP pipeline for the Malu Video Director project',
    });

    expect(routed.specialistId).toBe('video_director');
    expect(routed.specialistId).not.toBe('sales');
    expect(routed.reasons.join(' ')).toContain('video');
  });

  test('video infrastructure support may be delegated to coding', () => {
    const routed = routeSpecialistTask({
      objective: 'Generate video proxies and inspect Video Director MCP tool output',
      requiresInfrastructureSupport: true,
      preferredSupportSpecialist: 'coding',
    });

    expect(routed.specialistId).toBe('video_director');
    expect(routed.delegatedSupport).toBe('coding');
  });

  test('sales cannot use terminal and development mode does not override that denial', () => {
    const tool = validateSpecialistTool('sales', 'terminal');
    const action = evaluateSpecialistAction({
      specialistId: 'sales',
      actionKind: 'analysis',
      command: 'node -e "console.log(1)"',
      environment: 'development',
    });

    expect(tool.allowed).toBe(false);
    expect(tool.reasonCodes).toContain('specialist-tool-not-permitted');
    expect(action.decision).toBe('DENY');
    expect(action.reasonCodes).toContain('specialist-tool-not-permitted');
  });

  test('evaluateSpecialistAction, checkCommand, and runCommand agree on sales terminal denial', () => {
    const baseDir = makeTempBaseDir();
    const gateway = createMcpGateway({ baseDir });
    const evalDecision = evaluateSpecialistAction({
      specialistId: 'sales',
      actionKind: 'command',
      command: 'node -e "console.log(1)"',
      environment: 'development',
    });
    const check = gateway.checkCommand({
      specialistId: 'sales',
      command: 'node -e "console.log(1)"',
      environment: 'development',
    });
    const run = gateway.runCommand({
      specialistId: 'sales',
      command: 'node -e "console.log(1)"',
      environment: 'development',
    });

    expect(evalDecision.decision).toBe('DENY');
    expect(check.decision).toBe('deny');
    expect(check.executed).toBe(false);
    expect(run.decision).toBe('deny');
    expect(run.executed).toBe(false);
    expect(run.reasonCodes).toContain('specialist-tool-not-permitted');
  });

  test('policy decision token for one specialist cannot be reused by another', () => {
    const coding = evaluateSpecialistAction({
      specialistId: 'coding',
      actionKind: 'command',
      command: 'node -e "console.log(1)"',
      environment: 'development',
      taskId: 'task-1',
      executionPlanId: 'plan-1',
      stepId: 'step-1',
    });
    const reused = evaluateSpecialistAction({
      specialistId: 'operations',
      actionKind: 'command',
      command: 'node -e "console.log(1)"',
      environment: 'development',
      taskId: 'task-1',
      executionPlanId: 'plan-1',
      stepId: 'step-1',
      authorizationToken: coding.authorizationToken,
    });

    expect(coding.decision).toBe('ALLOW');
    expect(coding.authorizationToken).toBeDefined();
    expect(reused.decision).toBe('DENY');
    expect(reused.reasonCodes).toContain('authorization-context-mismatch');
  });

  test('delegated specialist execution records a handoff with a bound authorization', () => {
    const baseDir = makeTempBaseDir();
    const delegated = delegateSpecialistStep({
      fromSpecialistId: 'video_director',
      toSpecialistId: 'coding',
      taskId: 'video-task-1',
      executionPlanId: 'plan-video-1',
      stepId: 'step-infra-1',
      reason: 'Need terminal-backed proxy generation setup',
      tool: 'terminal',
      command: 'node -e "console.log(1)"',
      environment: 'development',
      storageOptions: { baseDir },
    });
    const events = readEvents({ baseDir });

    expect(delegated.ok).toBe(true);
    expect(delegated.authorizationToken).toMatch(/^sl-auth-/);
    expect(events.some((event) => event.type === 'specialist.delegated')).toBe(true);
    expect((events[0].metadata as any).fromSpecialistId).toBe('video_director');
    expect((events[0].metadata as any).toSpecialistId).toBe('coding');
  });

  test('minimal and extended specialist reviews succeed while invalid review reports fields', () => {
    const baseDir = makeTempBaseDir();
    const minimal = reviewSpecialistResult({
      specialistId: 'video_director',
      reviewerId: 'malu',
      status: 'approved',
      summary: 'Video plan is consistent.',
      recommendedNextStep: 'Proceed with guarded proxy generation.',
      storageOptions: { baseDir },
    });
    const extended = reviewSpecialistResult({
      specialistId: 'coding',
      reviewerId: 'malu',
      status: 'needs_changes',
      summary: 'Build needs a retry.',
      buildResults: [],
      testsRun: [{ name: 'unit', status: 'passed' }],
      unresolvedIssues: [{ severity: 'medium', summary: 'Missing fixture' }],
      artifacts: [],
      evidence: [],
      recommendedNextStep: 'Attach fixture evidence.',
      storageOptions: { baseDir },
    });
    const invalid = reviewSpecialistResult({
      specialistId: 'coding',
      status: 'approved',
      summary: 'Missing reviewer and next step',
    });

    expect(minimal.ok).toBe(true);
    expect(extended.ok).toBe(true);
    expect(invalid.ok).toBe(false);
    expect(invalid.errors?.map((error) => error.field)).toEqual(expect.arrayContaining(['reviewerId', 'recommendedNextStep']));
  });

  test('effect guard records mediated effects and reports coverage gaps', () => {
    const baseDir = makeTempBaseDir();
    const guard = createEffectGuard({
      storageOptions: { baseDir },
      registeredAdapters: ['terminal_execute'],
      expectedAdapters: ['terminal_execute', 'deploy'],
    });
    const result = guard.guardEffect({
      specialistId: 'coding',
      effectClass: 'terminal_execute',
      action: 'run local command',
      environment: 'development',
      execute: () => 'ok',
    });
    const status = guard.status();
    const events = readEvents({ baseDir });

    expect(result.status).toBe('allowed');
    expect(result.executed).toBe(true);
    expect(result.result).toBe('ok');
    expect(status.registeredAdapters).toContain('terminal_execute');
    expect(status.knownCoverageGaps).toContain('deploy');
    expect(events.some((event) => event.type === 'effect.evaluated')).toBe(true);
  });

  test('production-impacting effect fails closed when expected adapter is missing', () => {
    const guard = createEffectGuard({
      registeredAdapters: [],
      expectedAdapters: ['deploy'],
    });
    const result = guard.guardEffect({
      specialistId: 'operations',
      effectClass: 'deploy',
      action: 'deploy production',
      environment: 'production',
      execute: () => 'should-not-run',
    });

    expect(result.decision).toBe('DENY');
    expect(result.status).toBe('blocked');
    expect(result.executed).toBe(false);
    expect(result.reasonCodes).toContain('enforcement-adapter-missing');
  });
});
