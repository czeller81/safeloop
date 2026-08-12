/**
 * Bridges the managed executor to SafeLoop's existing evidence registry and
 * append-only event stream. Deliberately thin: v0.2 adds a runtime, it does not
 * replace the ledger and provenance machinery that already works.
 */

import { randomBytes } from 'crypto';
import { appendEvent } from '../eventStream';
import { createLocalEvidenceRegistry, type EvidenceRegistry } from '../evidenceRegistry';
import { PROTOCOL_VERSION, type ArtifactRecord, type RuntimeWorkEvent } from './protocol';
import { createRuntimeWorkEvent } from './workEvents';
import { readJsonFile, resolveSafeloopPath, writeJsonFile } from '../localStorage';
import type { SafeloopStorageOptions } from '../localStorage';
import type { ExecutionRecorder } from './managedExecutor';

interface ArtifactFile {
  version: 1;
  records: ArtifactRecord[];
}

export interface RuntimeRecorder extends ExecutionRecorder {
  artifacts(): ArtifactRecord[];
  evidence(): EvidenceRegistry;
}

export function createRuntimeRecorder(options: SafeloopStorageOptions = {}): RuntimeRecorder {
  const registry = createLocalEvidenceRegistry(options);
  const artifactPath = resolveSafeloopPath('runtime-artifacts.json', options);
  const domainIndex = new Map<string, string>();

  function indexKey(sessionId: string, domainId: string): string {
    return `${sessionId}:${domainId}`;
  }

  function indexWorkEvent(workEvent: RuntimeWorkEvent): void {
    const ids = [
      workEvent.proposal_id,
      workEvent.decision_id,
      workEvent.approval_request_id,
      workEvent.approval_id,
      workEvent.permit_id,
      workEvent.execution_id,
      workEvent.verification_id,
      workEvent.memory_candidate_id,
      workEvent.memory_decision_id,
      workEvent.memory_persistence_id,
      ...(workEvent.evidence_ids ?? []),
      ...(workEvent.artifact_ids ?? []),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    for (const id of ids) domainIndex.set(indexKey(workEvent.session_id, id), workEvent.id);
  }

  function readArtifacts(): ArtifactFile {
    const parsed = readJsonFile<ArtifactFile>(artifactPath, { version: 1, records: [] });
    return { version: 1, records: Array.isArray(parsed.records) ? parsed.records : [] };
  }

  return {
    recordEvidence(input): string {
      const evidenceId = `evidence-${Date.now()}-${randomBytes(6).toString('hex')}`;
      const timestamp = new Date().toISOString();
      const record = registry.register({
        // The action fingerprint, not the file body: evidence proves what ran,
        // it is not a copy of what the action touched.
        content: input.content_hash ?? input.description,
        evidenceId,
        provenance: {
          evidenceId,
          type: input.kind,
          source: 'safeloop.runtime',
          timestamp,
          producingAgent: input.agent_id,
          confidence: 1,
          supportedClaim: input.description,
          provenance: {
            source: 'safeloop.runtime.managed_executor',
            verificationStatus: 'VERIFIED_FACT',
            confidence: 1,
          },
          verificationStatus: 'VERIFIED_FACT',
        },
        verificationStatus: 'VERIFIED_FACT',
      });
      return record.evidenceId;
    },

    recordArtifact(input): string {
      const state = readArtifacts();
      const record: ArtifactRecord = {
        protocol_version: PROTOCOL_VERSION,
        artifact_id: `artifact-${Date.now()}-${randomBytes(6).toString('hex')}`,
        path: input.path,
        content_hash: input.content_hash,
        operation: input.operation,
        agent_id: input.agent_id,
        task_id: input.task_id,
        tenant_id: input.tenant_id,
        recorded_at: new Date().toISOString(),
      };
      state.records.push(record);
      writeJsonFile(artifactPath, state);
      return record.artifact_id;
    },

    recordEvent(input): RuntimeWorkEvent | undefined {
      const workEvent = input.workEvent ? createRuntimeWorkEvent(input.workEvent) : undefined;
      if (workEvent) indexWorkEvent(workEvent);
      appendEvent({
        id: `runtime-${Date.now()}-${randomBytes(6).toString('hex')}`,
        type: input.type,
        agentId: input.agent_id,
        caseId: input.task_id,
        sessionId: input.session_id,
        summary: input.summary,
        metadata: {
          runtimeGovernance: true,
          protocolVersion: PROTOCOL_VERSION,
          tenantId: input.tenant_id,
          actionFingerprint: input.action_fingerprint,
          decision: input.decision,
          ...(input.detail ?? {}),
          ...(workEvent ? { workEvent } : {}),
        },
      }, options);
      return workEvent;
    },

    findWorkEventIdByDomainId(sessionId, domainId): string | undefined {
      return domainId ? domainIndex.get(indexKey(sessionId, domainId)) : undefined;
    },

    artifacts(): ArtifactRecord[] {
      return readArtifacts().records;
    },

    evidence(): EvidenceRegistry {
      return registry;
    },
  };
}
