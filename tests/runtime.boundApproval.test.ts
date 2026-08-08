import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApprovalAuthority, signApprovalToken, type ApprovalAuthority } from '../src/runtime/boundApproval';
import { createPermitAuthority, verifyExecutionPermit } from '../src/runtime/executionPermit';
import { actionFingerprintHash } from '../src/runtime/canonicalAction';
import { PROTOCOL_VERSION, type ActionProposal, type BoundApprovalToken } from '../src/runtime/protocol';
import { validateProtocol } from '../src/runtime/schemaValidator';

const SECRET = 'a'.repeat(64);

const action: ActionProposal = {
  action_kind: 'git',
  tool: 'git',
  operation: 'commit',
  arguments: { message: 'chore: governed commit', argv: ['commit', '-m', 'chore: governed commit'] },
  cwd: '/tmp/safeloop-v02-repo',
  target: 'refs/heads/main',
  agent_id: 'agent-a',
  task_id: 'task-1',
  session_id: 'session-1',
  scenario_id: 'scenario-1',
  tenant_id: 'tenant-a',
};

const identity = {
  agent_id: 'agent-a',
  task_id: 'task-1',
  session_id: 'session-1',
  scenario_id: 'scenario-1',
  tenant_id: 'tenant-a',
};

let baseDir: string;
let authority: ApprovalAuthority;

function redeemInput(overrides: Record<string, unknown> = {}) {
  return {
    ...identity,
    action_fingerprint: actionFingerprintHash(action),
    approval_was_required: true,
    ...overrides,
  } as Parameters<ApprovalAuthority['redeem']>[1];
}

function grantToken(): BoundApprovalToken {
  const request = authority.request({
    ...identity,
    action_fingerprint: actionFingerprintHash(action),
    reason: 'git commit requires approval under the coding profile',
    risk_score: 70,
  });
  return authority.grant(request, 'operator@local').token;
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v02-approval-'));
  authority = createApprovalAuthority({ storageOptions: { baseDir }, secret: SECRET });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe('approval request and grant', () => {
  it('produces a protocol-valid request bound to the action fingerprint', () => {
    const request = authority.request({
      ...identity,
      action_fingerprint: actionFingerprintHash(action),
      reason: 'git commit requires approval',
      risk_score: 70,
    });
    expect(validateProtocol('approval-request', request).valid).toBe(true);
    expect(request.action_fingerprint).toBe(actionFingerprintHash(action));
  });

  it('produces a protocol-valid signed grant', () => {
    const request = authority.request({
      ...identity,
      action_fingerprint: actionFingerprintHash(action),
      reason: 'git commit requires approval',
    });
    const grant = authority.grant(request, 'operator@local');
    expect(validateProtocol('approval-grant', grant).valid).toBe(true);
    expect(grant.token.approver).toBe('operator@local');
    expect(grant.token.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues a distinct nonce and id per grant', () => {
    const a = grantToken();
    const b = grantToken();
    expect(a.approval_id).not.toBe(b.approval_id);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe('valid redemption', () => {
  it('redeems once and returns an execution permit for that exact action', () => {
    const token = grantToken();
    const result = authority.redeem(token, redeemInput());

    expect(result.redeemed).toBe(true);
    expect(result.execution_permit).toBeDefined();
    expect(result.execution_permit?.action_fingerprint).toBe(actionFingerprintHash(action));
    expect(result.execution_permit?.approval_id).toBe(token.approval_id);
    expect(validateProtocol('approval-redemption', result).valid).toBe(true);
    expect(validateProtocol('execution-permit', result.execution_permit).valid).toBe(true);
  });

  it('issues a permit that verifies against the executing context', () => {
    const token = grantToken();
    const permit = authority.redeem(token, redeemInput()).execution_permit;
    const verification = verifyExecutionPermit(
      permit,
      { ...identity, action_fingerprint: actionFingerprintHash(action) },
      SECRET,
    );
    expect(verification.valid).toBe(true);
  });

  it('validate() checks without consuming', () => {
    const token = grantToken();
    expect(authority.validate(token, redeemInput()).failure).toBeUndefined();
    expect(authority.isSpent(token.approval_id)).toBe(false);
    expect(authority.redeem(token, redeemInput()).redeemed).toBe(true);
  });
});

describe('adversarial redemption', () => {
  it('rejects replay of a consumed token', () => {
    const token = grantToken();
    expect(authority.redeem(token, redeemInput()).redeemed).toBe(true);

    const replay = authority.redeem(token, redeemInput());
    expect(replay.redeemed).toBe(false);
    expect(replay.failure).toBe('consumed');
    expect(replay.execution_permit).toBeUndefined();
  });

  it('rejects an expired token', () => {
    const request = authority.request({
      ...identity,
      action_fingerprint: actionFingerprintHash(action),
      reason: 'expiring approval',
    });
    const token = authority.grant(request, 'operator@local', -1000).token;
    const result = authority.redeem(token, redeemInput());
    expect(result.failure).toBe('expired');
  });

  it('rejects a forged signature', () => {
    const token = grantToken();
    const forged = { ...token, signature: 'f'.repeat(64) };
    expect(authority.redeem(forged, redeemInput()).failure).toBe('forged');
  });

  it('rejects a token signed with a different secret', () => {
    const token = grantToken();
    const { signature, ...unsigned } = token;
    const foreign = { ...unsigned, signature: signApprovalToken(unsigned, 'b'.repeat(64)) };
    expect(authority.redeem(foreign, redeemInput()).failure).toBe('forged');
  });

  it('rejects a token whose claims were edited after signing', () => {
    const token = grantToken();
    const tampered = { ...token, expires_at: new Date(Date.now() + 86_400_000).toISOString() };
    expect(authority.redeem(tampered, redeemInput()).failure).toBe('forged');
  });

  it('rejects a revoked token', () => {
    const token = grantToken();
    expect(authority.revoke(token.approval_id, 'operator withdrew approval')).toBe(true);
    const result = authority.redeem(token, redeemInput());
    expect(result.failure).toBe('revoked');
  });

  it('rejects a token with no protocol version', () => {
    const token = grantToken();
    expect(authority.redeem({ ...token, protocol_version: 'safeloop.runtime.v0' }, redeemInput()).failure).toBe('forged');
  });

  it('rejects a missing token', () => {
    expect(authority.redeem(undefined, redeemInput()).failure).toBe('unknown_token');
  });
});

describe('substitution attacks', () => {
  const substitutions: Array<[string, Partial<ActionProposal>, string]> = [
    ['modified commit message', { arguments: { message: 'chore: evil', argv: ['commit', '-m', 'chore: evil'] } }, 'fingerprint_mismatch'],
    ['modified command', { operation: 'push' }, 'fingerprint_mismatch'],
    ['modified cwd', { cwd: '/tmp/safeloop-v02-other-repo' }, 'fingerprint_mismatch'],
    ['modified target', { target: 'refs/heads/production' }, 'fingerprint_mismatch'],
    ['different tool', { tool: 'gh' }, 'fingerprint_mismatch'],
    ['different action kind', { action_kind: 'shell' }, 'fingerprint_mismatch'],
  ];

  it.each(substitutions)('rejects %s', (_label, overrides, expected) => {
    const token = grantToken();
    const result = authority.redeem(token, redeemInput({
      action_fingerprint: actionFingerprintHash({ ...action, ...overrides }),
    }));
    expect(result.failure).toBe(expected);
    expect(result.execution_permit).toBeUndefined();
  });

  const contextSubstitutions: Array<[string, Record<string, unknown>, string]> = [
    ['different tenant', { tenant_id: 'tenant-b' }, 'tenant_mismatch'],
    ['different agent', { agent_id: 'agent-b' }, 'agent_mismatch'],
    ['different task', { task_id: 'task-2' }, 'task_mismatch'],
    ['different session', { session_id: 'session-2' }, 'session_mismatch'],
    ['different scenario', { scenario_id: 'scenario-2' }, 'scenario_mismatch'],
  ];

  it.each(contextSubstitutions)('rejects %s', (_label, overrides, expected) => {
    const token = grantToken();
    // The fingerprint is recomputed from the substituted context, so this is
    // the realistic attack: a whole coherent action from another context.
    const result = authority.redeem(token, redeemInput({
      ...overrides,
      action_fingerprint: actionFingerprintHash({ ...action, ...overrides }),
    }));
    expect(result.failure).toBe(expected);
  });

  it('rejects an approval for action A used for action B', () => {
    const tokenA = grantToken();
    const actionB: ActionProposal = { ...action, operation: 'push', target: 'origin/main' };
    const result = authority.redeem(tokenA, redeemInput({ action_fingerprint: actionFingerprintHash(actionB) }));
    expect(result.failure).toBe('fingerprint_mismatch');
  });

  it('refuses to upgrade an action policy no longer holds for approval', () => {
    const token = grantToken();
    const result = authority.redeem(token, redeemInput({ approval_was_required: false }));
    expect(result.failure).toBe('not_approval_required');
    expect(authority.isSpent(token.approval_id)).toBe(false);
  });
});

describe('concurrent redemption', () => {
  it('yields exactly one winner across parallel attempts in one process', async () => {
    const token = grantToken();
    const attempts = await Promise.all(
      Array.from({ length: 16 }, async () => authority.redeem(token, redeemInput())),
    );
    const winners = attempts.filter((attempt) => attempt.redeemed);
    expect(winners).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.failure === 'consumed')).toHaveLength(15);
  });

  it('yields exactly one winner across independent authority instances', () => {
    const token = grantToken();
    const others = Array.from({ length: 8 }, () =>
      createApprovalAuthority({ storageOptions: { baseDir }, secret: SECRET }),
    );
    const results = others.map((instance) => instance.redeem(token, redeemInput()));
    expect(results.filter((result) => result.redeemed)).toHaveLength(1);
  });

  it('issues exactly one permit, so the side effect can only happen once', async () => {
    const token = grantToken();
    const attempts = await Promise.all(
      Array.from({ length: 12 }, async () => authority.redeem(token, redeemInput())),
    );
    const permits = attempts.map((attempt) => attempt.execution_permit).filter(Boolean);
    expect(permits).toHaveLength(1);
  });
});

describe('execution permits', () => {
  const expected = { ...identity, action_fingerprint: actionFingerprintHash(action) };

  it('rejects a permit for a different fingerprint', () => {
    const permits = createPermitAuthority({ storageOptions: { baseDir }, secret: SECRET });
    const permit = permits.issue({ ...identity, action_fingerprint: actionFingerprintHash(action), disposition: 'ALLOW' });
    const verification = verifyExecutionPermit(
      permit,
      { ...expected, action_fingerprint: actionFingerprintHash({ ...action, operation: 'push' }) },
      SECRET,
    );
    expect(verification.reason).toBe('fingerprint_mismatch');
  });

  it('rejects a forged permit', () => {
    const permits = createPermitAuthority({ storageOptions: { baseDir }, secret: SECRET });
    const permit = permits.issue({ ...identity, action_fingerprint: expected.action_fingerprint, disposition: 'ALLOW' });
    expect(verifyExecutionPermit({ ...permit, signature: '0'.repeat(64) }, expected, SECRET).reason).toBe('permit_forged');
  });

  it('rejects an expired permit', () => {
    const permits = createPermitAuthority({ storageOptions: { baseDir }, secret: SECRET });
    const permit = permits.issue({ ...identity, action_fingerprint: expected.action_fingerprint, disposition: 'ALLOW', ttl_ms: -1 });
    expect(verifyExecutionPermit(permit, expected, SECRET).reason).toBe('permit_expired');
  });

  it('rejects a missing permit', () => {
    expect(verifyExecutionPermit(undefined, expected, SECRET).reason).toBe('missing_permit');
  });

  it('consumes a permit exactly once', () => {
    const permits = createPermitAuthority({ storageOptions: { baseDir }, secret: SECRET });
    const permit = permits.issue({ ...identity, action_fingerprint: expected.action_fingerprint, disposition: 'ALLOW' });
    expect(permits.redeem(permit, expected).valid).toBe(true);
    expect(permits.redeem(permit, expected).reason).toBe('permit_consumed');
  });

  it('rejects a permit from another tenant', () => {
    const permits = createPermitAuthority({ storageOptions: { baseDir }, secret: SECRET });
    const permit = permits.issue({ ...identity, tenant_id: 'tenant-b', action_fingerprint: expected.action_fingerprint, disposition: 'ALLOW' });
    expect(verifyExecutionPermit(permit, expected, SECRET).reason).toBe('tenant_mismatch');
  });

  it('never emits the signing secret in a permit', () => {
    const permits = createPermitAuthority({ storageOptions: { baseDir }, secret: SECRET });
    const permit = permits.issue({ ...identity, action_fingerprint: expected.action_fingerprint, disposition: 'ALLOW' });
    expect(JSON.stringify(permit)).not.toContain(SECRET);
  });
});

describe('protocol conformance of approval payloads', () => {
  it('every emitted structure validates against its schema', () => {
    const token = grantToken();
    expect(validateProtocol('approval-token', token).valid).toBe(true);
    const redemption = authority.redeem(token, redeemInput());
    expect(validateProtocol('approval-redemption', redemption).valid).toBe(true);
    const replay = authority.redeem(token, redeemInput());
    expect(validateProtocol('approval-redemption', replay).valid).toBe(true);
    expect(replay.protocol_version).toBe(PROTOCOL_VERSION);
  });
});
