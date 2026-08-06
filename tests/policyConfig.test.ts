import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  compileSafeloopPolicyMarkdown,
  DEFAULT_SAFELOOP_POLICY,
  initializeSafeloopPolicyConfig,
  normalizeSafeloopPolicyConfig,
  readSafeloopPolicyConfig,
  runPolicyDoctor,
  writeDefaultSafeloopPolicyConfig,
} from '../src/policyConfig';

describe('SafeLoop policy config', () => {
  test('reads defaults when policy file is absent', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-policy-'));
    const result = readSafeloopPolicyConfig({ baseDir });

    expect(result.exists).toBe(false);
    expect(result.policy).toMatchObject({
      version: 1,
      oversightMode: 'HOTL',
      blockedCommands: expect.arrayContaining(['rm -rf']),
      requireApprovalFor: expect.arrayContaining(['git push']),
    });
  });

  test('writes and reads default policy file', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-policy-'));
    const written = writeDefaultSafeloopPolicyConfig({ baseDir });
    const read = readSafeloopPolicyConfig({ baseDir });

    expect(written.exists).toBe(true);
    expect(read.exists).toBe(true);
    expect(read.policy).toEqual(DEFAULT_SAFELOOP_POLICY);
  });

  test('normalizes malformed policy fields back to safe defaults', () => {
    const result = normalizeSafeloopPolicyConfig({
      version: 999,
      oversightMode: 'INVALID',
      blockedCommands: ['format c:', 42],
      requireApprovalFor: 'deploy',
      maxRisk: 'extreme',
    });

    expect(result.version).toBe(1);
    expect(result.oversightMode).toBe('HOTL');
    expect(result.blockedCommands).toEqual(['format c:']);
    expect(result.requireApprovalFor).toEqual(DEFAULT_SAFELOOP_POLICY.requireApprovalFor);
    expect(result.maxRisk).toBe('high');
  });

  test('initializes k12 offline rag profile with markdown intent and deterministic json', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-policy-'));
    const result = initializeSafeloopPolicyConfig({ baseDir, profile: 'k12-offline-rag' });

    expect(result.policy.profile).toBe('k12-offline-rag');
    expect(result.policy.requireApprovalFor).toEqual(expect.arrayContaining(['curl', 'robocopy', 'npm install']));
    expect(result.policy.blockedCommands).toEqual(expect.arrayContaining(['Remove-Item .safeloop']));
    expect(existsSync(result.markdownPath)).toBe(true);
    expect(readFileSync(result.markdownPath, 'utf8')).toContain('Student PII must stay local');
  });

  test('compiles markdown policy sections into json command patterns', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-policy-'));
    const sourcePath = join(baseDir, 'district-policy.md');
    writeFileSync(sourcePath, `# District Policy

## Allowed

- Run \`npm test\`.

## Requires Human Review

- Network commands such as \`curl\` and \`scp\`.

## Blocked

- Delete ledgers with \`Remove-Item .safeloop\`.
`, 'utf8');

    const result = compileSafeloopPolicyMarkdown({ baseDir, sourcePath, profile: 'k12-offline-rag' });

    expect(result.extracted.allowedCommands).toEqual(['npm test']);
    expect(result.extracted.requireApprovalFor).toEqual(['curl', 'scp']);
    expect(result.extracted.blockedCommands).toEqual(['Remove-Item .safeloop']);
    expect(result.policy.allowedCommands).toEqual([]);
    expect(result.policy.requireApprovalFor).toContain('curl');
    expect(result.policy.blockedCommands).toContain('Remove-Item .safeloop');
    expect(readSafeloopPolicyConfig({ baseDir }).policy.profile).toBe('k12-offline-rag');
  });

  test('policy doctor reports missing compiled policy and k12 hardening checks', () => {
    const missingBaseDir = mkdtempSync(join(tmpdir(), 'safeloop-policy-'));
    const missing = runPolicyDoctor({ baseDir: missingBaseDir });

    expect(missing.ok).toBe(false);
    expect(missing.checks.some((entry) => entry.name === 'policy.json' && entry.status === 'fail')).toBe(true);

    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-policy-'));
    initializeSafeloopPolicyConfig({ baseDir, profile: 'k12-offline-rag' });
    const result = runPolicyDoctor({ baseDir });

    expect(result.ok).toBe(true);
    expect(result.profile).toBe('k12-offline-rag');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'k12 network review', status: 'pass' }),
      expect.objectContaining({ name: 'ledger protection', status: 'pass' }),
    ]));
  });
});
