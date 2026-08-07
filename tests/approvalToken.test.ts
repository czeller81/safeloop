import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApprovalGate, type ApprovalRequest, type ApprovalRedemptionContext } from '../src';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-approval-'));
}

function baseRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    action: 'deploy',
    target: 'production',
    argumentsHash: 'abc123',
    taskId: 'task-1',
    sessionId: 'session-1',
    tenantId: 'tenant-alpha',
    agentId: 'agent-1',
    agentName: 'TestAgent',
    environment: 'production',
    reason: 'Release v1.0',
    requestedBy: 'agent-1',
    ...overrides,
  };
}

function baseContext(overrides: Partial<ApprovalRedemptionContext> = {}): ApprovalRedemptionContext {
  return {
    action: 'deploy',
    target: 'production',
    argumentsHash: 'abc123',
    taskId: 'task-1',
    sessionId: 'session-1',
    tenantId: 'tenant-alpha',
    agentId: 'agent-1',
    environment: 'production',
    ...overrides,
  };
}

describe('approval token hardening', () => {
  test('1. valid approval succeeds', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest(), 'human-operator');
    const result = gate.redeem(token, baseContext());

    expect(result.valid).toBe(true);
    expect(result.tokenId).toBe(token.tokenId);
    expect(result.eventId).toBeDefined();
  });

  test('2. expired approval fails', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ ttlMs: 1, storageOptions: { baseDir } });
    const token = gate.issue(baseRequest(), 'human-operator');

    // Wait for token to expire
    const expired = { ...token, expiresAt: new Date(Date.now() - 1000).toISOString() };
    // Re-sign with correct secret is not possible externally, so we test time passage
    // Use a gate with 1ms TTL and add a small delay
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = gate.redeem(token, baseContext());
        expect(result.valid).toBe(false);
        expect(result.failure).toBe('expired');
        resolve();
      }, 10);
    });
  });

  test('3. reused approval fails (single-use)', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest(), 'human-operator');

    // First redemption succeeds
    const first = gate.redeem(token, baseContext());
    expect(first.valid).toBe(true);

    // Second redemption fails (consumed)
    const second = gate.redeem(token, baseContext());
    expect(second.valid).toBe(false);
    expect(second.failure).toBe('consumed');
  });

  test('4. forged approval fails', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest(), 'human-operator');

    // Tamper with the signature
    const forged = { ...token, signature: 'forged-signature-value-0000000000000000000000000000000000000000' };
    const result = gate.redeem(forged, baseContext());

    expect(result.valid).toBe(false);
    expect(result.failure).toBe('forged');
  });

  test('5. approval for different action fails', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest({ action: 'deploy' }), 'human-operator');

    const result = gate.redeem(token, baseContext({ action: 'delete' }));
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('action_mismatch');
  });

  test('6. approval for different target fails', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest({ target: 'production' }), 'human-operator');

    const result = gate.redeem(token, baseContext({ target: 'staging' }));
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('target_mismatch');
  });

  test('7. approval for different tenant fails', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest({ tenantId: 'tenant-alpha' }), 'human-operator');

    const result = gate.redeem(token, baseContext({ tenantId: 'tenant-beta' }));
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('tenant_mismatch');
  });

  test('8. approval for different task fails', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest({ taskId: 'task-1' }), 'human-operator');

    const result = gate.redeem(token, baseContext({ taskId: 'task-2' }));
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('task_mismatch');
  });

  test('9. approval for different agent fails', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest({ agentId: 'agent-1' }), 'human-operator');

    const result = gate.redeem(token, baseContext({ agentId: 'agent-2' }));
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('agent_mismatch');
  });

  test('10. modified arguments invalidate approval', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest({ argumentsHash: 'hash-original' }), 'human-operator');

    const result = gate.redeem(token, baseContext({ argumentsHash: 'hash-modified' }));
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('arguments_mismatch');
  });

  test('11. approval cannot be silently bypassed — execution remains blocked', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });

    // Issue token for action A
    const token = gate.issue(baseRequest({ action: 'deploy', target: 'production' }), 'human-operator');

    // Try to use it for a different action (bypass attempt)
    const bypassAttempt = gate.redeem(token, baseContext({ action: 'delete', target: 'database' }));
    expect(bypassAttempt.valid).toBe(false);

    // The original token should still be valid for the correct context (not consumed by failed attempt)
    const legitimate = gate.redeem(token, baseContext({ action: 'deploy', target: 'production' }));
    expect(legitimate.valid).toBe(true);
  });

  test('revoked token cannot be redeemed', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest(), 'human-operator');

    const revoked = gate.revoke(token.tokenId, 'Changed mind');
    expect(revoked).toBe(true);

    const result = gate.redeem(token, baseContext());
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('consumed');
  });

  test('validate checks token without consuming it', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest(), 'human-operator');

    // Validate should succeed
    const check = gate.validate(token, baseContext());
    expect(check.valid).toBe(true);

    // Token should still be redeemable (not consumed by validate)
    const redeemed = gate.redeem(token, baseContext());
    expect(redeemed.valid).toBe(true);
  });

  test('environment mismatch is detected', () => {
    const baseDir = makeTempDir();
    const gate = createApprovalGate({ storageOptions: { baseDir } });
    const token = gate.issue(baseRequest({ environment: 'production' }), 'human-operator');

    const result = gate.redeem(token, baseContext({ environment: 'staging' }));
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('environment_mismatch');
  });
});
