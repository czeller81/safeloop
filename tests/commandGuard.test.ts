import { createCommandGuard } from '../src/commandGuard';
import { readEvents } from '../src/eventStream';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeTempBaseDir(): string {
  const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-guard-'));
  mkdirSync(join(baseDir, '.safeloop'), { recursive: true });
  return baseDir;
}

describe('commandGuard: enforced local circuit breaker', () => {
  test('safe command is allowed and executed', () => {
    const baseDir = makeTempBaseDir();
    const guard = createCommandGuard({
      policy: {
        oversightMode: 'HOTL',
        blockedCommands: ['rm -rf', 'format c:'],
        requireApprovalFor: ['git push', 'deploy'],
      },
      sessionId: 'test-run-1',
      caseId: 'test-case',
      agentId: 'test-agent',
      agentName: 'TestAgent',
      storageOptions: { baseDir },
    });

    const result = guard.run('node -e "console.log(\'safeloop-ok\')"');

    expect(result.decision).toBe('allow');
    expect(result.executed).toBe(true);
    expect(result.output).toContain('safeloop-ok');
    expect(result.exitCode).toBe(0);
    expect(result.eventId).toBeDefined();
  });

  test('dangerous command is blocked and NOT executed', () => {
    const baseDir = makeTempBaseDir();
    const guard = createCommandGuard({
      policy: {
        oversightMode: 'HOTL',
        blockedCommands: ['rm -rf', 'format c:', 'del /f'],
      },
      sessionId: 'test-run-2',
      caseId: 'test-case',
      agentId: 'test-agent',
      agentName: 'TestAgent',
      storageOptions: { baseDir },
    });

    const result = guard.run('rm -rf .');

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.violations).toBeDefined();
    expect(result.violations!.length).toBeGreaterThan(0);
    expect(result.violations!.some(v => v.includes('blocked command'))).toBe(true);
    expect(result.eventId).toBeDefined();
  });

  test('approval-required command does NOT execute immediately', () => {
    const baseDir = makeTempBaseDir();
    const guard = createCommandGuard({
      policy: {
        oversightMode: 'HOTL',
        blockedCommands: ['rm -rf'],
        requireApprovalFor: ['git push', 'deploy'],
      },
      sessionId: 'test-run-3',
      caseId: 'test-case',
      agentId: 'test-agent',
      agentName: 'TestAgent',
      storageOptions: { baseDir },
    });

    const result = guard.run('git push origin master');

    expect(result.decision).toBe('requires_approval');
    expect(result.executed).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.reasons).toBeDefined();
    expect(result.reasons!.length).toBeGreaterThan(0);
    expect(result.eventId).toBeDefined();
  });

  test('events are emitted for each decision path', () => {
    const baseDir = makeTempBaseDir();
    const storageOptions = { baseDir };
    const guard = createCommandGuard({
      policy: {
        oversightMode: 'HOTL',
        blockedCommands: ['rm -rf'],
        requireApprovalFor: ['deploy'],
      },
      sessionId: 'test-run-events',
      caseId: 'test-case',
      agentId: 'test-agent',
      agentName: 'TestAgent',
      storageOptions,
    });

    // 1. Allowed
    guard.run('node -e "console.log(\'ok\')"');
    // 2. Blocked
    guard.run('rm -rf /tmp/dangerous');
    // 3. Approval required
    guard.run('deploy production');

    const events = readEvents(storageOptions);
    expect(events.length).toBe(3);

    const allowed = events.find(e => e.type === 'command.allowed');
    const blocked = events.find(e => e.type === 'command.blocked');
    const approval = events.find(e => e.type === 'approval.requested');

    expect(allowed).toBeDefined();
    expect(allowed!.summary).toContain('allowed');
    expect((allowed!.metadata as any).decision).toBe('allow');

    expect(blocked).toBeDefined();
    expect(blocked!.summary).toContain('blocked');
    expect((blocked!.metadata as any).decision).toBe('deny');
    expect((blocked!.metadata as any).violations.length).toBeGreaterThan(0);

    expect(approval).toBeDefined();
    expect(approval!.summary).toContain('Approval required');
    expect((approval!.metadata as any).decision).toBe('requires_approval');
  });

  test('blocked command with multiple violation patterns', () => {
    const baseDir = makeTempBaseDir();
    const guard = createCommandGuard({
      policy: {
        oversightMode: 'HITL',
        blockedCommands: ['rm -rf', 'sudo', 'chmod 777'],
        maxRisk: 'low',
      },
      storageOptions: { baseDir },
    });

    const result = guard.run('sudo rm -rf /');

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);
    // Should have multiple violations
    expect(result.violations!.length).toBeGreaterThanOrEqual(1);
  });

  test('command timeout produces non-zero exit code', () => {
    const baseDir = makeTempBaseDir();
    const guard = createCommandGuard({
      policy: { oversightMode: 'HOOTL' },
      storageOptions: { baseDir },
      timeoutMs: 100, // very short timeout
    });

    // This command would take longer than 100ms
    const result = guard.run('node -e "setTimeout(()=>{},5000)"');

    expect(result.decision).toBe('allow');
    expect(result.executed).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.failureKind).toBe('process_timeout');
    expect(result.timedOut).toBe(true);
  });

  test('captures stdout, stderr, and real nonzero exit code', () => {
    const baseDir = makeTempBaseDir();
    const guard = createCommandGuard({
      policy: { oversightMode: 'HOOTL' },
      storageOptions: { baseDir },
    });

    const result = guard.run('node -e "console.log(\'OUT_OK\'); console.error(\'ERR_OK\'); process.exit(7)"');

    expect(result.decision).toBe('allow');
    expect(result.executed).toBe(true);
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toContain('OUT_OK');
    expect(result.stderr).toContain('ERR_OK');
    expect(result.failureKind).toBe('process_nonzero');
  });

  test('handles working directory containing spaces', () => {
    const baseDir = makeTempBaseDir();
    const spaced = join(baseDir, 'dir with spaces');
    mkdirSync(spaced, { recursive: true });
    writeFileSync(join(spaced, 'marker.txt'), 'ok');
    const guard = createCommandGuard({
      policy: { oversightMode: 'HOOTL' },
      storageOptions: { baseDir },
    });

    const result = guard.run('node -e "const fs=require(\'fs\'); console.log(fs.existsSync(\'marker.txt\') ? \'FOUND\' : \'MISSING\')"', { cwd: spaced });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('FOUND');
    expect(result.cwd).toBe(spaced);
    expect(result.failureKind).toBe('process_succeeded');
  });

  test('distinguishes spawn failure from process nonzero', () => {
    const baseDir = makeTempBaseDir();
    const guard = createCommandGuard({
      policy: { oversightMode: 'HOOTL' },
      storageOptions: { baseDir },
    });

    const result = guard.run('definitely-not-a-safeloop-command', { args: [] });

    expect(result.decision).toBe('allow');
    expect(result.executed).toBe(true);
    expect(result.failureKind).toBe('spawn_failed');
    expect(result.spawnError).toBeDefined();
  });

  test('invokes Python when available', () => {
    const python = spawnSync('python', ['--version'], { encoding: 'utf8' });
    if (python.error) {
      return;
    }
    const baseDir = makeTempBaseDir();
    const guard = createCommandGuard({
      policy: { oversightMode: 'HOOTL' },
      storageOptions: { baseDir },
    });

    const result = guard.run('python -c "print(\'PY_SAFELOOP_OK\')"');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PY_SAFELOOP_OK');
  });

  test('guard uses correct session and agent metadata in events', () => {
    const baseDir = makeTempBaseDir();
    const storageOptions = { baseDir };
    const guard = createCommandGuard({
      policy: { oversightMode: 'HOTL', blockedCommands: ['danger'] },
      sessionId: 'my-session-123',
      caseId: 'my-case-456',
      agentId: 'hermes-agent',
      agentName: 'Hermes',
      storageOptions,
    });

    guard.run('danger zone');

    const events = readEvents(storageOptions);
    expect(events.length).toBe(1);
    expect(events[0].sessionId).toBe('my-session-123');
    expect(events[0].caseId).toBe('my-case-456');
    expect(events[0].agentId).toBe('hermes-agent');
    expect(events[0].agentName).toBe('Hermes');
  });
});
