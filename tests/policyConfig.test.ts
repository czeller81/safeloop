import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_SAFELOOP_POLICY,
  normalizeSafeloopPolicyConfig,
  readSafeloopPolicyConfig,
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
});
