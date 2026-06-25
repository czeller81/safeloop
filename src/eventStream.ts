import { appendLine, readLines, resolveSafeloopPath, type SafeloopStorageOptions } from './localStorage';

export type SafeloopStreamEventType =
  | 'task.started'
  | 'context.loaded'
  | 'decision.made'
  | 'decision.explained'
  | 'risk.detected'
  | 'approval.requested'
  | 'approval.resolved'
  | 'artifact.changed'
  | 'model.usage'
  | 'token.cost'
  | 'steering.applied'
  | 'test.completed'
  | 'handoff.created'
  | 'task.completed'
  | 'report.generated'
  | 'feedback.recorded'
  | 'operator.action.recorded';

export interface SafeloopStreamEvent {
  id: string;
  type: SafeloopStreamEventType | string;
  timestamp: string;
  agentId: string;
  agentName?: string;
  participantId?: string;
  caseId?: string;
  sessionId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export type SafeloopStreamEventInput = Omit<SafeloopStreamEvent, 'timestamp'> & {
  timestamp?: string;
};

function now(): string {
  return new Date().toISOString();
}

function normalizeEvent(event: SafeloopStreamEventInput): SafeloopStreamEvent {
  return {
    ...event,
    timestamp: event.timestamp ?? now(),
    metadata: event.metadata ? { ...event.metadata } : undefined,
  };
}

export function appendEvent(event: SafeloopStreamEventInput, options: SafeloopStorageOptions = {}): SafeloopStreamEvent {
  const record = normalizeEvent(event);
  const filePath = resolveSafeloopPath('events.jsonl', options);
  appendLine(filePath, JSON.stringify(record));
  return record;
}

export function readEvents(options: SafeloopStorageOptions = {}): SafeloopStreamEvent[] {
  const filePath = resolveSafeloopPath('events.jsonl', options);
  return readLines(filePath).map((line) => JSON.parse(line) as SafeloopStreamEvent);
}

export async function* streamEvents(options: SafeloopStorageOptions = {}): AsyncGenerator<SafeloopStreamEvent, void, void> {
  for (const event of readEvents(options)) {
    yield event;
  }
}
