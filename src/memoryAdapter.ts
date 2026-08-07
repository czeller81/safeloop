import { verifyCandidateMemory, type CandidateMemory, type MemoryGovernanceDecision, type RuntimeScenarioContract } from './runtimeGovernance';
import type { SafeloopStorageOptions } from './localStorage';

export interface MemoryPersistenceAdapter {
  persist(memory: CandidateMemory, decision: MemoryGovernanceDecision): void;
  quarantine?(memory: CandidateMemory, decision: MemoryGovernanceDecision): void;
  requireReview?(memory: CandidateMemory, decision: MemoryGovernanceDecision): void;
  list(): CandidateMemory[];
  listQuarantine?(): CandidateMemory[];
  listReviewQueue?(): CandidateMemory[];
}

export interface GovernedMemoryAdapter {
  write(memory: CandidateMemory, options?: {
    scenario?: RuntimeScenarioContract;
    minimumConfidence?: number;
  }): MemoryGovernanceDecision;
  list(): CandidateMemory[];
  listActive(): CandidateMemory[];
  listQuarantine(): CandidateMemory[];
  listReviewQueue(): CandidateMemory[];
}

export function createInMemoryPersistenceAdapter(): MemoryPersistenceAdapter {
  const records: CandidateMemory[] = [];
  const quarantineRecords: CandidateMemory[] = [];
  const reviewRecords: CandidateMemory[] = [];
  function clone(memory: CandidateMemory): CandidateMemory {
    return { ...memory, evidence: memory.evidence ? [...memory.evidence] : undefined, reuse_conditions: memory.reuse_conditions ? [...memory.reuse_conditions] : undefined };
  }
  function isActive(memory: CandidateMemory): boolean {
    return !memory.ttl || Date.parse(memory.ttl) > Date.now();
  }
  return {
    persist(memory: CandidateMemory): void {
      const existingIndex = records.findIndex((record) => record.memory_id === memory.memory_id);
      if (existingIndex >= 0) {
        records[existingIndex] = { ...records[existingIndex], ...clone(memory) };
        return;
      }
      records.push(clone(memory));
    },
    quarantine(memory: CandidateMemory): void {
      quarantineRecords.push(clone(memory));
    },
    requireReview(memory: CandidateMemory): void {
      reviewRecords.push(clone(memory));
    },
    list(): CandidateMemory[] {
      return records.filter(isActive).map(clone);
    },
    listQuarantine(): CandidateMemory[] {
      return quarantineRecords.map(clone);
    },
    listReviewQueue(): CandidateMemory[] {
      return reviewRecords.map(clone);
    },
  };
}

export function createGovernedMemoryAdapter(
  persistence: MemoryPersistenceAdapter,
  storageOptions: SafeloopStorageOptions = {},
): GovernedMemoryAdapter {
  return {
    write(memory, options = {}): MemoryGovernanceDecision {
      const decision = verifyCandidateMemory(memory, {
        scenario: options.scenario,
        minimumConfidence: options.minimumConfidence,
        storageOptions,
      });
      if (decision.allowed && persistence.list().some((record) => record.memory_id === memory.memory_id)) {
        decision.decision = 'MERGE';
        decision.reasons = ['Candidate memory merged with existing active memory.'];
        persistence.persist(memory, decision);
      } else if (decision.allowed) {
        persistence.persist(memory, decision);
      } else if (decision.decision === 'QUARANTINE') {
        persistence.quarantine?.(memory, decision);
      } else if (decision.decision === 'REQUIRE_REVIEW') {
        persistence.requireReview?.(memory, decision);
      }
      return decision;
    },
    list(): CandidateMemory[] {
      return persistence.list();
    },
    listActive(): CandidateMemory[] {
      return persistence.list();
    },
    listQuarantine(): CandidateMemory[] {
      return persistence.listQuarantine?.() ?? [];
    },
    listReviewQueue(): CandidateMemory[] {
      return persistence.listReviewQueue?.() ?? [];
    },
  };
}
