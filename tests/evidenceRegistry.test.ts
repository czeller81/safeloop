import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createLocalEvidenceRegistry, type EvidenceRecord } from '../src';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-evidence-registry-'));
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: 'evidence-1',
    type: 'artifact',
    source: 'local-test',
    timestamp: '2026-08-07T00:00:00.000Z',
    producingAgent: 'agent-1',
    confidence: 0.95,
    supportedClaim: 'The task completed.',
    provenance: {
      source: 'local-test',
      verificationStatus: 'OBSERVATION',
      confidence: 0.95,
    },
    verificationStatus: 'OBSERVATION',
    ...overrides,
  };
}

describe('local evidence registry', () => {
  test('registers evidence with stable id, hash, provenance, and status', () => {
    const registry = createLocalEvidenceRegistry({ baseDir: makeTempDir() });

    const record = registry.register({
      evidenceId: 'evidence-1',
      content: 'artifact content',
      provenance: evidence(),
    });

    expect(record.evidenceId).toBe('evidence-1');
    expect(record.artifactHash).toHaveLength(64);
    expect(record.verificationStatus).toBe('OBSERVATION');
    expect(record.provenance.supportedClaim).toBe('The task completed.');
    expect(registry.get('evidence-1')?.artifactHash).toBe(record.artifactHash);
  });

  test('re-verifies matching evidence content', () => {
    const registry = createLocalEvidenceRegistry({ baseDir: makeTempDir() });
    registry.register({ evidenceId: 'evidence-1', content: 'artifact content', provenance: evidence() });

    const result = registry.verify('evidence-1', 'artifact content');
    expect(result.valid).toBe(true);
  });

  test('detects evidence replacement or tampering', () => {
    const registry = createLocalEvidenceRegistry({ baseDir: makeTempDir() });
    registry.register({ evidenceId: 'evidence-1', content: 'artifact content', provenance: evidence() });

    const result = registry.verify('evidence-1', 'modified artifact content');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('does not match');
  });
});
