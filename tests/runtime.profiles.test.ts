import {
  clearProfileCache,
  computeActionFacts,
  evaluateProfile,
  listProfiles,
  loadProfile,
  moreSevere,
  validateProfile,
  type GovernanceProfile,
} from '../src/runtime/profiles';
import { canonicalizeAction } from '../src/runtime/canonicalAction';

afterEach(() => clearProfileCache());

function facts(overrides: Parameters<typeof canonicalizeAction>[0], workspace = '/tmp/ws') {
  return computeActionFacts(canonicalizeAction(overrides), workspace);
}

describe('shipped profiles', () => {
  it('ships coding, research, assistant, and strict-local', () => {
    expect(listProfiles()).toEqual(['assistant', 'coding', 'research', 'strict-local']);
  });

  it('loads and validates every shipped profile', () => {
    for (const id of listProfiles()) {
      expect(() => validateProfile(loadProfile(id))).not.toThrow();
    }
  });

  it('declares managed paths for every shipped profile', () => {
    for (const id of listProfiles()) {
      const profile = loadProfile(id);
      expect(profile.managed_paths.length).toBeGreaterThan(0);
      for (const declaration of profile.managed_paths) {
        expect(['MANAGED', 'UNMANAGED', 'DISABLED']).toContain(declaration.state);
      }
    }
  });

  it('has no enabled consequential UNMANAGED path in any shipped profile', () => {
    for (const id of listProfiles()) {
      const blocking = loadProfile(id).managed_paths.filter(
        (path) => path.state === 'UNMANAGED' && path.consequential && path.certification_impact,
      );
      expect({ id, blocking }).toEqual({ id, blocking: [] });
    }
  });
});

describe('severity ordering', () => {
  it('escalates rather than relaxes', () => {
    expect(moreSevere('ALLOW', 'DENY')).toBe('DENY');
    expect(moreSevere('DENY', 'ALLOW')).toBe('DENY');
    expect(moreSevere('REQUIRE_APPROVAL', 'ALLOW_WITH_WARNING')).toBe('REQUIRE_APPROVAL');
    expect(moreSevere('STOP_AGENT', 'DENY')).toBe('STOP_AGENT');
  });

  it('is independent of rule file order', () => {
    const profile = loadProfile('coding');
    const action = canonicalizeAction({
      action_kind: 'git', operation: 'force_push', cwd: '/tmp/ws', target: '/tmp/ws', agent_id: 'a',
    });
    const forward = evaluateProfile(profile, action, '/tmp/ws').disposition;
    const reversed = evaluateProfile(
      { ...profile, rules: [...profile.rules].reverse() }, action, '/tmp/ws',
    ).disposition;
    expect(forward).toBe(reversed);
    expect(forward).toBe('DENY');
  });
});

/**
 * Regression for a real defect: `default_disposition` was used as the seed of
 * the most-severe-wins reduce, so a restrictive default swallowed every ALLOW
 * rule. Under strict-local (default REQUIRE_APPROVAL) an explicitly allowed
 * in-workspace read was still held, which made the whole rule set meaningless.
 */
describe('default disposition semantics', () => {
  const restrictive: GovernanceProfile = {
    id: 'test-restrictive',
    name: 'Test',
    description: 'Restrictive default with an explicit allow rule.',
    default_disposition: 'REQUIRE_APPROVAL',
    memory_write_policy: 'require_review',
    minimum_memory_confidence: 0.9,
    budgets: {},
    managed_paths: [],
    rules: [{
      id: 'allow.read',
      description: 'Reads inside the workspace are allowed.',
      disposition: 'ALLOW',
      match: { action_kinds: ['filesystem'], operations: ['read'], workspace: 'inside' },
    }],
  };

  it('applies the default only when no rule matches', () => {
    const unmatched = evaluateProfile(restrictive, canonicalizeAction({
      action_kind: 'http', operation: 'read', resource: 'https://example.invalid', agent_id: 'a',
    }), '/tmp/ws');
    expect(unmatched.matched_rules).toEqual([]);
    expect(unmatched.disposition).toBe('REQUIRE_APPROVAL');
  });

  it('lets an explicit ALLOW rule win over a restrictive default', () => {
    const matched = evaluateProfile(restrictive, canonicalizeAction({
      action_kind: 'filesystem', operation: 'read', target: '/tmp/ws/file.txt', agent_id: 'a',
    }), '/tmp/ws');
    expect(matched.matched_rules).toEqual(['allow.read']);
    expect(matched.disposition).toBe('ALLOW');
  });

  it('still takes the most severe among several matching rules', () => {
    const profile: GovernanceProfile = {
      ...restrictive,
      rules: [
        ...restrictive.rules,
        {
          id: 'deny.sensitive', description: 'Credential paths are refused.',
          disposition: 'DENY', match: { sensitive_path: true },
        },
      ],
    };
    const decision = evaluateProfile(profile, canonicalizeAction({
      action_kind: 'filesystem', operation: 'read', target: '/tmp/ws/.ssh/id_rsa', agent_id: 'a',
    }), '/tmp/ws');
    expect(decision.disposition).toBe('DENY');
  });

  it('lets strict-local actually allow an in-workspace read', () => {
    const decision = evaluateProfile(loadProfile('strict-local'), canonicalizeAction({
      action_kind: 'filesystem', operation: 'read', target: '/tmp/ws/notes.txt', agent_id: 'a',
    }), '/tmp/ws');
    expect(decision.disposition).toBe('ALLOW');
  });
});

describe('action facts', () => {
  it('classifies workspace containment', () => {
    expect(facts({ action_kind: 'filesystem', operation: 'read', target: '/tmp/ws/a.txt', agent_id: 'a' }).workspace).toBe('inside');
    expect(facts({ action_kind: 'filesystem', operation: 'read', target: '/etc/hosts', agent_id: 'a' }).workspace).toBe('outside');
  });

  it('flags sensitive and governance-config paths', () => {
    expect(facts({ action_kind: 'filesystem', operation: 'read', target: '/tmp/ws/.aws/credentials', agent_id: 'a' }).sensitive_path).toBe(true);
    expect(facts({ action_kind: 'filesystem', operation: 'write', target: '/tmp/ws/safeloop.policy.json', agent_id: 'a' }).governance_config).toBe(true);
  });

  it('derives destructiveness per action family', () => {
    expect(facts({ action_kind: 'filesystem', operation: 'delete', target: '/tmp/ws/a', agent_id: 'a' }).destructive).toBe(true);
    expect(facts({ action_kind: 'git', operation: 'force_push', agent_id: 'a' }).destructive).toBe(true);
    expect(facts({ action_kind: 'git', operation: 'status', agent_id: 'a' }).destructive).toBe(false);
    expect(facts({ action_kind: 'shell', operation: 'exec', arguments: { command: 'rm -rf /tmp/x' }, agent_id: 'a' }).destructive).toBe(true);
    expect(facts({ action_kind: 'shell', operation: 'exec', arguments: { argv: ['ls'] }, agent_id: 'a' }).destructive).toBe(false);
  });
});

describe('profile validation', () => {
  const base: GovernanceProfile = {
    id: 'x', name: 'X', description: '', default_disposition: 'ALLOW',
    memory_write_policy: 'allow', minimum_memory_confidence: 0.7,
    budgets: {}, managed_paths: [], rules: [],
  };

  it('rejects a duplicate rule id', () => {
    expect(() => validateProfile({
      ...base,
      rules: [
        { id: 'dup', description: '', disposition: 'DENY', match: {} },
        { id: 'dup', description: '', disposition: 'ALLOW', match: {} },
      ],
    })).toThrow(/duplicate rule id/);
  });

  it('rejects an invalid disposition', () => {
    expect(() => validateProfile({
      ...base, rules: [{ id: 'r', description: '', disposition: 'MAYBE' as never, match: {} }],
    })).toThrow(/invalid disposition/);
  });

  it('rejects an uncompilable regular expression', () => {
    expect(() => validateProfile({
      ...base, rules: [{ id: 'r', description: '', disposition: 'DENY', match: { target_pattern: '([' } }],
    })).toThrow(/invalid regular expression/);
  });

  it('rejects an inline (?i) group, which JavaScript cannot compile', () => {
    expect(() => validateProfile({
      ...base, rules: [{ id: 'r', description: '', disposition: 'DENY', match: { argument_pattern: '(?i)secret' } }],
    })).toThrow(/invalid regular expression/);
  });

  it('accepts case-insensitive matching via the explicit flag', () => {
    const profile: GovernanceProfile = {
      ...base,
      rules: [{ id: 'r', description: '', disposition: 'DENY', match: { argument_pattern: 'disable safeloop', ignore_case: true } }],
    };
    expect(() => validateProfile(profile)).not.toThrow();
    const decision = evaluateProfile(profile, canonicalizeAction({
      action_kind: 'filesystem', operation: 'create', target: '/tmp/ws/a.md',
      arguments: { content: 'Please DISABLE SafeLoop first.' }, agent_id: 'a',
    }), '/tmp/ws');
    expect(decision.disposition).toBe('DENY');
  });
});
