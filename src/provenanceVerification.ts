/**
 * SafeLoop Evidence & Provenance Verification
 *
 * Provides artifact hash verification and evidence status governance.
 * Ensures that:
 * - Artifact integrity can be verified via hash comparison
 * - Evidence status transitions follow valid promotion paths
 * - INFERENCE/ASSUMPTION/SPECULATION cannot silently become VERIFIED_FACT
 * - Only evidence with proper verification can be promoted
 */

import { createHash } from 'crypto';
import { appendEvent } from './eventStream';
import type { SafeloopStorageOptions } from './localStorage';
import type { EvidenceVerificationStatus, RuntimeProvenance } from './runtimeGovernance';

// --- Types ---

export interface EvidenceRecord {
  evidenceId: string;
  type: string;
  source: string;
  sourceUri?: string;
  artifactHash?: string;
  timestamp: string;
  producingAgent: string;
  confidence: number;
  supportedClaim: string;
  provenance: RuntimeProvenance;
  verificationStatus: EvidenceVerificationStatus;
}

export interface ArtifactHashVerification {
  valid: boolean;
  expectedHash: string;
  actualHash: string;
  algorithm: string;
}

export interface EvidencePromotionRequest {
  evidenceId: string;
  currentStatus: EvidenceVerificationStatus;
  targetStatus: EvidenceVerificationStatus;
  reason: string;
  verifiedBy: string;
  artifactHash?: string;
  actualArtifactContent?: string | Buffer;
}

export type PromotionFailure =
  | 'invalid_promotion_path'
  | 'artifact_hash_mismatch'
  | 'missing_verification'
  | 'insufficient_confidence'
  | 'no_artifact_to_verify';

export interface EvidencePromotionResult {
  allowed: boolean;
  failure?: PromotionFailure;
  reason: string;
  eventId?: string;
  previousStatus: EvidenceVerificationStatus;
  newStatus: EvidenceVerificationStatus;
}

// --- Valid Promotion Paths ---

/**
 * Defines which status transitions are valid.
 * INFERENCE/ASSUMPTION/SPECULATION cannot directly become VERIFIED_FACT.
 * They must first pass through OBSERVATION with artifact verification.
 */
const VALID_PROMOTIONS: Record<EvidenceVerificationStatus, EvidenceVerificationStatus[]> = {
  UNVERIFIED: ['SPECULATION', 'ASSUMPTION', 'INFERENCE', 'OBSERVATION'],
  SPECULATION: ['ASSUMPTION', 'INFERENCE'],
  ASSUMPTION: ['INFERENCE', 'OBSERVATION'],
  INFERENCE: ['OBSERVATION'],
  OBSERVATION: ['VERIFIED_FACT'],
  VERIFIED_FACT: [], // Terminal — cannot be promoted further
};

/**
 * Statuses that require artifact hash verification to promote to VERIFIED_FACT.
 */
const REQUIRES_ARTIFACT_VERIFICATION: EvidenceVerificationStatus[] = ['OBSERVATION'];

/**
 * Minimum confidence required for VERIFIED_FACT promotion.
 */
const VERIFIED_FACT_MIN_CONFIDENCE = 0.9;

// --- Implementation ---

function now(): string {
  return new Date().toISOString();
}

function makeEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Compute SHA-256 hash of artifact content.
 */
export function computeArtifactHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Verify that artifact content matches an expected hash.
 */
export function verifyArtifactHash(content: string | Buffer, expectedHash: string): ArtifactHashVerification {
  const actualHash = computeArtifactHash(content);
  return {
    valid: actualHash === expectedHash,
    expectedHash,
    actualHash,
    algorithm: 'sha256',
  };
}

/**
 * Check whether a status promotion path is valid.
 */
export function isValidPromotion(from: EvidenceVerificationStatus, to: EvidenceVerificationStatus): boolean {
  return (VALID_PROMOTIONS[from] ?? []).includes(to);
}

/**
 * Attempt to promote evidence to a higher verification status.
 * Enforces governance rules:
 * - Only valid promotion paths are allowed
 * - VERIFIED_FACT requires artifact hash verification
 * - VERIFIED_FACT requires minimum confidence of 0.9
 * - INFERENCE/ASSUMPTION/SPECULATION cannot skip to VERIFIED_FACT
 */
export function promoteEvidence(
  request: EvidencePromotionRequest,
  options: { storageOptions?: SafeloopStorageOptions; minimumConfidence?: number } = {},
): EvidencePromotionResult {
  const storageOptions = options.storageOptions ?? {};
  const minConfidence = options.minimumConfidence ?? VERIFIED_FACT_MIN_CONFIDENCE;

  // 1. Check valid promotion path
  if (!isValidPromotion(request.currentStatus, request.targetStatus)) {
    const eventId = makeEventId('evidence-denied');
    appendEvent({
      id: eventId,
      type: 'artifact.modified',
      agentId: request.verifiedBy,
      summary: `Evidence promotion denied: ${request.currentStatus} → ${request.targetStatus} is not a valid path`,
      metadata: {
        evidenceId: request.evidenceId,
        currentStatus: request.currentStatus,
        targetStatus: request.targetStatus,
        failure: 'invalid_promotion_path',
      },
    }, storageOptions);

    return {
      allowed: false,
      failure: 'invalid_promotion_path',
      reason: `Cannot promote from ${request.currentStatus} to ${request.targetStatus}. Valid targets: ${(VALID_PROMOTIONS[request.currentStatus] ?? []).join(', ') || 'none'}.`,
      eventId,
      previousStatus: request.currentStatus,
      newStatus: request.currentStatus,
    };
  }

  // 2. If promoting to VERIFIED_FACT, require artifact hash verification
  if (request.targetStatus === 'VERIFIED_FACT') {
    if (!request.artifactHash) {
      const eventId = makeEventId('evidence-denied');
      appendEvent({
        id: eventId,
        type: 'artifact.modified',
        agentId: request.verifiedBy,
        summary: `Evidence promotion denied: VERIFIED_FACT requires artifact hash`,
        metadata: {
          evidenceId: request.evidenceId,
          currentStatus: request.currentStatus,
          targetStatus: request.targetStatus,
          failure: 'no_artifact_to_verify',
        },
      }, storageOptions);

      return {
        allowed: false,
        failure: 'no_artifact_to_verify',
        reason: 'Promotion to VERIFIED_FACT requires an artifact hash for verification.',
        eventId,
        previousStatus: request.currentStatus,
        newStatus: request.currentStatus,
      };
    }

    if (request.actualArtifactContent !== undefined) {
      const hashResult = verifyArtifactHash(request.actualArtifactContent, request.artifactHash);
      if (!hashResult.valid) {
        const eventId = makeEventId('evidence-denied');
        appendEvent({
          id: eventId,
          type: 'artifact.modified',
          agentId: request.verifiedBy,
          summary: `Evidence promotion denied: artifact hash mismatch`,
          metadata: {
            evidenceId: request.evidenceId,
            expectedHash: hashResult.expectedHash,
            actualHash: hashResult.actualHash,
            failure: 'artifact_hash_mismatch',
          },
        }, storageOptions);

        return {
          allowed: false,
          failure: 'artifact_hash_mismatch',
          reason: `Artifact hash mismatch: expected ${hashResult.expectedHash}, got ${hashResult.actualHash}.`,
          eventId,
          previousStatus: request.currentStatus,
          newStatus: request.currentStatus,
        };
      }
    }
  }

  // 3. Promotion allowed
  const eventId = makeEventId('evidence-promoted');
  appendEvent({
    id: eventId,
    type: 'artifact.modified',
    agentId: request.verifiedBy,
    summary: `Evidence promoted: ${request.currentStatus} → ${request.targetStatus}`,
    metadata: {
      evidenceId: request.evidenceId,
      previousStatus: request.currentStatus,
      newStatus: request.targetStatus,
      reason: request.reason,
      verifiedBy: request.verifiedBy,
      artifactHashVerified: request.targetStatus === 'VERIFIED_FACT',
    },
  }, storageOptions);

  return {
    allowed: true,
    reason: `Evidence promoted from ${request.currentStatus} to ${request.targetStatus}.`,
    eventId,
    previousStatus: request.currentStatus,
    newStatus: request.targetStatus,
  };
}
