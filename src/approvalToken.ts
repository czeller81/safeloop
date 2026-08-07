/**
 * SafeLoop Hardened Approval Token System
 *
 * Provides action-bound, time-limited, single-use, non-replayable,
 * tenant-bound approval tokens for runtime governance.
 *
 * An approval token binds authorization to a canonical hash of:
 * - action
 * - target
 * - normalized arguments hash
 * - task
 * - tenant
 * - agent
 * - environment
 *
 * Tokens are:
 * - action-bound: cannot be used for a different action/target
 * - agent-bound: cannot be transferred to a different agent
 * - task/session-bound: cannot be used across sessions
 * - tenant-bound: cannot cross tenant boundaries
 * - time-limited: expire after a configurable TTL
 * - single-use: consumed on first redemption
 * - non-replayable: consumed tokens cannot be resubmitted
 * - non-transferable: bound to the original requesting context
 * - resistant to forgery: HMAC-signed with a secret
 */

import { createHash, createHmac, randomBytes } from 'crypto';
import { appendEvent } from './eventStream';
import type { SafeloopStorageOptions } from './localStorage';

// --- Types ---

export interface ApprovalRequest {
  action: string;
  target?: string;
  argumentsHash?: string;
  taskId?: string;
  sessionId?: string;
  tenantId?: string;
  agentId: string;
  agentName?: string;
  environment?: string;
  reason: string;
  riskScore?: number;
  requestedBy: string;
  requestedFor?: string;
}

export interface ApprovalTokenConfig {
  /** Token TTL in milliseconds (default: 300000 = 5 minutes) */
  ttlMs?: number;
  /** Secret for HMAC signing. If not provided, a random one is generated per instance. */
  secret?: string;
  /** Storage options for ledger recording */
  storageOptions?: SafeloopStorageOptions;
}

export interface ApprovalToken {
  tokenId: string;
  fingerprint: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  action: string;
  target: string;
  argumentsHash: string;
  taskId: string;
  sessionId: string;
  tenantId: string;
  agentId: string;
  environment: string;
  reason: string;
  approver: string;
}

export type ApprovalValidationFailure =
  | 'expired'
  | 'consumed'
  | 'forged'
  | 'action_mismatch'
  | 'target_mismatch'
  | 'arguments_mismatch'
  | 'task_mismatch'
  | 'session_mismatch'
  | 'tenant_mismatch'
  | 'agent_mismatch'
  | 'environment_mismatch'
  | 'unknown_token';

export interface ApprovalValidationResult {
  valid: boolean;
  failure?: ApprovalValidationFailure;
  reason?: string;
  tokenId?: string;
  eventId?: string;
}

export interface ApprovalGate {
  /** Issue a new approval token for a specific action context */
  issue(request: ApprovalRequest, approver: string): ApprovalToken;
  /** Validate and consume an approval token for the given action context */
  redeem(token: ApprovalToken, context: ApprovalRedemptionContext): ApprovalValidationResult;
  /** Check if a token is valid without consuming it */
  validate(token: ApprovalToken, context: ApprovalRedemptionContext): ApprovalValidationResult;
  /** Revoke an existing token (mark as consumed without executing) */
  revoke(tokenId: string, reason: string): boolean;
  /** Get count of consumed tokens (for diagnostics) */
  consumedCount(): number;
}

export interface ApprovalRedemptionContext {
  action: string;
  target?: string;
  argumentsHash?: string;
  taskId?: string;
  sessionId?: string;
  tenantId?: string;
  agentId: string;
  environment?: string;
}

// --- Implementation ---

function generateTokenId(): string {
  return `approval-${Date.now()}-${randomBytes(8).toString('hex')}`;
}

function now(): string {
  return new Date().toISOString();
}

function generateEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Compute a canonical fingerprint for the approval context.
 * This binds the token to the exact action/target/task/tenant/agent/environment.
 */
function computeFingerprint(request: ApprovalRequest): string {
  const canonical = JSON.stringify({
    action: (request.action ?? '').toLowerCase().trim(),
    target: (request.target ?? '').toLowerCase().trim(),
    argumentsHash: (request.argumentsHash ?? '').trim(),
    taskId: (request.taskId ?? '').trim(),
    sessionId: (request.sessionId ?? '').trim(),
    tenantId: (request.tenantId ?? '').trim(),
    agentId: (request.agentId ?? '').trim(),
    environment: (request.environment ?? '').toLowerCase().trim(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compute a fingerprint from a redemption context for comparison.
 */
function computeContextFingerprint(context: ApprovalRedemptionContext): string {
  const canonical = JSON.stringify({
    action: (context.action ?? '').toLowerCase().trim(),
    target: (context.target ?? '').toLowerCase().trim(),
    argumentsHash: (context.argumentsHash ?? '').trim(),
    taskId: (context.taskId ?? '').trim(),
    sessionId: (context.sessionId ?? '').trim(),
    tenantId: (context.tenantId ?? '').trim(),
    agentId: (context.agentId ?? '').trim(),
    environment: (context.environment ?? '').toLowerCase().trim(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Sign a token with HMAC-SHA256 to prevent forgery.
 */
function signToken(tokenId: string, fingerprint: string, issuedAt: string, expiresAt: string, secret: string): string {
  const payload = `${tokenId}:${fingerprint}:${issuedAt}:${expiresAt}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify a token signature.
 */
function verifySignature(token: ApprovalToken, secret: string): boolean {
  const expected = signToken(token.tokenId, token.fingerprint, token.issuedAt, token.expiresAt, secret);
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== token.signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ token.signature.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Determine the specific mismatch between token and redemption context.
 */
function findMismatch(token: ApprovalToken, context: ApprovalRedemptionContext): ApprovalValidationFailure | null {
  const normalize = (v: string | undefined) => (v ?? '').toLowerCase().trim();

  if (normalize(token.action) !== normalize(context.action)) return 'action_mismatch';
  if (normalize(token.target) !== normalize(context.target)) return 'target_mismatch';
  if ((token.argumentsHash ?? '').trim() !== (context.argumentsHash ?? '').trim()) return 'arguments_mismatch';
  if ((token.taskId ?? '').trim() !== (context.taskId ?? '').trim()) return 'task_mismatch';
  if ((token.sessionId ?? '').trim() !== (context.sessionId ?? '').trim()) return 'session_mismatch';
  if ((token.tenantId ?? '').trim() !== (context.tenantId ?? '').trim()) return 'tenant_mismatch';
  if (normalize(token.agentId) !== normalize(context.agentId)) return 'agent_mismatch';
  if (normalize(token.environment) !== normalize(context.environment)) return 'environment_mismatch';
  return null;
}

export function createApprovalGate(config: ApprovalTokenConfig = {}): ApprovalGate {
  const ttlMs = config.ttlMs ?? 300_000; // 5 minutes default
  const secret = config.secret ?? randomBytes(32).toString('hex');
  const storageOptions = config.storageOptions ?? {};
  const consumedTokens = new Set<string>();

  function issue(request: ApprovalRequest, approver: string): ApprovalToken {
    const tokenId = generateTokenId();
    const fingerprint = computeFingerprint(request);
    const issuedAt = now();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const signature = signToken(tokenId, fingerprint, issuedAt, expiresAt, secret);

    const token: ApprovalToken = {
      tokenId,
      fingerprint,
      issuedAt,
      expiresAt,
      signature,
      action: (request.action ?? '').toLowerCase().trim(),
      target: (request.target ?? '').toLowerCase().trim(),
      argumentsHash: (request.argumentsHash ?? '').trim(),
      taskId: (request.taskId ?? '').trim(),
      sessionId: (request.sessionId ?? '').trim(),
      tenantId: (request.tenantId ?? '').trim(),
      agentId: (request.agentId ?? '').trim(),
      environment: (request.environment ?? '').toLowerCase().trim(),
      reason: request.reason,
      approver,
    };

    appendEvent({
      id: generateEventId('approval-issued'),
      type: 'approval.granted',
      agentId: request.agentId,
      agentName: request.agentName,
      caseId: request.taskId,
      sessionId: request.sessionId,
      summary: `Approval issued by ${approver} for: ${request.action}`,
      metadata: {
        tokenId,
        fingerprint,
        action: request.action,
        target: request.target,
        taskId: request.taskId,
        tenantId: request.tenantId,
        agentId: request.agentId,
        environment: request.environment,
        reason: request.reason,
        approver,
        expiresAt,
        riskScore: request.riskScore,
      },
    }, storageOptions);

    return token;
  }

  function validateInternal(token: ApprovalToken, context: ApprovalRedemptionContext): ApprovalValidationResult {
    // 1. Check if token has been consumed (single-use / replay detection)
    if (consumedTokens.has(token.tokenId)) {
      return { valid: false, failure: 'consumed', reason: 'Approval token has already been consumed.', tokenId: token.tokenId };
    }

    // 2. Verify signature (forgery resistance)
    if (!verifySignature(token, secret)) {
      return { valid: false, failure: 'forged', reason: 'Approval token signature is invalid.', tokenId: token.tokenId };
    }

    // 3. Check expiration
    if (Date.parse(token.expiresAt) < Date.now()) {
      return { valid: false, failure: 'expired', reason: `Approval token expired at ${token.expiresAt}.`, tokenId: token.tokenId };
    }

    // 4. Verify context fingerprint matches (action-bound, tenant-bound, etc.)
    const contextFingerprint = computeContextFingerprint(context);
    if (token.fingerprint !== contextFingerprint) {
      const mismatch = findMismatch(token, context);
      return {
        valid: false,
        failure: mismatch ?? 'action_mismatch',
        reason: `Approval token does not match redemption context: ${mismatch ?? 'fingerprint mismatch'}.`,
        tokenId: token.tokenId,
      };
    }

    return { valid: true, tokenId: token.tokenId };
  }

  function validate(token: ApprovalToken, context: ApprovalRedemptionContext): ApprovalValidationResult {
    return validateInternal(token, context);
  }

  function redeem(token: ApprovalToken, context: ApprovalRedemptionContext): ApprovalValidationResult {
    const result = validateInternal(token, context);

    if (result.valid) {
      // Consume the token (single-use)
      consumedTokens.add(token.tokenId);

      const eventId = generateEventId('approval-redeemed');
      appendEvent({
        id: eventId,
        type: 'approval.granted',
        agentId: context.agentId,
        caseId: context.taskId,
        sessionId: context.sessionId,
        summary: `Approval token redeemed: ${token.tokenId}`,
        metadata: {
          tokenId: token.tokenId,
          action: context.action,
          target: context.target,
          taskId: context.taskId,
          tenantId: context.tenantId,
          agentId: context.agentId,
          environment: context.environment,
          approver: token.approver,
          redeemed: true,
        },
      }, storageOptions);

      return { ...result, eventId };
    }

    // Record failed redemption attempt
    const eventId = generateEventId('approval-rejected');
    appendEvent({
      id: eventId,
      type: 'approval.denied',
      agentId: context.agentId,
      caseId: context.taskId,
      sessionId: context.sessionId,
      summary: `Approval token rejected: ${result.failure} — ${token.tokenId}`,
      metadata: {
        tokenId: token.tokenId,
        failure: result.failure,
        reason: result.reason,
        action: context.action,
        target: context.target,
        taskId: context.taskId,
        tenantId: context.tenantId,
        agentId: context.agentId,
        environment: context.environment,
      },
    }, storageOptions);

    return { ...result, eventId };
  }

  function revoke(tokenId: string, reason: string): boolean {
    if (consumedTokens.has(tokenId)) return false;
    consumedTokens.add(tokenId);

    appendEvent({
      id: generateEventId('approval-revoked'),
      type: 'approval.denied',
      agentId: 'system',
      summary: `Approval token revoked: ${tokenId} — ${reason}`,
      metadata: { tokenId, reason, revoked: true },
    }, storageOptions);

    return true;
  }

  function consumedCount(): number {
    return consumedTokens.size;
  }

  return { issue, redeem, validate, revoke, consumedCount };
}
