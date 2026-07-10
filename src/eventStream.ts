import { existsSync, readFileSync } from 'fs';
import { appendLine, resolveSafeloopPath, type SafeloopStorageOptions } from './localStorage';

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

export interface MalformedEventLine {
  lineNumber: number;
  message: string;
  preview: string;
}

export interface EventReadDiagnostics {
  filePath: string;
  malformedLineCount: number;
  skippedEmptyLineCount: number;
  malformedLines: MalformedEventLine[];
}

export interface EventReadResult {
  events: SafeloopStreamEvent[];
  diagnostics: EventReadDiagnostics;
}

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

function createDiagnostics(filePath: string): EventReadDiagnostics {
  return {
    filePath,
    malformedLineCount: 0,
    skippedEmptyLineCount: 0,
    malformedLines: [],
  };
}

function previewLine(line: string): string {
  const normalized = line.trim().replace(/\s+/g, ' ');
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

export function readEventsWithDiagnostics(options: SafeloopStorageOptions = {}): EventReadResult {
  const filePath = resolveSafeloopPath('events.jsonl', options);
  const diagnostics = createDiagnostics(filePath);
  const events: SafeloopStreamEvent[] = [];

  if (!existsSync(filePath)) {
    return { events, diagnostics };
  }

  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      diagnostics.skippedEmptyLineCount += 1;
      return;
    }

    try {
      events.push(JSON.parse(trimmed) as SafeloopStreamEvent);
    } catch (error) {
      diagnostics.malformedLineCount += 1;
      diagnostics.malformedLines.push({
        lineNumber: index + 1,
        message: error instanceof Error ? error.message : String(error),
        preview: previewLine(trimmed),
      });
    }
  });

  return { events, diagnostics };
}

export function readEvents(options: SafeloopStorageOptions = {}): SafeloopStreamEvent[] {
  return readEventsWithDiagnostics(options).events;
}

export async function* streamEvents(options: SafeloopStorageOptions = {}): AsyncGenerator<SafeloopStreamEvent, void, void> {
  for (const event of readEvents(options)) {
    yield event;
  }
}
