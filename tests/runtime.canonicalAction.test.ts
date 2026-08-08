import {
  actionFingerprintHash,
  canonicalStringify,
  canonicalizeAction,
  describeCanonicalAction,
  fingerprintAction,
  normalizeCwd,
} from '../src/runtime/canonicalAction';
import { PROTOCOL_VERSION, type ActionProposal } from '../src/runtime/protocol';

const base: ActionProposal = {
  action_kind: 'shell',
  tool: 'terminal',
  operation: 'exec',
  arguments: { argv: ['npm', 'test'], shell: false },
  cwd: '/tmp/safeloop-v02-workspace',
  target: '/tmp/safeloop-v02-workspace',
  agent_id: 'agent-a',
  task_id: 'task-1',
  session_id: 'session-1',
  scenario_id: 'scenario-1',
  tenant_id: 'tenant-a',
  trace_id: 'trace-1',
};

function fp(overrides: Partial<ActionProposal> = {}): string {
  return actionFingerprintHash({ ...base, ...overrides });
}

describe('canonicalStringify', () => {
  it('sorts object keys deterministically regardless of insertion order', () => {
    const a = canonicalStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalStringify({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
  });

  it('preserves array order because argv position is semantic', () => {
    expect(canonicalStringify(['a', 'b'])).not.toBe(canonicalStringify(['b', 'a']));
  });

  it('drops undefined properties but keeps null', () => {
    expect(canonicalStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('never emits non-finite numbers', () => {
    expect(canonicalStringify({ a: Number.NaN, b: Number.POSITIVE_INFINITY })).toBe('{"a":null,"b":null}');
  });
});

describe('normalizeCwd', () => {
  it('resolves . and .. lexically', () => {
    expect(normalizeCwd('/a/b/../c')).toBe('/a/c');
    expect(normalizeCwd('/a/./b/')).toBe('/a/b');
  });

  it('strips trailing separators but keeps root', () => {
    expect(normalizeCwd('/a/b/')).toBe('/a/b');
    expect(normalizeCwd('/')).toBe('/');
  });

  it('normalizes windows paths and uppercases the drive letter only', () => {
    expect(normalizeCwd('c:\\Users\\Repo\\')).toBe('C:\\Users\\Repo');
    expect(normalizeCwd('C:\\Users\\Repo')).toBe('C:\\Users\\Repo');
  });

  it('does not lowercase path segments', () => {
    expect(normalizeCwd('/Data/Secrets')).toBe('/Data/Secrets');
  });
});

describe('canonicalizeAction', () => {
  it('fills every slot so absent and empty collapse to one form', () => {
    const canonical = canonicalizeAction({ action_kind: 'shell', agent_id: 'a' });
    expect(canonical.protocol_version).toBe(PROTOCOL_VERSION);
    expect(canonical.tool).toBe('');
    expect(canonical.arguments).toEqual({});
    expect(canonical.trace_id).toBe('');
  });

  it('lowercases only case-insensitive protocol slots', () => {
    const canonical = canonicalizeAction({
      ...base,
      tool: 'TERMINAL',
      operation: 'EXEC',
      method: 'post',
      target: '/Data/File.TXT',
    });
    expect(canonical.tool).toBe('terminal');
    expect(canonical.operation).toBe('exec');
    expect(canonical.method).toBe('post');
    expect(canonical.target).toBe('/Data/File.TXT');
  });

  it('coerces an unknown action kind to custom rather than trusting it', () => {
    expect(canonicalizeAction({ action_kind: 'kernel' as never, agent_id: 'a' }).action_kind).toBe('custom');
  });
});

describe('fingerprintAction — stability', () => {
  it('produces the same fingerprint for the same logical action', () => {
    expect(fp()).toBe(fp());
  });

  it('is insensitive to object key order in arguments', () => {
    const left = fp({ arguments: { argv: ['npm', 'test'], shell: false } });
    const right = fp({ arguments: { shell: false, argv: ['npm', 'test'] } });
    expect(left).toBe(right);
  });

  it('is insensitive to equivalent cwd spellings', () => {
    expect(fp({ cwd: '/tmp/safeloop-v02-workspace/' })).toBe(fp());
    expect(fp({ cwd: '/tmp/other/../safeloop-v02-workspace' })).toBe(fp());
  });

  it('is insensitive to trace_id, so an approval survives into execution', () => {
    expect(fp({ trace_id: 'trace-2' })).toBe(fp());
  });

  it('emits a 64-character lowercase sha256 hash and the exact hashed bytes', () => {
    const result = fingerprintAction(base);
    expect(result.algorithm).toBe('sha256');
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.canonical_form).toContain('"action_kind":"shell"');
    expect(result.canonical_form).not.toContain('trace_id');
  });

  it('accepts an already-canonical action without recanonicalizing it', () => {
    const canonical = canonicalizeAction(base);
    expect(fingerprintAction(canonical).fingerprint).toBe(fp());
  });
});

describe('fingerprintAction — security-significant differences', () => {
  const cases: Array<[string, Partial<ActionProposal>]> = [
    ['changed argument value', { arguments: { argv: ['npm', 'publish'], shell: false } }],
    ['added argument', { arguments: { argv: ['npm', 'test'], shell: false, force: true } }],
    ['removed argument', { arguments: { argv: ['npm', 'test'] } }],
    ['reordered argv', { arguments: { argv: ['test', 'npm'], shell: false } }],
    ['argument case change', { arguments: { argv: ['npm', 'TEST'], shell: false } }],
    ['changed operation', { operation: 'spawn' }],
    ['changed tool', { tool: 'bash' }],
    ['changed action kind', { action_kind: 'filesystem' }],
    ['changed cwd', { cwd: '/tmp/safeloop-v02-other' }],
    ['changed target', { target: '/etc/passwd' }],
    ['target case change', { target: '/TMP/safeloop-v02-workspace' }],
    ['changed resource', { resource: 'https://example.invalid' }],
    ['changed method', { method: 'DELETE' }],
    ['changed agent', { agent_id: 'agent-b' }],
    ['changed parent agent', { parent_agent_id: 'agent-root' }],
    ['changed task', { task_id: 'task-2' }],
    ['changed session', { session_id: 'session-2' }],
    ['changed scenario', { scenario_id: 'scenario-2' }],
    ['changed tenant', { tenant_id: 'tenant-b' }],
  ];

  it.each(cases)('%s changes the fingerprint', (_label, overrides) => {
    expect(fp(overrides)).not.toBe(fp());
  });

  it('distinguishes every case pairwise, not just from the baseline', () => {
    const fingerprints = new Set([fp(), ...cases.map(([, overrides]) => fp(overrides))]);
    expect(fingerprints.size).toBe(cases.length + 1);
  });

  it('does not let a nested argument change slip through', () => {
    const left = fp({ arguments: { env: { NODE_ENV: 'test' } } });
    const right = fp({ arguments: { env: { NODE_ENV: 'production' } } });
    expect(left).not.toBe(right);
  });

  it('separates an empty string argument from an absent one', () => {
    expect(fp({ arguments: { message: '' } })).not.toBe(fp({ arguments: {} }));
  });
});

describe('describeCanonicalAction', () => {
  it('summarizes an action for approval prompts', () => {
    const summary = describeCanonicalAction(canonicalizeAction({
      action_kind: 'git',
      operation: 'commit',
      target: 'HEAD',
      cwd: '/tmp/repo',
      agent_id: 'a',
    }));
    expect(summary).toBe('git commit HEAD in /tmp/repo');
  });
});
