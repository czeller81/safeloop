import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  activatePolicyBundle,
  approvePolicyBundle,
  createPolicyBundle,
  readPolicyLifecycleStore,
  validatePolicyBundle,
} from '../src/policyLifecycle';
import { loadProfile, type GovernanceProfile } from '../src/runtime/profiles';

function clone(): GovernanceProfile { return JSON.parse(JSON.stringify(loadProfile('coding'))); }
function eventLines(baseDir: string): string[] {
  const path = join(baseDir, '.safeloop', 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}
function lifecycleTypes(baseDir: string): string[] {
  return eventLines(baseDir)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.metadata?.policyLifecycle)
    .map((entry) => entry.type);
}

describe('lifecycle event emission ordering', () => {
  let baseDir: string;
  beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'safeloop-evt-')); });
  afterEach(() => { rmSync(baseDir, { recursive: true, force: true }); });

  it('emits committed lifecycle events for a successful activation', () => {
    const bundle = createPolicyBundle({ profile: clone(), profile_id: 'coding', version: 'v1', created_by: 'op' }, { baseDir });
    validatePolicyBundle(bundle.bundle_id, 'op', { baseDir });
    approvePolicyBundle(bundle.bundle_id, 'op', { baseDir });
    activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'op', approved_by: 'op' }, { baseDir });
    const types = lifecycleTypes(baseDir);
    expect(types).toContain('policy.bundle.validated');
    expect(types).toContain('policy.bundle.activated');
    // Every exported event must exist in the authoritative store too.
    const stored = new Set(readPolicyLifecycleStore({ baseDir }).events.map((entry) => entry.id));
    for (const line of eventLines(baseDir)) {
      const entry = JSON.parse(line);
      if (entry.metadata?.policyLifecycle) expect(stored.has(entry.id)).toBe(true);
    }
  });

  it('emits no authoritative success event when activation fails before commit', () => {
    // Unapproved bundle: validation runs inside the activation transaction and
    // then the transaction is rejected, so nothing may be announced.
    const bundle = createPolicyBundle({ profile: clone(), profile_id: 'coding', version: 'v1', created_by: 'op' }, { baseDir });
    const before = lifecycleTypes(baseDir);
    expect(() => activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'op', approved_by: 'op' }, { baseDir })).toThrow();
    const after = lifecycleTypes(baseDir);
    expect(after).toEqual(before);
    expect(after).not.toContain('policy.bundle.validated');
    expect(after).not.toContain('policy.bundle.activated');
    const store = readPolicyLifecycleStore({ baseDir });
    expect(store.activations).toHaveLength(0);
    expect(store.active).toBeUndefined();
  });

  it('emits no success event when an invalid candidate is activated', () => {
    const broken = clone();
    broken.budgets = {};
    const bundle = createPolicyBundle({ profile: broken, profile_id: 'coding', version: 'broken', created_by: 'op' }, { baseDir });
    expect(() => activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'op', approved_by: 'op' }, { baseDir })).toThrow();
    expect(lifecycleTypes(baseDir)).not.toContain('policy.bundle.activated');
    expect(readPolicyLifecycleStore({ baseDir }).active).toBeUndefined();
  });

  it('keeps the lifecycle transaction committed when post-commit export fails', () => {
    const bundle = createPolicyBundle({ profile: clone(), profile_id: 'coding', version: 'v1', created_by: 'op' }, { baseDir });
    validatePolicyBundle(bundle.bundle_id, 'op', { baseDir });
    approvePolicyBundle(bundle.bundle_id, 'op', { baseDir });
    // Force appendEvent to fail: events.jsonl becomes a directory.
    const eventsPath = join(baseDir, '.safeloop', 'events.jsonl');
    rmSync(eventsPath, { force: true });
    mkdirSync(eventsPath, { recursive: true });
    const activation = activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'op', approved_by: 'op' }, { baseDir });
    expect(activation.activation_id).toBeTruthy();
    const store = readPolicyLifecycleStore({ baseDir });
    expect(store.active?.bundle_id).toBe(bundle.bundle_id);
    expect(store.activations).toHaveLength(1);
    // The authoritative store still records the event even though export failed.
    expect(store.events.map((entry) => entry.type)).toContain('policy.bundle.activated');
  });

  it('never exports a lifecycle event that the store does not contain', () => {
    const bundle = createPolicyBundle({ profile: clone(), profile_id: 'coding', version: 'v1', created_by: 'op' }, { baseDir });
    validatePolicyBundle(bundle.bundle_id, 'op', { baseDir });
    approvePolicyBundle(bundle.bundle_id, 'op', { baseDir });
    activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'op', approved_by: 'op' }, { baseDir });
    const broken = clone();
    broken.rules = broken.rules.filter((rule) => !(rule.match.action_kinds ?? []).includes('shell'));
    const bad = createPolicyBundle({ profile: broken, profile_id: 'coding', version: 'bad', created_by: 'op' }, { baseDir });
    expect(() => activatePolicyBundle({ bundle_id: bad.bundle_id, actor: 'op', approved_by: 'op' }, { baseDir })).toThrow();
    const stored = new Set(readPolicyLifecycleStore({ baseDir }).events.map((entry) => entry.id));
    for (const line of eventLines(baseDir)) {
      const entry = JSON.parse(line);
      if (entry.metadata?.policyLifecycle) expect(stored.has(entry.id)).toBe(true);
    }
  });
});
