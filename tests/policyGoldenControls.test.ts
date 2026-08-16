import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  GOVERNANCE_CONTROL_FAMILIES,
  activatePolicyBundle,
  approvePolicyBundle,
  createPolicyBundle,
  validatePolicyBundle,
} from '../src/policyLifecycle';
import { loadProfile, type GovernanceProfile } from '../src/runtime/profiles';

const SHIPPED = ['coding', 'research', 'assistant', 'strict-local'] as const;

function profile(id: string): GovernanceProfile {
  return JSON.parse(JSON.stringify(loadProfile(id)));
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-golden-'));
}

function validateMutated(mutate: (candidate: GovernanceProfile) => void, profileId = 'coding') {
  const baseDir = freshDir();
  const candidate = profile(profileId);
  mutate(candidate);
  const bundle = createPolicyBundle({ profile: candidate, profile_id: profileId, version: 'mutated', created_by: 'test' }, { baseDir });
  const validation = validatePolicyBundle(bundle.bundle_id, 'test', { baseDir });
  let activated = false;
  if (validation.valid) {
    try {
      approvePolicyBundle(bundle.bundle_id, 'test', { baseDir });
      activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'test', approved_by: 'operator' }, { baseDir });
      activated = true;
    } catch { activated = false; }
  }
  rmSync(baseDir, { recursive: true, force: true });
  return { validation, activated };
}

describe('golden control coverage completeness', () => {
  it('declares an explicit applicability for every governance family, with a reason', () => {
    for (const entry of GOVERNANCE_CONTROL_FAMILIES) {
      expect(['REQUIRED', 'NOT_APPLICABLE']).toContain(entry.applicability);
      expect(entry.reason.length).toBeGreaterThan(40);
    }
    const families = GOVERNANCE_CONTROL_FAMILIES.map((entry) => entry.family);
    expect(new Set(families).size).toBe(families.length);
    // Every action kind the rule engine dispatches on must be accounted for.
    for (const kind of ['shell', 'filesystem', 'git', 'http', 'memory', 'mcp', 'delegation', 'custom']) {
      expect(families).toContain(kind);
    }
  });

  it('runs every required control and reports complete coverage for shipped profiles', () => {
    for (const id of SHIPPED) {
      const { validation, activated } = validateMutated(() => {}, id);
      expect(validation.valid).toBe(true);
      expect(activated).toBe(true);
      expect(validation.golden_controls.coverage_complete).toBe(true);
      expect(validation.golden_controls.all_required_passed).toBe(true);
      expect(validation.golden_controls.coverage_errors).toEqual([]);
      expect(validation.golden_controls.executed_control_ids).toEqual(validation.golden_controls.required_control_ids);
      for (const control of validation.golden_controls.controls) expect(control.status).toBe('pass');
      const required = GOVERNANCE_CONTROL_FAMILIES.filter((entry) => entry.applicability === 'REQUIRED').map((entry) => entry.family);
      for (const family of required) {
        expect(validation.golden_controls.controls.some((control) => control.family === family && control.status === 'pass')).toBe(true);
      }
    }
  });

  it('records the control manifest on the activation record rather than only a boolean', () => {
    const baseDir = freshDir();
    const bundle = createPolicyBundle({ profile: profile('coding'), profile_id: 'coding', version: 'v1', created_by: 'test' }, { baseDir });
    validatePolicyBundle(bundle.bundle_id, 'test', { baseDir });
    approvePolicyBundle(bundle.bundle_id, 'test', { baseDir });
    const activation = activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'test', approved_by: 'operator' }, { baseDir });
    expect(activation.golden_controls_passed).toBe(true);
    expect(activation.control_set_version).toBe(activation.control_manifest.control_set_version);
    expect(activation.control_manifest.controls.length).toBe(activation.control_manifest.required_control_ids.length);
    for (const control of activation.control_manifest.controls) {
      expect(control.expected.length).toBeGreaterThan(0);
      expect(control.observed).toBeTruthy();
    }
    rmSync(baseDir, { recursive: true, force: true });
  });

  // Removing a protective rule is the real weakening vector: matched rules
  // reduce to the most severe disposition, so an added ALLOW cannot weaken.
  const removals: Array<[string, (candidate: GovernanceProfile) => void]> = [
    ['all rules removed', (candidate) => { candidate.rules = [{ id: 'only.custom', description: 'x', disposition: 'ALLOW', match: { action_kinds: ['custom'] } } as never]; }],
    ['shell rules removed', (candidate) => { candidate.rules = candidate.rules.filter((rule) => !(rule.match.action_kinds ?? []).includes('shell')); }],
    ['http rules removed', (candidate) => { candidate.rules = candidate.rules.filter((rule) => !(rule.match.action_kinds ?? []).includes('http')); }],
    ['git rules removed', (candidate) => { candidate.rules = candidate.rules.filter((rule) => !(rule.match.action_kinds ?? []).includes('git')); }],
    ['mcp rules removed', (candidate) => { candidate.rules = candidate.rules.filter((rule) => !(rule.match.action_kinds ?? []).includes('mcp')); }],
    ['delegation rules removed', (candidate) => { candidate.rules = candidate.rules.filter((rule) => !(rule.match.action_kinds ?? []).includes('delegation')); }],
    ['sensitive-path rules removed', (candidate) => { candidate.rules = candidate.rules.filter((rule) => rule.match.sensitive_path !== true); }],
    ['governance-config rules removed', (candidate) => { candidate.rules = candidate.rules.filter((rule) => rule.match.governance_config !== true); }],
    ['outside-workspace rules removed', (candidate) => { candidate.rules = candidate.rules.filter((rule) => rule.match.workspace !== 'outside'); }],
  ];
  it.each(removals)('fails closed when %s', (_label, mutate) => {
    const { validation, activated } = validateMutated(mutate);
    expect(validation.valid).toBe(false);
    expect(activated).toBe(false);
    expect(validation.golden_controls.all_required_passed).toBe(false);
    expect(validation.golden_controls.controls.some((control) => control.status !== 'pass')).toBe(true);
  });

  it('fails closed when the memory confidence floor is removed', () => {
    const { validation, activated } = validateMutated((candidate) => { candidate.minimum_memory_confidence = 0; });
    expect(validation.valid).toBe(false);
    expect(activated).toBe(false);
    const control = validation.golden_controls.controls.find((entry) => entry.family === 'memory');
    expect(control?.status).toBe('fail');
  });

  it('fails closed when durable memory is made unconditionally allowed', () => {
    const { validation } = validateMutated((candidate) => {
      candidate.memory_write_policy = 'allow';
      candidate.minimum_memory_confidence = 0;
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('golden_control_failed:memory.low_confidence_not_durably_allowed');
  });
});
