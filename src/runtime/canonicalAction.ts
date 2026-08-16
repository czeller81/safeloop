/**
 * SafeLoop Canonical Action Model
 *
 * Turns an agent's ActionProposal into a deterministic CanonicalAction and a
 * SHA-256 ActionFingerprint. The fingerprint is the identity that approvals and
 * execution permits bind to, so its determinism is a security property:
 *
 *   - semantically identical proposals MUST produce the same fingerprint
 *   - any security-significant difference MUST produce a different fingerprint
 *
 * Determinism rules (never rely on JS object key iteration order):
 *   1. Object keys are sorted by UTF-16 code unit before serialization.
 *   2. Arrays keep their order — order is semantically significant in argv.
 *   3. Absent, null, empty-string, and omitted all collapse to '' for scalar
 *      slots so adapters cannot produce two forms of "nothing".
 *   4. Case is lowered ONLY on case-insensitive protocol slots
 *      (action_kind, tool, operation, method). Never on arguments, paths,
 *      targets, or resources — `/Data` and `/data` are different files on
 *      case-sensitive filesystems, and `--Force` is not `--force`.
 *   5. `cwd` is lexically normalized (separator + `.`/`..` resolution) because
 *      `/a/b/../c` and `/a/c` are the same directory. Symlinks are NOT
 *      resolved — that would require filesystem access and would make the
 *      fingerprint depend on mutable host state.
 *   6. `trace_id` is carried but EXCLUDED from the fingerprint: an approval
 *      requested under one trace must stay redeemable by the execution that
 *      follows it.
 */

import { createHash } from 'crypto';
import { classifyMcpAction } from './mcpActionClassifier';
import { posix as posixPath, win32 as win32Path } from 'path';
import {
  PROTOCOL_VERSION,
  type ActionFingerprint,
  type ActionKind,
  type ActionProposal,
  type CanonicalAction,
} from './protocol';

const ACTION_KINDS: ReadonlySet<string> = new Set<ActionKind>([
  'shell',
  'filesystem',
  'git',
  'http',
  'mcp',
  'memory',
  'delegation',
  'custom',
]);

/** Slots whose fingerprint contribution is case-insensitive by protocol. */
function normalizeCaseInsensitive(value: unknown): string {
  return normalizeScalar(value).toLowerCase();
}

/** Slots that must preserve case exactly (paths, targets, arguments). */
function normalizeScalar(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value).trim();
}

/**
 * Lexically normalize a working directory. Handles both POSIX and Windows
 * shapes so a fingerprint computed on either platform is stable.
 */
export function normalizeCwd(value: unknown): string {
  const raw = normalizeScalar(value);
  if (!raw) return '';

  const isWindows = /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\');
  if (isWindows) {
    const normalized = win32Path.normalize(raw).replace(/[\\/]+$/, '');
    // Drive letters are case-insensitive on Windows; the rest is preserved.
    return normalized.replace(/^([a-zA-Z]):/, (_m, drive: string) => `${drive.toUpperCase()}:`);
  }

  const normalized = posixPath.normalize(raw.replace(/\\/g, '/'));
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
}

/**
 * Deterministic JSON serialization: recursively sorted object keys, ordered
 * arrays, no undefined. This is the only serializer allowed to feed the hash.
 */
export function canonicalStringify(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const body = keys
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
      .join(',');
    return `{${body}}`;
  }
  // Functions/symbols are not protocol values.
  return 'null';
}

/**
 * Normalize an arguments object. Keys are sorted at serialization time;
 * values keep their case and order. Nested objects/arrays are preserved so
 * argv arrays remain position-sensitive.
 */
function normalizeArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    if (entry === undefined) continue;
    out[key] = entry;
  }
  return out;
}

export function canonicalizeAction(proposal: ActionProposal): CanonicalAction {
  const kindRaw = normalizeCaseInsensitive(proposal.action_kind);
  const action_kind = (ACTION_KINDS.has(kindRaw) ? kindRaw : 'custom') as ActionKind;

  // Classify BEFORE the case-insensitive slots are lowercased. `tool` and
  // `operation` are normalized to lowercase for fingerprint stability, which
  // collapses `deleteRepository` to `deleterepository`; segmenting here is the
  // only place the original word boundaries still exist.
  const mcp_consequential = action_kind === 'mcp'
    ? classifyMcpAction({ operation: proposal.operation, tool: proposal.tool, arguments: proposal.arguments })
    : undefined;

  return {
    protocol_version: normalizeScalar(proposal.protocol_version) || PROTOCOL_VERSION,
    action_kind,
    ...(mcp_consequential === undefined ? {} : { mcp_consequential }),
    tool: normalizeCaseInsensitive(proposal.tool),
    operation: normalizeCaseInsensitive(proposal.operation),
    arguments: normalizeArguments(proposal.arguments),
    cwd: normalizeCwd(proposal.cwd),
    target: normalizeScalar(proposal.target),
    resource: normalizeScalar(proposal.resource),
    method: normalizeCaseInsensitive(proposal.method),
    agent_id: normalizeScalar(proposal.agent_id),
    parent_agent_id: normalizeScalar(proposal.parent_agent_id),
    task_id: normalizeScalar(proposal.task_id),
    session_id: normalizeScalar(proposal.session_id),
    scenario_id: normalizeScalar(proposal.scenario_id),
    tenant_id: normalizeScalar(proposal.tenant_id),
    trace_id: normalizeScalar(proposal.trace_id),
  };
}

/**
 * The exact field set the fingerprint covers. `trace_id` is intentionally
 * absent — see the module header and docs/APPROVAL_MODEL.md.
 */
export function fingerprintBindingSet(action: CanonicalAction): Record<string, unknown> {
  return {
    protocol_version: action.protocol_version,
    action_kind: action.action_kind,
    tool: action.tool,
    operation: action.operation,
    arguments: action.arguments,
    cwd: action.cwd,
    target: action.target,
    resource: action.resource,
    method: action.method,
    agent_id: action.agent_id,
    parent_agent_id: action.parent_agent_id,
    task_id: action.task_id,
    session_id: action.session_id,
    scenario_id: action.scenario_id,
    tenant_id: action.tenant_id,
  };
}

export function fingerprintAction(input: ActionProposal | CanonicalAction): ActionFingerprint {
  const action = isCanonicalAction(input) ? input : canonicalizeAction(input);
  const canonical_form = canonicalStringify(fingerprintBindingSet(action));
  return {
    protocol_version: action.protocol_version,
    fingerprint: createHash('sha256').update(canonical_form, 'utf8').digest('hex'),
    algorithm: 'sha256',
    canonical_form,
  };
}

/** Convenience: fingerprint hash only. */
export function actionFingerprintHash(input: ActionProposal | CanonicalAction): string {
  return fingerprintAction(input).fingerprint;
}

function isCanonicalAction(value: ActionProposal | CanonicalAction): value is CanonicalAction {
  const candidate = value as CanonicalAction;
  return (
    typeof candidate.protocol_version === 'string' &&
    typeof candidate.tool === 'string' &&
    typeof candidate.operation === 'string' &&
    typeof candidate.cwd === 'string' &&
    typeof candidate.target === 'string' &&
    typeof candidate.resource === 'string' &&
    typeof candidate.method === 'string' &&
    typeof candidate.parent_agent_id === 'string' &&
    typeof candidate.trace_id === 'string' &&
    typeof candidate.arguments === 'object'
  );
}

/**
 * Human-readable summary used in approval prompts and ledger entries.
 * Never used for policy decisions — those read structured fields.
 */
export function describeCanonicalAction(action: CanonicalAction): string {
  const parts: string[] = [action.action_kind];
  if (action.operation) parts.push(action.operation);
  if (action.tool && action.tool !== action.action_kind) parts.push(`via ${action.tool}`);
  if (action.method) parts.push(action.method.toUpperCase());
  if (action.target) parts.push(action.target);
  else if (action.resource) parts.push(action.resource);
  if (action.cwd) parts.push(`in ${action.cwd}`);
  return parts.join(' ');
}
