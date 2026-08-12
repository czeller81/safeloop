import { readEvents, type SafeloopStreamEvent } from '../eventStream';
import { createLocalEvidenceRegistry, type EvidenceRegistryRecord } from '../evidenceRegistry';
import { readJsonFile, resolveSafeloopPath, type SafeloopStorageOptions } from '../localStorage';
import { isRuntimeWorkEvent } from './workEvents';
import type { ArtifactRecord, RuntimeWorkEvent } from './protocol';
import type { StoredMemory } from './memoryStore';

interface ArtifactFile { version: 1; records: ArtifactRecord[] }
interface MemoryFile { version: 1; records: StoredMemory[] }

export interface SessionWorkGraphEdge {
  from: string;
  to: string;
  type: 'parent' | 'cause' | 'references_evidence' | 'references_artifact' | 'references_memory';
}

export interface SessionWorkGraphTask {
  task_id: string;
  events: RuntimeWorkEvent[];
}

export interface SessionWorkGraph {
  session_id: string;
  events: RuntimeWorkEvent[];
  tasks: SessionWorkGraphTask[];
  edges: SessionWorkGraphEdge[];
  evidence: EvidenceRegistryRecord[];
  artifacts: ArtifactRecord[];
  memories: StoredMemory[];
  legacy_events: SafeloopStreamEvent[];
  diagnostics: {
    legacy_event_count: number;
    work_event_count: number;
    missing_causal_metadata_count: number;
  };
}

function metadata(event: SafeloopStreamEvent): Record<string, unknown> {
  return event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
    ? event.metadata as Record<string, unknown>
    : {};
}

export function extractRuntimeWorkEvent(event: SafeloopStreamEvent): RuntimeWorkEvent | null {
  const workEvent = metadata(event).workEvent;
  return isRuntimeWorkEvent(workEvent) ? workEvent : null;
}

function readArtifacts(options: SafeloopStorageOptions): ArtifactRecord[] {
  return readJsonFile<ArtifactFile>(resolveSafeloopPath('runtime-artifacts.json', options), { version: 1, records: [] }).records ?? [];
}

function readMemories(options: SafeloopStorageOptions): StoredMemory[] {
  return readJsonFile<MemoryFile>(resolveSafeloopPath('runtime-memory.json', options), { version: 1, records: [] }).records ?? [];
}

function byTime(left: RuntimeWorkEvent, right: RuntimeWorkEvent): number {
  const a = Date.parse(left.timestamp);
  const b = Date.parse(right.timestamp);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return left.id.localeCompare(right.id);
  return a - b;
}

export function buildSessionWorkGraph(sessionId: string, options: SafeloopStorageOptions = {}): SessionWorkGraph {
  const legacyEvents = readEvents(options).filter((event) => event.sessionId === sessionId || extractRuntimeWorkEvent(event)?.session_id === sessionId);
  const events = legacyEvents.flatMap((event) => {
    const workEvent = extractRuntimeWorkEvent(event);
    return workEvent && workEvent.session_id === sessionId ? [workEvent] : [];
  }).sort(byTime);

  const edges: SessionWorkGraphEdge[] = [];
  let missingCausalMetadata = 0;
  for (const event of events) {
    if (event.parent_event_id) edges.push({ from: event.parent_event_id, to: event.id, type: 'parent' });
    for (const cause of event.causes ?? []) edges.push({ from: cause, to: event.id, type: 'cause' });
    for (const evidenceId of event.evidence_ids ?? []) edges.push({ from: event.id, to: evidenceId, type: 'references_evidence' });
    for (const artifactId of event.artifact_ids ?? []) edges.push({ from: event.id, to: artifactId, type: 'references_artifact' });
    if (event.memory_candidate_id) edges.push({ from: event.id, to: event.memory_candidate_id, type: 'references_memory' });
    if (!event.parent_event_id && !(event.causes?.length) && !['session.started', 'task.started'].includes(event.type)) {
      missingCausalMetadata += 1;
    }
  }

  const tasksById = new Map<string, RuntimeWorkEvent[]>();
  for (const event of events) {
    if (!event.task_id) continue;
    const list = tasksById.get(event.task_id) ?? [];
    list.push(event);
    tasksById.set(event.task_id, list);
  }

  const artifacts = readArtifacts(options).filter((artifact) => events.some((event) => event.artifact_ids?.includes(artifact.artifact_id)));
  const evidenceIds = new Set(events.flatMap((event) => event.evidence_ids ?? []));
  const evidence = createLocalEvidenceRegistry(options).list().filter((record) => evidenceIds.has(record.evidenceId));
  const memories = readMemories(options).filter((record) => record.candidate.session_id === sessionId || events.some((event) => event.memory_candidate_id === record.candidate.memory_id));

  return {
    session_id: sessionId,
    events,
    tasks: Array.from(tasksById.entries()).map(([task_id, taskEvents]) => ({ task_id, events: taskEvents.sort(byTime) })),
    edges,
    evidence,
    artifacts,
    memories,
    legacy_events: legacyEvents,
    diagnostics: {
      legacy_event_count: legacyEvents.length,
      work_event_count: events.length,
      missing_causal_metadata_count: missingCausalMetadata,
    },
  };
}
