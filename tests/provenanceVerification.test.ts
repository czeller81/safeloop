import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeArtifactHash,
  verifyArtifactHash,
  isValidPromotion,
  promoteEvidence,
} from '../src';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-provenance-'));
}

describe('provenance verification', () => {
  describe('artifact hash verification', () => {
    test('computes consistent SHA-256 hash for content', () => {
      const content = 'test artifact content';
      const hash1 = computeArtifactHash(content);
      const hash2 = computeArtifactHash(content);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    test('different content produces different hash', () => {
      const hash1 = computeArtifactHash('content A');
      const hash2 = computeArtifactHash('content B');
      expect(hash1).not.toBe(hash2);
    });

    test('verifyArtifactHash succeeds when content matches', () => {
      const content = 'verified artifact';
      const hash = computeArtifactHash(content);
      const result = verifyArtifactHash(content, hash);
      expect(result.valid).toBe(true);
      expect(result.expectedHash).toBe(hash);
      expect(result.actualHash).toBe(hash);
      expect(result.algorithm).toBe('sha256');
    });

    test('verifyArtifactHash fails when content is tampered', () => {
      const original = 'original content';
      const hash = computeArtifactHash(original);
      const result = verifyArtifactHash('tampered content', hash);
      expect(result.valid).toBe(false);
      expect(result.expectedHash).toBe(hash);
      expect(result.actualHash).not.toBe(hash);
    });

    test('works with Buffer content', () => {
      const content = Buffer.from('binary artifact data');
      const hash = computeArtifactHash(content);
      const result = verifyArtifactHash(content, hash);
      expect(result.valid).toBe(true);
    });
  });

  describe('evidence status promotion governance', () => {
    test('INFERENCE cannot directly become VERIFIED_FACT', () => {
      expect(isValidPromotion('INFERENCE', 'VERIFIED_FACT')).toBe(false);
    });

    test('ASSUMPTION cannot directly become VERIFIED_FACT', () => {
      expect(isValidPromotion('ASSUMPTION', 'VERIFIED_FACT')).toBe(false);
    });

    test('SPECULATION cannot directly become VERIFIED_FACT', () => {
      expect(isValidPromotion('SPECULATION', 'VERIFIED_FACT')).toBe(false);
    });

    test('UNVERIFIED cannot directly become VERIFIED_FACT', () => {
      expect(isValidPromotion('UNVERIFIED', 'VERIFIED_FACT')).toBe(false);
    });

    test('only OBSERVATION can become VERIFIED_FACT', () => {
      expect(isValidPromotion('OBSERVATION', 'VERIFIED_FACT')).toBe(true);
    });

    test('INFERENCE can become OBSERVATION (valid step)', () => {
      expect(isValidPromotion('INFERENCE', 'OBSERVATION')).toBe(true);
    });

    test('UNVERIFIED can become OBSERVATION', () => {
      expect(isValidPromotion('UNVERIFIED', 'OBSERVATION')).toBe(true);
    });

    test('VERIFIED_FACT cannot be promoted further', () => {
      expect(isValidPromotion('VERIFIED_FACT', 'OBSERVATION')).toBe(false);
      expect(isValidPromotion('VERIFIED_FACT', 'VERIFIED_FACT')).toBe(false);
    });
  });

  describe('promoteEvidence governance', () => {
    test('blocks INFERENCE from becoming VERIFIED_FACT', () => {
      const baseDir = makeTempDir();
      const result = promoteEvidence({
        evidenceId: 'ev-1',
        currentStatus: 'INFERENCE',
        targetStatus: 'VERIFIED_FACT',
        reason: 'I believe this is true',
        verifiedBy: 'agent-1',
      }, { storageOptions: { baseDir } });

      expect(result.allowed).toBe(false);
      expect(result.failure).toBe('invalid_promotion_path');
      expect(result.newStatus).toBe('INFERENCE'); // unchanged
    });

    test('blocks ASSUMPTION from becoming VERIFIED_FACT', () => {
      const baseDir = makeTempDir();
      const result = promoteEvidence({
        evidenceId: 'ev-2',
        currentStatus: 'ASSUMPTION',
        targetStatus: 'VERIFIED_FACT',
        reason: 'Seems correct',
        verifiedBy: 'agent-1',
      }, { storageOptions: { baseDir } });

      expect(result.allowed).toBe(false);
      expect(result.failure).toBe('invalid_promotion_path');
    });

    test('allows OBSERVATION to become VERIFIED_FACT with valid artifact hash', () => {
      const baseDir = makeTempDir();
      const content = 'verified artifact content';
      const hash = computeArtifactHash(content);

      const result = promoteEvidence({
        evidenceId: 'ev-3',
        currentStatus: 'OBSERVATION',
        targetStatus: 'VERIFIED_FACT',
        reason: 'Artifact hash verified against source',
        verifiedBy: 'human-reviewer',
        artifactHash: hash,
        actualArtifactContent: content,
      }, { storageOptions: { baseDir } });

      expect(result.allowed).toBe(true);
      expect(result.newStatus).toBe('VERIFIED_FACT');
      expect(result.eventId).toBeDefined();
    });

    test('blocks VERIFIED_FACT promotion when artifact hash mismatches', () => {
      const baseDir = makeTempDir();
      const result = promoteEvidence({
        evidenceId: 'ev-4',
        currentStatus: 'OBSERVATION',
        targetStatus: 'VERIFIED_FACT',
        reason: 'Attempting promotion',
        verifiedBy: 'agent-1',
        artifactHash: 'expected-hash-abc123',
        actualArtifactContent: 'different content that wont match',
      }, { storageOptions: { baseDir } });

      expect(result.allowed).toBe(false);
      expect(result.failure).toBe('artifact_hash_mismatch');
      expect(result.newStatus).toBe('OBSERVATION'); // unchanged
    });

    test('blocks VERIFIED_FACT promotion when no artifact hash provided', () => {
      const baseDir = makeTempDir();
      const result = promoteEvidence({
        evidenceId: 'ev-5',
        currentStatus: 'OBSERVATION',
        targetStatus: 'VERIFIED_FACT',
        reason: 'No hash available',
        verifiedBy: 'agent-1',
        // No artifactHash provided
      }, { storageOptions: { baseDir } });

      expect(result.allowed).toBe(false);
      expect(result.failure).toBe('no_artifact_to_verify');
    });

    test('allows INFERENCE to become OBSERVATION (valid step)', () => {
      const baseDir = makeTempDir();
      const result = promoteEvidence({
        evidenceId: 'ev-6',
        currentStatus: 'INFERENCE',
        targetStatus: 'OBSERVATION',
        reason: 'Direct observation confirms inference',
        verifiedBy: 'human-reviewer',
      }, { storageOptions: { baseDir } });

      expect(result.allowed).toBe(true);
      expect(result.newStatus).toBe('OBSERVATION');
    });
  });
});
