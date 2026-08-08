/**
 * Memory governance gateway with candidate binding.
 *
 * v0.1 governed memory correctly but did not bind the decision to the bytes it
 * governed. An adapter could submit safe candidate A, receive ALLOW, and then
 * persist materially different candidate B — the memory equivalent of TOCTOU,
 * and the exact shape of a poisoning attack that survives review.
 *
 * The fix mirrors execution permits:
 *
 *     MemoryCandidate → MemoryCandidateFingerprint → governance decision
 *       → MemoryPersistencePermit bound to that fingerprint
 *       → durable activation only for the exact governed candidate
 *
 * The deterministic checks from `verifyCandidateMemory` are reused verbatim,
 * including the governance-bypass detection added in 527785c. This module adds
 * binding; it does not re-implement memory policy.
 */

import { createHash, createHmac, randomBytes } from 'crypto';
import { canonicalStringify } from './canonicalAction';
import { createAtomicClaimStore, type AtomicClaimStore } from './atomicStateStore';
import { loadRuntimeSecret, signaturesMatch } from './runtimeSecret';
import { verifyCandidateMemory, type CandidateMemory, type RuntimeScenarioContract } from '../runtimeGovernance';
import {
  PROTOCOL_VERSION,
  type MemoryCandidate,
  type MemoryCandidateFingerprint,
  type MemoryDecision,
  type MemoryDecisionCode,
  type MemoryPersistencePermit,
} from './protocol';
import type { SafeloopStorageOptions } from '../localStorage';

export const DEFAULT_MEMORY_PERMIT_TTL_MS = 120_000;

/**
 * The candidate fields that are bound. Everything an agent could change to
 * alter what the memory *means* is covered; volatile correlation fields
 * (trace_id, created_at) are not, for the same reason trace_id is excluded from
 * action fingerprints.
 */
export function memoryBindingSet(candidate: MemoryCandidate): Record<string, unknown> {
  return {
    memory_id: candidate.memory_id ?? '',
    memory_type: candidate.memory_type ?? '',
    situation: candidate.situation ?? '',
    action: candidate.action ?? '',
    outcome: candidate.outcome ?? '',
    lesson: candidate.lesson ?? '',
    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : null,
    evidence: [...(candidate.evidence ?? [])].sort(),
    provenance: candidate.provenance ?? '',
    reuse_conditions: [...(candidate.reuse_conditions ?? [])].sort(),
    do_not_generalize: candidate.do_not_generalize === true,
    tenant_id: candidate.tenant_id ?? '',
    agent_id: candidate.agent_id ?? '',
    task_id: candidate.task_id ?? '',
    session_id: candidate.session_id ?? '',
    source_artifacts: [...(candidate.source_artifacts ?? [])].sort(),
    requested_ttl: candidate.requested_ttl ?? '',
    contradicts: [...(candidate.contradicts ?? [])].sort(),
    supersedes: [...(candidate.supersedes ?? [])].sort(),
    contains_sensitive_data: candidate.contains_sensitive_data === true,
  };
}

export function fingerprintMemoryCandidate(candidate: MemoryCandidate): MemoryCandidateFingerprint {
  const canonical_form = canonicalStringify(memoryBindingSet(candidate));
  return {
    protocol_version: PROTOCOL_VERSION,
    fingerprint: createHash('sha256').update(canonical_form, 'utf8').digest('hex'),
    algorithm: 'sha256',
    canonical_form,
  };
}

function permitClaims(permit: Omit<MemoryPersistencePermit, 'signature'>): string {
  return canonicalStringify({
    protocol_version: permit.protocol_version,
    permit_id: permit.permit_id,
    memory_decision_id: permit.memory_decision_id,
    candidate_fingerprint: permit.candidate_fingerprint,
    memory_id: permit.memory_id,
    agent_id: permit.agent_id,
    task_id: permit.task_id,
    tenant_id: permit.tenant_id,
    decision: permit.decision,
    ttl: permit.ttl ?? '',
    issued_at: permit.issued_at,
    expires_at: permit.expires_at,
    nonce: permit.nonce,
  });
}

export function signMemoryPermit(permit: Omit<MemoryPersistencePermit, 'signature'>, secret: string): string {
  return createHmac('sha256', secret).update(permitClaims(permit), 'utf8').digest('hex');
}

/** Translate the protocol candidate into the shape the v0.1 checks expect. */
function toLegacyCandidate(candidate: MemoryCandidate): CandidateMemory {
  return {
    memory_id: candidate.memory_id,
    memory_type: candidate.memory_type,
    source_task: candidate.task_id,
    agent: candidate.agent_id,
    situation: candidate.situation ?? '',
    action: candidate.action,
    outcome: candidate.outcome,
    lesson: candidate.lesson ?? '',
    confidence: candidate.confidence,
    evidence: candidate.evidence,
    reuse_conditions: candidate.reuse_conditions,
    do_not_generalize: candidate.do_not_generalize,
    tenant: candidate.tenant_id,
    ttl: candidate.requested_ttl,
    created_at: candidate.created_at,
    containsSensitiveData: candidate.contains_sensitive_data,
  };
}

export type MemoryPersistenceFailure =
  | 'forged'
  | 'expired'
  | 'consumed'
  | 'candidate_mismatch'
  | 'tenant_mismatch'
  | 'agent_mismatch'
  | 'task_mismatch'
  | 'not_authorized'
  | 'missing_permit'
  | 'state_corrupted';

export interface MemoryPersistenceAuthorization {
  authorized: boolean;
  failure?: MemoryPersistenceFailure;
  reason?: string;
  decision?: MemoryDecisionCode;
  ttl?: string;
}

export interface MemoryGatewayConfig {
  storageOptions?: SafeloopStorageOptions;
  secret?: string;
  scenario?: RuntimeScenarioContract;
  minimumConfidence?: number;
  permitTtlMs?: number;
  store?: AtomicClaimStore;
}

export interface MemoryGateway {
  fingerprint(candidate: MemoryCandidate): MemoryCandidateFingerprint;
  /** Govern a candidate. Issues a persistence permit only when activation is authorized. */
  propose(candidate: MemoryCandidate, options?: { scenario?: RuntimeScenarioContract; minimumConfidence?: number }): MemoryDecision;
  /**
   * Verify that this exact candidate may be durably activated under this permit,
   * and atomically consume the permit.
   */
  authorizePersistence(permit: MemoryPersistencePermit | undefined, candidate: MemoryCandidate): MemoryPersistenceAuthorization;
}

/** Decisions that permit durable activation. Everything else stays inactive. */
const ACTIVATING_DECISIONS: ReadonlySet<MemoryDecisionCode> = new Set<MemoryDecisionCode>(['ALLOW', 'ALLOW_WITH_TTL', 'MERGE']);

export function createMemoryGateway(config: MemoryGatewayConfig = {}): MemoryGateway {
  const storageOptions = config.storageOptions ?? {};
  const secret = config.secret ?? loadRuntimeSecret(storageOptions);
  const store = config.store ?? createAtomicClaimStore('memory-permits', storageOptions);
  const permitTtlMs = config.permitTtlMs ?? DEFAULT_MEMORY_PERMIT_TTL_MS;

  return {
    fingerprint(candidate) {
      return fingerprintMemoryCandidate(candidate);
    },

    propose(candidate, options = {}): MemoryDecision {
      const fingerprint = fingerprintMemoryCandidate(candidate);

      // Reuse the existing deterministic checks verbatim, including the
      // governance-bypass detection hardened in 527785c.
      const legacy = verifyCandidateMemory(toLegacyCandidate(candidate), {
        scenario: options.scenario ?? config.scenario,
        minimumConfidence: options.minimumConfidence ?? config.minimumConfidence,
        storageOptions,
      });

      const decisionId = `memory-decision-${Date.now()}-${randomBytes(8).toString('hex')}`;
      const decisionCode = legacy.decision as MemoryDecisionCode;
      const decision: MemoryDecision = {
        protocol_version: PROTOCOL_VERSION,
        memory_decision_id: decisionId,
        decision: decisionCode,
        allowed: legacy.allowed,
        candidate_fingerprint: fingerprint.fingerprint,
        reasons: legacy.reasons,
        recommended_remediation: legacy.recommendedRemediation,
        decided_at: new Date().toISOString(),
      };

      if (!ACTIVATING_DECISIONS.has(decisionCode)) return decision;

      const issuedAt = Date.now();
      const ttl = decisionCode === 'ALLOW_WITH_TTL'
        ? candidate.requested_ttl ?? new Date(issuedAt + 7 * 24 * 60 * 60 * 1000).toISOString()
        : candidate.requested_ttl;

      const unsigned: Omit<MemoryPersistencePermit, 'signature'> = {
        protocol_version: PROTOCOL_VERSION,
        permit_id: `memory-permit-${issuedAt}-${randomBytes(8).toString('hex')}`,
        memory_decision_id: decisionId,
        candidate_fingerprint: fingerprint.fingerprint,
        memory_id: candidate.memory_id,
        agent_id: candidate.agent_id ?? '',
        task_id: candidate.task_id ?? '',
        tenant_id: candidate.tenant_id ?? '',
        decision: decisionCode,
        ttl,
        issued_at: new Date(issuedAt).toISOString(),
        expires_at: new Date(issuedAt + permitTtlMs).toISOString(),
        nonce: randomBytes(16).toString('hex'),
      };

      decision.persistence_permit = { ...unsigned, signature: signMemoryPermit(unsigned, secret) };
      return decision;
    },

    authorizePersistence(permit, candidate): MemoryPersistenceAuthorization {
      if (!permit || typeof permit !== 'object') {
        return { authorized: false, failure: 'missing_permit', reason: 'no memory persistence permit was supplied' };
      }
      if (permit.protocol_version !== PROTOCOL_VERSION) {
        return { authorized: false, failure: 'forged', reason: `unsupported protocol version: ${permit.protocol_version}` };
      }

      const { signature, ...unsigned } = permit;
      if (!signaturesMatch(signMemoryPermit(unsigned, secret), signature)) {
        return { authorized: false, failure: 'forged', reason: 'memory permit signature does not verify' };
      }

      if (!ACTIVATING_DECISIONS.has(permit.decision)) {
        return {
          authorized: false,
          failure: 'not_authorized',
          reason: `decision ${permit.decision} does not authorize durable activation`,
        };
      }

      if (!permit.expires_at || Date.parse(permit.expires_at) < Date.now()) {
        return { authorized: false, failure: 'expired', reason: `memory permit expired at ${permit.expires_at}` };
      }

      if ((candidate.tenant_id ?? '') !== permit.tenant_id) {
        return { authorized: false, failure: 'tenant_mismatch', reason: 'candidate belongs to a different tenant than the permit' };
      }
      if ((candidate.agent_id ?? '') !== permit.agent_id) {
        return { authorized: false, failure: 'agent_mismatch', reason: 'candidate belongs to a different agent than the permit' };
      }
      if ((candidate.task_id ?? '') !== permit.task_id) {
        return { authorized: false, failure: 'task_mismatch', reason: 'candidate belongs to a different task than the permit' };
      }

      // The binding check: recompute the fingerprint from the candidate being
      // persisted right now, not from whatever was governed earlier.
      const actual = fingerprintMemoryCandidate(candidate).fingerprint;
      if (actual !== permit.candidate_fingerprint) {
        return {
          authorized: false,
          failure: 'candidate_mismatch',
          reason: 'the candidate being persisted is not the candidate that was governed',
        };
      }

      const claim = store.claim(permit.permit_id, { expires_at: permit.expires_at });
      if (!claim.granted) {
        if (claim.conflict === 'io_error') {
          return { authorized: false, failure: 'state_corrupted', reason: claim.reason };
        }
        return { authorized: false, failure: 'consumed', reason: 'memory permit has already been used' };
      }

      return { authorized: true, decision: permit.decision, ttl: permit.ttl };
    },
  };
}
