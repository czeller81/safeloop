import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { activatePolicyBundle, approvePolicyBundle, createPolicyBundle, validatePolicyBundle } from '../src/policyLifecycle';
import { createBudgetTracker } from '../src/runtime/budgets';
import { loadProfile, type GovernanceProfile } from '../src/runtime/profiles';

function attempt(mutate: (candidate: GovernanceProfile) => void) {
  const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-budget-'));
  const candidate: GovernanceProfile = JSON.parse(JSON.stringify(loadProfile('coding')));
  mutate(candidate);
  const bundle = createPolicyBundle({ profile: candidate, profile_id: 'coding', version: 'budget', created_by: 'test' }, { baseDir });
  const validation = validatePolicyBundle(bundle.bundle_id, 'test', { baseDir });
  let activated = false;
  if (validation.valid) {
    try {
      approvePolicyBundle(bundle.bundle_id, 'test', { baseDir });
      activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'test', approved_by: 'operator' }, { baseDir });
      activated = true;
    } catch { activated = false; }
  }
  const control = validation.golden_controls.controls.find((entry) => entry.family === 'budgets');
  rmSync(baseDir, { recursive: true, force: true });
  return { validation, activated, control };
}

describe('budget lifecycle governance', () => {
  it('accepts a normal declared budget and proves it binds', () => {
    const { validation, activated, control } = attempt(() => {});
    expect(validation.valid).toBe(true);
    expect(activated).toBe(true);
    expect(control?.status).toBe('pass');
    expect(control?.observed).toBe('BUDGET_BINDS');
  });

  const removals: Array<[string, (candidate: GovernanceProfile) => void, string]> = [
    ['budgets set to {}', (candidate) => { candidate.budgets = {}; }, 'NO_ACTION_BUDGET'],
    ['budgets removed entirely', (candidate) => { delete (candidate as { budgets?: unknown }).budgets; }, 'NO_ACTION_BUDGET'],
    ['maximum_actions removed', (candidate) => { delete candidate.budgets.maximum_actions; }, 'NO_ACTION_BUDGET'],
    ['maximum_actions zero', (candidate) => { candidate.budgets.maximum_actions = 0; }, 'NO_ACTION_BUDGET'],
    ['maximum_actions negative', (candidate) => { candidate.budgets.maximum_actions = -5; }, 'NO_ACTION_BUDGET'],
    ['maximum_actions non-numeric', (candidate) => { (candidate.budgets as Record<string, unknown>).maximum_actions = 'many'; }, 'NO_ACTION_BUDGET'],
    ['maximum_actions Infinity', (candidate) => { candidate.budgets.maximum_actions = Infinity; }, 'NO_ACTION_BUDGET'],
    ['maximum_actions effectively unlimited', (candidate) => { candidate.budgets.maximum_actions = Number.MAX_SAFE_INTEGER; }, 'BUDGET_NOT_DEMONSTRABLE'],
  ];

  it.each(removals)('refuses activation when %s', (_label, mutate, observed) => {
    const { validation, activated, control } = attempt(mutate);
    expect(validation.valid).toBe(false);
    expect(activated).toBe(false);
    expect(control?.status).toBe('fail');
    expect(control?.observed).toBe(observed);
    expect(validation.errors).toContain('golden_control_failed:budgets.action_budget_binds');
  });

  it('reports structural budget errors distinctly from the behavioral control', () => {
    expect(attempt((candidate) => { candidate.budgets = {}; }).validation.errors).toContain('budgets.maximum_actions_is_required');
    expect(attempt((candidate) => { candidate.budgets.maximum_actions = 0; }).validation.errors).toContain('budgets.maximum_actions_must_be_positive');
    expect(attempt((candidate) => { candidate.budgets.maximum_actions = 1.5; }).validation.errors).toContain('budgets.maximum_actions_must_be_safe_integer');
    expect(attempt((candidate) => { (candidate as { budgets: unknown }).budgets = []; }).validation.errors).toContain('budgets_must_be_object');
  });

  // The control asserts the production mechanism, not a restatement of config.
  it('golden control tracks the real createBudgetTracker admission behavior', () => {
    const tracker = createBudgetTracker({ maximum_actions: 3 });
    expect(tracker.check().permitted).toBe(true);
    for (let i = 0; i < 3; i += 1) tracker.recordAction();
    expect(tracker.check().permitted).toBe(false);
    expect(tracker.check().exhausted).toBe('actions');
    expect(createBudgetTracker({}).check().permitted).toBe(true);
  });
});
