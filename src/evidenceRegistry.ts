import { randomBytes } from 'crypto';
import { resolveSafeloopPath, readJsonFile, writeJsonFile } from './localStorage';
import { computeArtifactHash, verifyArtifactHash, type EvidenceRecord } from './provenanceVerification';
import type { EvidenceVerificationStatus } from './runtimeGovernance';
import type { SafeloopStorageOptions } from './localStorage';

export interface EvidenceRegistryRecord {
  evidenceId: string;
  artifactHash: string;
  provenance: EvidenceRecord;
  verificationStatus: EvidenceVerificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRegistryVerification {
  evidenceId: string;
  valid: boolean;
  expectedHash?: string;
  actualHash?: string;
  reason?: string;
}

export interface EvidenceRegistry {
  register(input: {
    content: string | Buffer;
    provenance: EvidenceRecord;
    verificationStatus?: EvidenceVerificationStatus;
    evidenceId?: string;
  }): EvidenceRegistryRecord;
  get(evidenceId: string): EvidenceRegistryRecord | null;
  list(): EvidenceRegistryRecord[];
  verify(evidenceId: string, content: string | Buffer): EvidenceRegistryVerification;
}

interface EvidenceRegistryFile {
  version: 1;
  records: EvidenceRegistryRecord[];
}

function now(): string {
  return new Date().toISOString();
}

function makeEvidenceId(): string {
  return `evidence-${Date.now()}-${randomBytes(6).toString('hex')}`;
}

export function createLocalEvidenceRegistry(options: SafeloopStorageOptions = {}): EvidenceRegistry {
  const filePath = resolveSafeloopPath('evidence-registry.json', options);

  function readState(): EvidenceRegistryFile {
    const parsed = readJsonFile<EvidenceRegistryFile>(filePath, { version: 1, records: [] });
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  }

  function writeState(state: EvidenceRegistryFile): void {
    writeJsonFile(filePath, state);
  }

  return {
    register(input): EvidenceRegistryRecord {
      const state = readState();
      const existingIndex = input.evidenceId
        ? state.records.findIndex((record) => record.evidenceId === input.evidenceId)
        : -1;
      const timestamp = now();
      const record: EvidenceRegistryRecord = {
        evidenceId: input.evidenceId ?? makeEvidenceId(),
        artifactHash: computeArtifactHash(input.content),
        provenance: { ...input.provenance },
        verificationStatus: input.verificationStatus ?? input.provenance.verificationStatus,
        createdAt: existingIndex >= 0 ? state.records[existingIndex].createdAt : timestamp,
        updatedAt: timestamp,
      };
      if (existingIndex >= 0) {
        state.records[existingIndex] = record;
      } else {
        state.records.push(record);
      }
      writeState(state);
      return { ...record, provenance: { ...record.provenance } };
    },
    get(evidenceId): EvidenceRegistryRecord | null {
      const found = readState().records.find((record) => record.evidenceId === evidenceId);
      return found ? { ...found, provenance: { ...found.provenance } } : null;
    },
    list(): EvidenceRegistryRecord[] {
      return readState().records.map((record) => ({ ...record, provenance: { ...record.provenance } }));
    },
    verify(evidenceId, content): EvidenceRegistryVerification {
      const record = this.get(evidenceId);
      if (!record) {
        return { evidenceId, valid: false, reason: 'evidence not found' };
      }
      const result = verifyArtifactHash(content, record.artifactHash);
      return {
        evidenceId,
        valid: result.valid,
        expectedHash: result.expectedHash,
        actualHash: result.actualHash,
        reason: result.valid ? undefined : 'artifact content does not match registered evidence hash',
      };
    },
  };
}
