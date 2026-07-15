import { createCommandGuard } from '../src/commandGuard';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeTempBaseDir(): string {
  const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-shell-test-'));
  mkdirSync(join(baseDir, '.safeloop'), { recursive: true });
  return baseDir;
}

function makeGuard(baseDir: string) {
  return createCommandGuard({
    policy: {
      oversightMode: 'HOTL',
      // Don't block echo — we want to test metachar detection, not blocked patterns
      blockedCommands: ['rm -rf'],
      requireApprovalFor: ['git push'],
    },
    sessionId: 'shell-test',
    caseId: 'shell-test-case',
    agentId: 'shell-test-agent',
    agentName: 'ShellTestAgent',
    storageOptions: { baseDir },
  });
}

describe('CommandGuard — shell metacharacter protection', () => {
  test('denies command with semicolon chaining', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    const result = guard.run('echo hello; rm -rf /tmp');

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);
    expect(result.violations).toBeDefined();
    expect(result.violations!.some((v) => v.includes('shell metacharacters'))).toBe(true);
  });

  test('denies command with pipe chaining', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    const result = guard.run('echo hello | cat /etc/passwd');

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);
    expect(result.violations!.some((v) => v.includes('shell metacharacters'))).toBe(true);
  });

  test('denies command with && chaining', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    const result = guard.run('echo hello && rm -rf .');

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);
    expect(result.violations!.some((v) => v.includes('shell metacharacters'))).toBe(true);
  });

  test('denies command with || chaining', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    const result = guard.run('false || rm -rf .');

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);
    expect(result.violations!.some((v) => v.includes('shell metacharacters'))).toBe(true);
  });

  test('denies command with command substitution $()', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    const result = guard.run('echo $(whoami)');

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);
    expect(result.violations!.some((v) => v.includes('shell metacharacters'))).toBe(true);
  });

  test('denies command with backticks', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    const result = guard.run('echo `whoami`');

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);
    expect(result.violations!.some((v) => v.includes('shell metacharacters'))).toBe(true);
  });

  test('allows safe command without metacharacters', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    const result = guard.run('node -e "console.log(\'safe\')"');

    expect(result.decision).toBe('allow');
    expect(result.executed).toBe(true);
    expect(result.output).toContain('safe');
  });

  test('allows simple echo', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    const result = guard.run('echo safeloop-ok');

    expect(result.decision).toBe('allow');
    expect(result.executed).toBe(true);
    expect(result.output).toContain('safeloop-ok');
  });

  test('does NOT execute the dangerous part when metacharacters present', () => {
    const baseDir = makeTempBaseDir();
    const guard = makeGuard(baseDir);

    // This should be denied — the marker file should NOT be created
    const markerPath = join(baseDir, 'should-not-exist.txt');
    const result = guard.run(`echo hello; touch ${markerPath}`);

    expect(result.decision).toBe('deny');
    expect(result.executed).toBe(false);

    // Verify marker file was not created
    const { existsSync } = require('fs');
    expect(existsSync(markerPath)).toBe(false);
  });
});
