/**
 * Runtime security controls for the dashboard.
 *
 * Derived from the append-only ledger, which is the dashboard's existing source
 * of truth. The runtime emits `runtime.control.declared` when a session starts
 * and `runtime.control.verified` / `runtime.control.failed` when an adapter
 * reports back, so the dashboard reflects real recorded evidence rather than
 * anything hard-coded about a particular agent.
 *
 * Nothing here is agent-specific: the control id, name, policy variable names,
 * and boundary text all arrive in the event payload from profile data.
 */

import type { SafeloopStreamEvent } from '../eventStream';

export type DashboardControlState =
  | 'DISABLED'
  | 'PENDING_VERIFICATION'
  | 'UNREACHABLE'
  | 'UNMANAGED'
  | 'VERIFICATION_FAILED'
  | 'NOT_APPLICABLE';

export interface DashboardControlPolicyEntry {
  name: string;
  effect: 'enforced' | 'unset';
}

export interface DashboardRuntimeControl {
  sessionId: string;
  agentId?: string;
  profile?: string;
  controlId: string;
  name: string;
  state: DashboardControlState;
  consequential: boolean;
  enforcement: string[];
  policy: DashboardControlPolicyEntry[];
  boundary: string;
  rationale?: string;
  verified: boolean;
  verificationPassed?: boolean;
  verifiedBy?: string;
  verificationDetail?: string;
  updatedAt: string;
  /** True when the session must not be treated as compliant. */
  blocked: boolean;
}

const CONTROL_EVENT_TYPES = new Set([
  'runtime.control.declared',
  'runtime.control.verified',
  'runtime.control.failed',
]);

const VALID_STATES = new Set<DashboardControlState>([
  'DISABLED', 'PENDING_VERIFICATION', 'UNREACHABLE',
  'UNMANAGED', 'VERIFICATION_FAILED', 'NOT_APPLICABLE',
]);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function asPolicy(value: unknown): DashboardControlPolicyEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const name = asString(record.name);
    const effect = record.effect;
    if (!name || (effect !== 'enforced' && effect !== 'unset')) return [];
    // Only the name and effect are carried forward. Any value that somehow
    // reached the ledger is dropped here rather than rendered.
    return [{ name, effect }];
  });
}

/**
 * Fold control events into the current state per (session, control).
 *
 * Later events win, so a verification result supersedes the declaration made
 * at session start.
 */
export function deriveRuntimeControls(events: SafeloopStreamEvent[]): DashboardRuntimeControl[] {
  const byKey = new Map<string, DashboardRuntimeControl>();

  for (const event of events) {
    if (!CONTROL_EVENT_TYPES.has(event.type)) continue;
    const metadata = (event.metadata ?? {}) as Record<string, unknown>;

    const controlId = asString(metadata.controlId);
    const sessionId = event.sessionId ?? '';
    if (!controlId) continue;

    const rawState = asString(metadata.controlState);
    const state = (rawState && VALID_STATES.has(rawState as DashboardControlState)
      ? rawState
      : 'PENDING_VERIFICATION') as DashboardControlState;

    const verified = event.type !== 'runtime.control.declared';
    const key = `${sessionId}::${controlId}`;

    byKey.set(key, {
      sessionId,
      agentId: event.agentId,
      profile: asString(metadata.profile),
      controlId,
      name: asString(metadata.controlName) ?? controlId,
      state,
      consequential: metadata.consequential === true,
      enforcement: Array.isArray(metadata.enforcement)
        ? (metadata.enforcement as unknown[]).flatMap((entry) => asString(entry) ?? [])
        : [],
      policy: asPolicy(metadata.policy),
      boundary: asString(metadata.boundary) ?? 'Enforced for sessions launched through SafeLoop.',
      rationale: asString(metadata.rationale),
      verified,
      verificationPassed: verified ? event.type === 'runtime.control.verified' : undefined,
      verifiedBy: asString(metadata.verifiedBy),
      verificationDetail: asString(metadata.verificationDetail),
      updatedAt: event.timestamp,
      blocked: state === 'VERIFICATION_FAILED',
    });
  }

  return Array.from(byKey.values()).sort((left, right) =>
    left.name.localeCompare(right.name) || left.sessionId.localeCompare(right.sessionId));
}

/**
 * A session is compliant only when no declared consequential control is in a
 * failed or unmanaged state. PENDING_VERIFICATION is deliberately not
 * compliant: an unconfirmed intention is not an enforced control.
 */
export function controlsCompliant(controls: DashboardRuntimeControl[]): boolean {
  if (controls.length === 0) return true;
  return controls.every((control) =>
    control.state === 'DISABLED'
    || control.state === 'NOT_APPLICABLE'
    || (control.state === 'UNREACHABLE' && !control.consequential));
}

export function blockedSessions(controls: DashboardRuntimeControl[]): DashboardRuntimeControl[] {
  return controls.filter((control) => control.blocked);
}
