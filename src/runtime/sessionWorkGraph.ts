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
  scope: 'internal' | 'external' | 'legacy_unresolved';
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
    node_count: number;
    edge_count: number;
    dangling_internal_edge_count: number;
    legacy_unresolved_count: number;
  };
}

export interface SessionTimelinePageOptions {
  limit?: number;
  cursor?: string;
  includeLegacyEvents?: boolean;
}

export interface SessionTimelinePage extends Omit<SessionWorkGraph, 'events' | 'tasks' | 'legacy_events'> {
  events: RuntimeWorkEvent[];
  tasks: SessionWorkGraphTask[];
  page: {
    limit: number;
    next_cursor?: string;
    has_more: boolean;
    total_count: number;
    returned_count: number;
    truncated: boolean;
    max_limit: number;
  };
  legacy_events?: SafeloopStreamEvent[];
}

export const DEFAULT_SESSION_TIMELINE_LIMIT = 250;
export const MAX_SESSION_TIMELINE_LIMIT = 1000;

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

  const eventIds = new Set(events.map((event) => event.id));
  const edges: SessionWorkGraphEdge[] = [];
  let missingCausalMetadata = 0;
  for (const event of events) {
    if (event.parent_event_id) edges.push({ from: event.parent_event_id, to: event.id, type: 'parent', scope: 'internal' });
    for (const cause of event.causes ?? []) edges.push({ from: cause, to: event.id, type: 'cause', scope: 'internal' });
    for (const evidenceId of event.evidence_ids ?? []) edges.push({ from: event.id, to: evidenceId, type: 'references_evidence', scope: 'external' });
    for (const artifactId of event.artifact_ids ?? []) edges.push({ from: event.id, to: artifactId, type: 'references_artifact', scope: 'external' });
    if (event.memory_candidate_id) edges.push({ from: event.id, to: event.memory_candidate_id, type: 'references_memory', scope: 'external' });
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

  const danglingInternalEdges = edges.filter((edge) => edge.scope === 'internal' && (!eventIds.has(edge.from) || !eventIds.has(edge.to)));

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
      node_count: events.length,
      edge_count: edges.length,
      dangling_internal_edge_count: danglingInternalEdges.length,
      legacy_unresolved_count: 0,
    },
  };
}

function normalizeLimit(limit: unknown): number {
  if (limit === undefined) return DEFAULT_SESSION_TIMELINE_LIMIT;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
    throw new Error('invalid_limit');
  }
  return Math.min(limit, MAX_SESSION_TIMELINE_LIMIT);
}

function stripEmbeddedWorkEvent(event: SafeloopStreamEvent): SafeloopStreamEvent {
  const metadata = event.metadata ? { ...event.metadata } : undefined;
  if (metadata && 'workEvent' in metadata) delete metadata.workEvent;
  return { ...event, metadata };
}

export function buildSessionTimelinePage(
  sessionId: string,
  storageOptions: SafeloopStorageOptions = {},
  pageOptions: SessionTimelinePageOptions = {},
): SessionTimelinePage {
  const graph = buildSessionWorkGraph(sessionId, storageOptions);
  const limit = normalizeLimit(pageOptions.limit);
  let start = 0;
  if (pageOptions.cursor) {
    const index = graph.events.findIndex((event) => event.id === pageOptions.cursor);
    if (index < 0) throw new Error('invalid_cursor');
    start = index + 1;
  }
  const events = graph.events.slice(start, start + limit);
  const eventIds = new Set(events.map((event) => event.id));
  const allEventIds = new Set(graph.events.map((event) => event.id));
  const edges = graph.edges.filter((edge) => {
    if (edge.scope === 'external') return eventIds.has(edge.from);
    return eventIds.has(edge.to) || (eventIds.has(edge.from) && allEventIds.has(edge.to));
  });
  const tasksById = new Map<string, RuntimeWorkEvent[]>();
  for (const event of events) {
    if (!event.task_id) continue;
    const list = tasksById.get(event.task_id) ?? [];
    list.push(event);
    tasksById.set(event.task_id, list);
  }
  const next = start + events.length < graph.events.length ? events[events.length - 1]?.id : undefined;
  const page: SessionTimelinePage = {
    session_id: graph.session_id,
    events,
    tasks: Array.from(tasksById.entries()).map(([task_id, taskEvents]) => ({ task_id, events: taskEvents })),
    edges,
    evidence: graph.evidence.filter((record) => events.some((event) => event.evidence_ids?.includes(record.evidenceId))),
    artifacts: graph.artifacts.filter((artifact) => events.some((event) => event.artifact_ids?.includes(artifact.artifact_id))),
    memories: graph.memories.filter((record) => events.some((event) => event.memory_candidate_id === record.candidate.memory_id)),
    diagnostics: graph.diagnostics,
    page: {
      limit,
      ...(next ? { next_cursor: next } : {}),
      has_more: Boolean(next),
      total_count: graph.events.length,
      returned_count: events.length,
      truncated: graph.events.length > events.length,
      max_limit: MAX_SESSION_TIMELINE_LIMIT,
    },
  };
  if (pageOptions.includeLegacyEvents) {
    page.legacy_events = graph.legacy_events.slice(start, start + limit).map(stripEmbeddedWorkEvent);
  }
  return page;
}
