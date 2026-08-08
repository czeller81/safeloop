/**
 * Reference governed memory store.
 *
 * This exists to *prove* the binding architecture end to end — candidate →
 * governance → bound persistence → retrieval — and to give conformance runs a
 * store that works when a host agent's native memory is unavailable.
 *
 * It is not the preferred memory engine and is not marketed as one. SafeLoop
 * governs memory; it does not need to replace specialized memory systems. A
 * production deployment should keep its own store and call
 * `authorizePersistence()` before activating anything.
 *
 * The invariant this store enforces: nothing becomes ACTIVE without a valid,
 * unspent persistence permit whose fingerprint matches the candidate being
 * written at that moment.
 */

import { randomBytes } from 'crypto';
import { readJsonFile, resolveSafeloopPath, writeJsonFile } from '../localStorage';
import type { SafeloopStorageOptions } from '../localStorage';
import {
  PROTOCOL_VERSION,
  type MemoryCandidate,
  type MemoryDecision,
  type MemoryPersistencePermit,
  type MemoryProvenanceRecord,
} from './protocol';
import { fingerprintMemoryCandidate, type MemoryGateway, type MemoryPersistenceFailure } from './memoryGateway';

export type MemoryStatus = MemoryProvenanceRecord['status'];

export interface StoredMemory {
  candidate: MemoryCandidate;
  provenance: MemoryProvenanceRecord;
}

interface MemoryFile {
  version: 1;
  records: StoredMemory[];
}

export interface MemoryWriteResult {
  activated: boolean;
  status: MemoryStatus;
  memory_id: string;
  failure?: MemoryPersistenceFailure;
  reason?: string;
  provenance?: MemoryProvenanceRecord;
}

export interface GovernedMemoryStore {
  /** Persist a governed candidate. Requires a matching, unspent permit. */
  persist(candidate: MemoryCandidate, decision: MemoryDecision, permit?: MemoryPersistencePermit): MemoryWriteResult;
  /** Govern and persist in one call — the ordinary adapter path. */
  write(candidate: MemoryCandidate): MemoryWriteResult;
  /** Memories an agent may actually rely on: ACTIVE and unexpired, this tenant. */
  active(tenantId?: string): StoredMemory[];
  byStatus(status: MemoryStatus, tenantId?: string): StoredMemory[];
  all(): StoredMemory[];
  provenanceFor(memoryId: string): MemoryProvenanceRecord | undefined;
  /** Expire anything past its TTL. Returns how many changed status. */
  expire(now?: number): number;
}

function inactiveStatusFor(decision: MemoryDecision['decision']): MemoryStatus {
  switch (decision) {
    case 'QUARANTINE': return 'QUARANTINED';
    case 'REQUIRE_REVIEW': return 'REVIEW_REQUIRED';
    case 'REJECT': return 'REJECTED';
    default: return 'QUARANTINED';
  }
}

export function createGovernedMemoryStore(
  gateway: MemoryGateway,
  options: SafeloopStorageOptions = {},
): GovernedMemoryStore {
  const path = resolveSafeloopPath('runtime-memory.json', options);

  function read(): MemoryFile {
    const parsed = readJsonFile<MemoryFile>(path, { version: 1, records: [] });
    return { version: 1, records: Array.isArray(parsed.records) ? parsed.records : [] };
  }

  function write(state: MemoryFile): void {
    writeJsonFile(path, state);
  }

  function buildProvenance(
    candidate: MemoryCandidate,
    decision: MemoryDecision,
    status: MemoryStatus,
    ttl?: string,
  ): MemoryProvenanceRecord {
    return {
      protocol_version: PROTOCOL_VERSION,
      memory_id: candidate.memory_id,
      candidate_fingerprint: decision.candidate_fingerprint,
      originating_agent: candidate.agent_id ?? '',
      originating_task: candidate.task_id ?? '',
      tenant_id: candidate.tenant_id ?? '',
      evidence_ids: [...(candidate.evidence ?? [])],
      artifact_ids: [...(candidate.source_artifacts ?? [])],
      confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0,
      decision: decision.decision,
      created_at: candidate.created_at ?? new Date().toISOString(),
      verified_at: status === 'ACTIVE' ? new Date().toISOString() : undefined,
      expires_at: ttl,
      supersedes: [...(candidate.supersedes ?? [])],
      contradicts: [...(candidate.contradicts ?? [])],
      reuse_conditions: [...(candidate.reuse_conditions ?? [])],
      do_not_generalize: candidate.do_not_generalize === true,
      status,
    };
  }

  function upsert(state: MemoryFile, record: StoredMemory): void {
    const index = state.records.findIndex(
      (existing) => existing.candidate.memory_id === record.candidate.memory_id
        && (existing.provenance.tenant_id ?? '') === (record.provenance.tenant_id ?? ''),
    );
    if (index >= 0) state.records[index] = record;
    else state.records.push(record);
  }

  const store: GovernedMemoryStore = {
    persist(candidate, decision, permit): MemoryWriteResult {
      const state = read();

      if (!decision.allowed && decision.decision !== 'MERGE') {
        const status = inactiveStatusFor(decision.decision);
        const record: StoredMemory = {
          candidate,
          provenance: buildProvenance(candidate, decision, status),
        };
        upsert(state, record);
        write(state);
        return {
          activated: false,
          status,
          memory_id: candidate.memory_id,
          reason: decision.reasons.join(' '),
          provenance: record.provenance,
        };
      }

      // The binding check. Without a matching unspent permit, nothing activates.
      const authorization = gateway.authorizePersistence(permit, candidate);
      if (!authorization.authorized) {
        const record: StoredMemory = {
          candidate,
          provenance: buildProvenance(candidate, decision, 'QUARANTINED'),
        };
        upsert(state, record);
        write(state);
        return {
          activated: false,
          status: 'QUARANTINED',
          memory_id: candidate.memory_id,
          failure: authorization.failure,
          reason: authorization.reason,
          provenance: record.provenance,
        };
      }

      // Supersede anything this memory explicitly replaces, within the tenant.
      for (const supersededId of candidate.supersedes ?? []) {
        const target = state.records.find(
          (existing) => existing.candidate.memory_id === supersededId
            && existing.provenance.tenant_id === (candidate.tenant_id ?? ''),
        );
        if (target) target.provenance.status = 'SUPERSEDED';
      }

      const record: StoredMemory = {
        candidate,
        provenance: buildProvenance(candidate, decision, 'ACTIVE', authorization.ttl),
      };
      upsert(state, record);
      write(state);

      return {
        activated: true,
        status: 'ACTIVE',
        memory_id: candidate.memory_id,
        provenance: record.provenance,
      };
    },

    write(candidate): MemoryWriteResult {
      const withId: MemoryCandidate = candidate.memory_id
        ? candidate
        : { ...candidate, memory_id: `memory-${Date.now()}-${randomBytes(6).toString('hex')}` };
      const decision = gateway.propose(withId);
      return store.persist(withId, decision, decision.persistence_permit);
    },

    active(tenantId): StoredMemory[] {
      store.expire();
      return read().records.filter((record) =>
        record.provenance.status === 'ACTIVE'
        && (tenantId === undefined || record.provenance.tenant_id === tenantId));
    },

    byStatus(status, tenantId): StoredMemory[] {
      return read().records.filter((record) =>
        record.provenance.status === status
        && (tenantId === undefined || record.provenance.tenant_id === tenantId));
    },

    all(): StoredMemory[] {
      return read().records;
    },

    provenanceFor(memoryId): MemoryProvenanceRecord | undefined {
      return read().records.find((record) => record.candidate.memory_id === memoryId)?.provenance;
    },

    expire(now = Date.now()): number {
      const state = read();
      let changed = 0;
      for (const record of state.records) {
        const expiresAt = record.provenance.expires_at;
        if (record.provenance.status === 'ACTIVE' && expiresAt && Date.parse(expiresAt) <= now) {
          record.provenance.status = 'EXPIRED';
          changed += 1;
        }
      }
      if (changed > 0) write(state);
      return changed;
    },
  };

  return store;
}

/** Re-export so adapters can verify a candidate they are about to hand over. */
export { fingerprintMemoryCandidate };
