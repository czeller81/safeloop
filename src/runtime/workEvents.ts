import { randomBytes } from 'crypto';
import { redactSecrets } from './redaction';
import {
  PROTOCOL_VERSION,
  RUNTIME_WORK_EVENT_SCHEMA_VERSION,
  type RuntimeWorkEvent,
  type RuntimeWorkEventType,
} from './protocol';

const SENSITIVE_KEYS = /(secret|token|password|passwd|credential|authorization|api[_-]?key|private[_-]?key)/i;
const SENSITIVE_STRING_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/(Authorization\s*:\s*Bearer\s+)[^\s"',;]+/gi, '$1[REDACTED]'],
  [/(Bearer\s+)[A-Za-z0-9._-]{6,}/gi, '$1[REDACTED]'],
];

function redactWorkEventString(value: string): string {
  let output = redactSecrets(value);
  for (const [pattern, replacement] of SENSITIVE_STRING_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export type RuntimeWorkEventInput = Omit<RuntimeWorkEvent,
  'protocol_version' | 'event_schema_version' | 'id' | 'timestamp'
> & {
  id?: string;
  timestamp?: string;
};

function eventId(type: RuntimeWorkEventType): string {
  return `work-${type}-${Date.now()}-${randomBytes(6).toString('hex')}`;
}

export function redactWorkEventData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactWorkEventData(entry));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactWorkEventData(nested);
    }
    return out;
  }
  if (typeof value === 'string') return redactWorkEventString(value);
  return value;
}

export function createRuntimeWorkEvent(input: RuntimeWorkEventInput): RuntimeWorkEvent {
  const causes = input.causes?.filter(Boolean);
  const evidence = input.evidence_ids?.filter(Boolean);
  const artifacts = input.artifact_ids?.filter(Boolean);
  return {
    protocol_version: PROTOCOL_VERSION,
    event_schema_version: RUNTIME_WORK_EVENT_SCHEMA_VERSION,
    id: input.id ?? eventId(input.type),
    type: input.type,
    timestamp: input.timestamp ?? new Date().toISOString(),
    session_id: input.session_id,
    ...(input.task_id ? { task_id: input.task_id } : {}),
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    ...(input.tenant_id ? { tenant_id: input.tenant_id } : {}),
    ...(input.parent_event_id ? { parent_event_id: input.parent_event_id } : {}),
    ...(causes?.length ? { causes } : {}),
    ...(input.proposal_id ? { proposal_id: input.proposal_id } : {}),
    ...(input.decision_id ? { decision_id: input.decision_id } : {}),
    ...(input.approval_request_id ? { approval_request_id: input.approval_request_id } : {}),
    ...(input.approval_id ? { approval_id: input.approval_id } : {}),
    ...(input.permit_id ? { permit_id: input.permit_id } : {}),
    ...(input.execution_id ? { execution_id: input.execution_id } : {}),
    ...(input.verification_id ? { verification_id: input.verification_id } : {}),
    ...(evidence?.length ? { evidence_ids: evidence } : {}),
    ...(artifacts?.length ? { artifact_ids: artifacts } : {}),
    ...(input.memory_candidate_id ? { memory_candidate_id: input.memory_candidate_id } : {}),
    ...(input.memory_decision_id ? { memory_decision_id: input.memory_decision_id } : {}),
    ...(input.memory_persistence_id ? { memory_persistence_id: input.memory_persistence_id } : {}),
    ...(input.action_fingerprint ? { action_fingerprint: input.action_fingerprint } : {}),
    ...(input.summary ? { summary: redactWorkEventString(input.summary) } : {}),
    ...(input.data ? { data: redactWorkEventData(input.data) as Record<string, unknown> } : {}),
  };
}

export function isRuntimeWorkEvent(value: unknown): value is RuntimeWorkEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.protocol_version === PROTOCOL_VERSION
    && record.event_schema_version === RUNTIME_WORK_EVENT_SCHEMA_VERSION
    && typeof record.id === 'string'
    && typeof record.type === 'string'
    && typeof record.timestamp === 'string'
    && typeof record.session_id === 'string';
}
