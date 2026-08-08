/**
 * Bound approvals.
 *
 * This closes the P0 limitation recorded in the Hermes pilot: authorization was
 * an adapter-level boolean (`approved_context=true`, sourced from an
 * environment variable), so anything able to set that variable turned every
 * REQUIRE_APPROVAL into ALLOW.
 *
 * A bound approval instead binds a human decision to one exact canonical
 * action:
 *
 *     ActionProposal → CanonicalAction → ActionFingerprint
 *       → REQUIRE_APPROVAL → ApprovalRequest → human grant
 *       → BoundApprovalToken (HMAC-signed over the fingerprint + identity)
 *       → atomic redemption → ExecutionPermit for that fingerprint only
 *
 * Redemption is single-use and atomic, and it yields an execution permit rather
 * than a boolean, so the authorized action is the only action that can run.
 */

import { createHmac, randomBytes } from 'crypto';
import { canonicalStringify } from './canonicalAction';
import { createAtomicClaimStore, type AtomicClaimStore } from './atomicStateStore';
import { loadRuntimeSecret, signaturesMatch } from './runtimeSecret';
import { createPermitAuthority, type PermitAuthority } from './executionPermit';
import {
  PROTOCOL_VERSION,
  type ApprovalGrant,
  type ApprovalRedemption,
  type ApprovalRedemptionFailure,
  type ApprovalRequestRecord,
  type BoundApprovalToken,
} from './protocol';
import type { SafeloopStorageOptions } from '../localStorage';

/** Default approval lifetime. Long enough for a human, short enough to matter. */
export const DEFAULT_APPROVAL_TTL_MS = 300_000;

export interface ApprovalIdentity {
  agent_id: string;
  task_id: string;
  session_id: string;
  scenario_id: string;
  tenant_id: string;
}

export interface CreateApprovalRequestInput extends ApprovalIdentity {
  action_fingerprint: string;
  reason: string;
  risk_score?: number;
}

export interface RedeemApprovalInput extends ApprovalIdentity {
  action_fingerprint: string;
  /**
   * Whether the runtime's current evaluation of this exact action still says
   * approval was required. A token must never upgrade an action that policy
   * now denies outright.
   */
  approval_was_required: boolean;
}

function tokenClaims(token: Omit<BoundApprovalToken, 'signature'>): string {
  return canonicalStringify({
    protocol_version: token.protocol_version,
    approval_id: token.approval_id,
    action_fingerprint: token.action_fingerprint,
    agent_id: token.agent_id,
    task_id: token.task_id,
    session_id: token.session_id,
    scenario_id: token.scenario_id,
    tenant_id: token.tenant_id,
    issued_at: token.issued_at,
    expires_at: token.expires_at,
    nonce: token.nonce,
    policy_version: token.policy_version,
    approver: token.approver,
  });
}

export function signApprovalToken(token: Omit<BoundApprovalToken, 'signature'>, secret: string): string {
  return createHmac('sha256', secret).update(tokenClaims(token), 'utf8').digest('hex');
}

export function createApprovalRequest(input: CreateApprovalRequestInput): ApprovalRequestRecord {
  return {
    protocol_version: PROTOCOL_VERSION,
    approval_request_id: `approval-request-${Date.now()}-${randomBytes(8).toString('hex')}`,
    action_fingerprint: input.action_fingerprint,
    agent_id: input.agent_id,
    task_id: input.task_id,
    session_id: input.session_id,
    scenario_id: input.scenario_id,
    tenant_id: input.tenant_id,
    reason: input.reason,
    risk_score: input.risk_score ?? 0,
    requested_at: new Date().toISOString(),
  };
}

export interface ApprovalAuthorityConfig {
  storageOptions?: SafeloopStorageOptions;
  secret?: string;
  ttlMs?: number;
  policyVersion?: string;
  store?: AtomicClaimStore;
  permits?: PermitAuthority;
  permitTtlMs?: number;
}

export interface ApprovalAuthority {
  request(input: CreateApprovalRequestInput): ApprovalRequestRecord;
  /** Grant a pending request. Only a human decision should reach this. */
  grant(request: ApprovalRequestRecord, approver: string, ttlMs?: number): ApprovalGrant;
  /** Verify without consuming. Never sufficient on its own to execute. */
  validate(token: BoundApprovalToken | undefined, input: RedeemApprovalInput): ApprovalRedemption;
  /** Verify and atomically consume, yielding an execution permit. */
  redeem(token: BoundApprovalToken | undefined, input: RedeemApprovalInput): ApprovalRedemption;
  revoke(approvalId: string, reason: string): boolean;
  isSpent(approvalId: string): boolean;
  outstanding(): number;
  permits(): PermitAuthority;
}

function failure(
  approvalId: string,
  code: ApprovalRedemptionFailure,
  reason: string,
): ApprovalRedemption {
  return {
    protocol_version: PROTOCOL_VERSION,
    redeemed: false,
    approval_id: approvalId,
    failure: code,
    reason,
  };
}

export function createApprovalAuthority(config: ApprovalAuthorityConfig = {}): ApprovalAuthority {
  const storageOptions = config.storageOptions ?? {};
  const secret = config.secret ?? loadRuntimeSecret(storageOptions);
  const defaultTtl = config.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
  const policyVersion = config.policyVersion ?? PROTOCOL_VERSION;
  const store = config.store ?? createAtomicClaimStore('approvals', storageOptions);
  const permitAuthority = config.permits ?? createPermitAuthority({ storageOptions, secret });

  function verify(
    token: BoundApprovalToken | undefined,
    input: RedeemApprovalInput,
    now: number,
  ): ApprovalRedemption | null {
    if (!token || typeof token !== 'object') {
      return failure('', 'unknown_token', 'no approval token was supplied');
    }
    const approvalId = typeof token.approval_id === 'string' ? token.approval_id : '';

    if (token.protocol_version !== PROTOCOL_VERSION) {
      return failure(approvalId, 'forged', `unsupported protocol version: ${token.protocol_version}`);
    }

    // Integrity first: a forged token must not learn which claim it got wrong.
    const { signature, ...unsigned } = token;
    if (!signaturesMatch(signApprovalToken(unsigned, secret), signature)) {
      return failure(approvalId, 'forged', 'approval token signature does not verify');
    }

    const existing = store.read(approvalId);
    if (existing && existing.state === 'revoked') {
      return failure(approvalId, 'revoked', existing.reason ?? 'approval was revoked');
    }
    if (existing && existing.state === 'consumed') {
      return failure(approvalId, 'consumed', 'approval token has already been redeemed');
    }

    if (!token.expires_at || Date.parse(token.expires_at) < now) {
      return failure(approvalId, 'expired', `approval token expired at ${token.expires_at}`);
    }

    // Identity before fingerprint. Both reject, but the identity tuple is part
    // of the fingerprint binding set, so a cross-tenant or cross-task attempt
    // would otherwise surface only as a generic fingerprint mismatch. The
    // conformance suite and the ledger need the precise boundary that failed.
    if (token.tenant_id !== input.tenant_id) {
      return failure(approvalId, 'tenant_mismatch', 'approval belongs to a different tenant');
    }
    if (token.agent_id !== input.agent_id) {
      return failure(approvalId, 'agent_mismatch', 'approval belongs to a different agent');
    }
    if (token.task_id !== input.task_id) {
      return failure(approvalId, 'task_mismatch', 'approval belongs to a different task');
    }
    if (token.session_id !== input.session_id) {
      return failure(approvalId, 'session_mismatch', 'approval belongs to a different session');
    }
    if (token.scenario_id !== input.scenario_id) {
      return failure(approvalId, 'scenario_mismatch', 'approval belongs to a different scenario');
    }
    if (token.action_fingerprint !== input.action_fingerprint) {
      return failure(approvalId, 'fingerprint_mismatch', 'approval authorizes a different action');
    }

    // An approval only lifts a REQUIRE_APPROVAL hold. It cannot authorize an
    // action that policy currently denies or stops outright.
    if (!input.approval_was_required) {
      return failure(
        approvalId,
        'not_approval_required',
        'the current decision for this action is not REQUIRE_APPROVAL; an approval token cannot override it',
      );
    }

    return null;
  }

  return {
    request(input) {
      return createApprovalRequest(input);
    },

    grant(request, approver, ttlMs) {
      const issuedAt = Date.now();
      const unsigned: Omit<BoundApprovalToken, 'signature'> = {
        protocol_version: PROTOCOL_VERSION,
        approval_id: `approval-${issuedAt}-${randomBytes(8).toString('hex')}`,
        action_fingerprint: request.action_fingerprint,
        agent_id: request.agent_id,
        task_id: request.task_id,
        session_id: request.session_id,
        scenario_id: request.scenario_id,
        tenant_id: request.tenant_id,
        issued_at: new Date(issuedAt).toISOString(),
        expires_at: new Date(issuedAt + (ttlMs ?? defaultTtl)).toISOString(),
        nonce: randomBytes(16).toString('hex'),
        policy_version: policyVersion,
        approver,
      };
      const token: BoundApprovalToken = { ...unsigned, signature: signApprovalToken(unsigned, secret) };
      return {
        protocol_version: PROTOCOL_VERSION,
        approval_id: token.approval_id,
        approval_request_id: request.approval_request_id,
        approver,
        granted_at: token.issued_at,
        token,
      };
    },

    validate(token, input) {
      const problem = verify(token, input, Date.now());
      if (problem) return problem;
      return {
        protocol_version: PROTOCOL_VERSION,
        redeemed: false,
        approval_id: (token as BoundApprovalToken).approval_id,
        reason: 'approval token is valid but has not been consumed',
      };
    },

    redeem(token, input) {
      const problem = verify(token, input, Date.now());
      if (problem) return problem;

      const approved = token as BoundApprovalToken;

      // Atomic: exactly one concurrent redemption wins.
      const claim = store.claim(approved.approval_id, { expires_at: approved.expires_at });
      if (!claim.granted) {
        if (claim.conflict === 'io_error') {
          return failure(approved.approval_id, 'state_corrupted', claim.reason ?? 'approval state is unavailable');
        }
        if (claim.conflict === 'revoked') {
          return failure(approved.approval_id, 'revoked', claim.reason ?? 'approval was revoked');
        }
        return failure(approved.approval_id, 'consumed', 'approval token has already been redeemed');
      }

      const permit = permitAuthority.issue({
        action_fingerprint: approved.action_fingerprint,
        agent_id: approved.agent_id,
        task_id: approved.task_id,
        session_id: approved.session_id,
        scenario_id: approved.scenario_id,
        tenant_id: approved.tenant_id,
        disposition: 'REQUIRE_APPROVAL',
        approval_id: approved.approval_id,
        ttl_ms: config.permitTtlMs,
      });

      return {
        protocol_version: PROTOCOL_VERSION,
        redeemed: true,
        approval_id: approved.approval_id,
        redeemed_at: new Date().toISOString(),
        execution_permit: permit,
      };
    },

    revoke(approvalId, reason) {
      return store.revoke(approvalId, reason).granted;
    },

    isSpent(approvalId) {
      return store.isClaimed(approvalId);
    },

    outstanding() {
      return store.count();
    },

    permits() {
      return permitAuthority;
    },
  };
}
