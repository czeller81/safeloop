/**
 * Execution permits.
 *
 * A permit is the only thing a SafeLoop managed executor accepts. It replaces
 * the v0.1 pattern:
 *
 *     evaluate() → "ALLOW" → caller performs some action later
 *
 * with:
 *
 *     evaluate(canonical action) → permit bound to that exact fingerprint
 *                               → executor verifies and consumes the permit
 *                               → exactly that side effect runs, once
 *
 * A permit is HMAC-signed, expiring, single-use, and bound to the action
 * fingerprint plus the full identity tuple (agent, task, session, scenario,
 * tenant). Any mismatch is a rejection, not a warning.
 */

import { createHmac, randomBytes } from 'crypto';
import { canonicalStringify } from './canonicalAction';
import { createAtomicClaimStore, type AtomicClaimStore } from './atomicStateStore';
import { loadRuntimeSecret, signaturesMatch } from './runtimeSecret';
import {
  PROTOCOL_VERSION,
  type ExecutionPermit,
  type ExecutionRejectionReason,
  type RuntimeDispositionCode,
} from './protocol';
import type { SafeloopStorageOptions } from '../localStorage';

/** Default permit lifetime. Short: a permit is meant to be redeemed at once. */
export const DEFAULT_PERMIT_TTL_MS = 120_000;

export interface PermitIdentity {
  agent_id: string;
  task_id: string;
  session_id: string;
  scenario_id: string;
  tenant_id: string;
}

export interface IssuePermitInput extends PermitIdentity {
  action_fingerprint: string;
  disposition: RuntimeDispositionCode;
  approval_id?: string;
  /** Workspace relation classified at proposal time; signed into the permit. */
  workspace_relation?: 'inside' | 'outside' | 'unknown';
  /** Resolved workspace root at proposal time; signed into the permit. */
  workspace_root?: string;
  /** Resolved working directory at authorization time; signed. */
  execution_cwd?: string;
  /** Resolved git directory for git actions; signed. */
  repository_identity?: string;
  ttl_ms?: number;
}

export interface PermitVerification {
  valid: boolean;
  reason?: ExecutionRejectionReason;
  detail?: string;
}

/** The exact claim set the signature covers. Order is fixed by canonicalStringify. */
function permitClaims(permit: Omit<ExecutionPermit, 'signature'>): string {
  return canonicalStringify({
    protocol_version: permit.protocol_version,
    permit_id: permit.permit_id,
    action_fingerprint: permit.action_fingerprint,
    agent_id: permit.agent_id,
    task_id: permit.task_id,
    session_id: permit.session_id,
    scenario_id: permit.scenario_id,
    tenant_id: permit.tenant_id,
    disposition: permit.disposition,
    approval_id: permit.approval_id ?? '',
    workspace_relation: permit.workspace_relation ?? '',
    workspace_root: permit.workspace_root ?? '',
    execution_cwd: permit.execution_cwd ?? '',
    repository_identity: permit.repository_identity ?? '',
    issued_at: permit.issued_at,
    expires_at: permit.expires_at,
    nonce: permit.nonce,
  });
}

export function signPermit(permit: Omit<ExecutionPermit, 'signature'>, secret: string): string {
  return createHmac('sha256', secret).update(permitClaims(permit), 'utf8').digest('hex');
}

export function issueExecutionPermit(input: IssuePermitInput, secret: string): ExecutionPermit {
  const issuedAt = Date.now();
  const unsigned: Omit<ExecutionPermit, 'signature'> = {
    protocol_version: PROTOCOL_VERSION,
    permit_id: `permit-${issuedAt}-${randomBytes(8).toString('hex')}`,
    action_fingerprint: input.action_fingerprint,
    agent_id: input.agent_id,
    task_id: input.task_id,
    session_id: input.session_id,
    scenario_id: input.scenario_id,
    tenant_id: input.tenant_id,
    disposition: input.disposition,
    approval_id: input.approval_id,
    workspace_relation: input.workspace_relation,
    workspace_root: input.workspace_root,
    execution_cwd: input.execution_cwd,
    repository_identity: input.repository_identity,
    issued_at: new Date(issuedAt).toISOString(),
    expires_at: new Date(issuedAt + (input.ttl_ms ?? DEFAULT_PERMIT_TTL_MS)).toISOString(),
    nonce: randomBytes(16).toString('hex'),
  };
  return { ...unsigned, signature: signPermit(unsigned, secret) };
}

/**
 * Verify a permit against the exact action and identity now being executed.
 *
 * Order matters: integrity first, so a forged permit is reported as forged
 * rather than leaking which field an attacker guessed wrong.
 */
export function verifyExecutionPermit(
  permit: ExecutionPermit | undefined,
  expected: PermitIdentity & { action_fingerprint: string },
  secret: string,
  now: number = Date.now(),
): PermitVerification {
  if (!permit || typeof permit !== 'object') {
    return { valid: false, reason: 'missing_permit', detail: 'no execution permit was supplied' };
  }
  if (permit.protocol_version !== PROTOCOL_VERSION) {
    return { valid: false, reason: 'permit_forged', detail: `unsupported protocol version: ${permit.protocol_version}` };
  }

  const { signature, ...unsigned } = permit;
  if (!signaturesMatch(signPermit(unsigned, secret), signature)) {
    return { valid: false, reason: 'permit_forged', detail: 'permit signature does not verify' };
  }

  if (!permit.expires_at || Date.parse(permit.expires_at) < now) {
    return { valid: false, reason: 'permit_expired', detail: `permit expired at ${permit.expires_at}` };
  }

  // Identity before fingerprint, so a cross-tenant or cross-task permit is
  // reported as the boundary it actually violated rather than as a generic
  // fingerprint mismatch (identity is part of the fingerprint binding set).
  if (permit.tenant_id !== expected.tenant_id) {
    return { valid: false, reason: 'tenant_mismatch', detail: 'permit belongs to a different tenant' };
  }
  if (permit.agent_id !== expected.agent_id) {
    return { valid: false, reason: 'identity_mismatch', detail: 'permit belongs to a different agent' };
  }
  if (permit.task_id !== expected.task_id) {
    return { valid: false, reason: 'task_mismatch', detail: 'permit belongs to a different task' };
  }
  if (permit.session_id !== expected.session_id) {
    return { valid: false, reason: 'identity_mismatch', detail: 'permit belongs to a different session' };
  }
  if (permit.scenario_id !== expected.scenario_id) {
    return { valid: false, reason: 'identity_mismatch', detail: 'permit belongs to a different scenario' };
  }

  if (permit.action_fingerprint !== expected.action_fingerprint) {
    return {
      valid: false,
      reason: 'fingerprint_mismatch',
      detail: 'permit authorizes a different action than the one submitted',
    };
  }

  return { valid: true };
}

export function createPermitStore(options: SafeloopStorageOptions = {}): AtomicClaimStore {
  return createAtomicClaimStore('permits', options);
}

/**
 * Atomically consume a permit. Exactly one caller wins; every other concurrent
 * attempt is rejected as already consumed.
 */
export function consumeExecutionPermit(permit: ExecutionPermit, store: AtomicClaimStore): PermitVerification {
  const result = store.claim(permit.permit_id, { expires_at: permit.expires_at });
  if (result.granted) return { valid: true };
  if (result.conflict === 'io_error') {
    return { valid: false, reason: 'invalid_runtime_state', detail: result.reason };
  }
  return { valid: false, reason: 'permit_consumed', detail: result.reason ?? 'permit has already been used' };
}

export interface PermitAuthority {
  issue(input: IssuePermitInput): ExecutionPermit;
  verify(permit: ExecutionPermit | undefined, expected: PermitIdentity & { action_fingerprint: string }): PermitVerification;
  /** Verify then atomically consume. The only call an executor should make. */
  redeem(permit: ExecutionPermit | undefined, expected: PermitIdentity & { action_fingerprint: string }): PermitVerification;
  revoke(permitId: string, reason: string): boolean;
  outstanding(): number;
}

export function createPermitAuthority(options: {
  storageOptions?: SafeloopStorageOptions;
  secret?: string;
  store?: AtomicClaimStore;
} = {}): PermitAuthority {
  const storageOptions = options.storageOptions ?? {};
  const secret = options.secret ?? loadRuntimeSecret(storageOptions);
  const store = options.store ?? createPermitStore(storageOptions);

  return {
    issue(input) {
      return issueExecutionPermit(input, secret);
    },
    verify(permit, expected) {
      return verifyExecutionPermit(permit, expected, secret);
    },
    redeem(permit, expected) {
      const verification = verifyExecutionPermit(permit, expected, secret);
      if (!verification.valid) return verification;
      return consumeExecutionPermit(permit as ExecutionPermit, store);
    },
    revoke(permitId, reason) {
      return store.revoke(permitId, reason).granted;
    },
    outstanding() {
      return store.count();
    },
  };
}
