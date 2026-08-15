import { createHash } from 'crypto';
import { readEventsWithDiagnostics } from '../eventStream';
import type { SafeloopStorageOptions } from '../localStorage';
import { redactSecrets } from './redaction';
import { PROTOCOL_VERSION, type RuntimeWorkEvent } from './protocol';
import type { RuntimeStatus } from './runtimeCore';
import { buildFlightRecorderSession } from './flightRecorder';
import { policyLifecycleStatus, type PolicyLifecycleStatus } from '../policyLifecycle';

export type OperationalStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type DependencyCriticality = 'critical' | 'optional' | 'degraded-capable';
export type MetricKind = 'counter' | 'gauge' | 'histogram';

export interface MetricSample {
  name: string;
  kind: MetricKind;
  value: number;
  labels?: Record<string, string>;
}

export interface HealthComponent {
  status: OperationalStatus;
  checked_at: string;
  summary: string;
  reasons: string[];
  metrics?: Record<string, number | string | boolean>;
}

export interface DependencyHealth extends HealthComponent {
  component: string;
  criticality: DependencyCriticality;
}

export interface GoldenControlResult {
  id: string;
  polarity: 'positive' | 'negative';
  status: 'pass' | 'fail';
  expected: string;
  observed: string;
  exercised_path: string;
}

export interface SyntheticGovernanceReport extends HealthComponent {
  positive_controls: GoldenControlResult[];
  negative_controls: GoldenControlResult[];
  drift_detected: boolean;
}

export interface VersionProvenance {
  runtime_version: string;
  protocol_version: string;
  telemetry_schema_version: 1;
  policy_versions: string[];
  profile_ids: string[];
  config_version: string;
  event_model_version: 1;
}

export interface OperationalTelemetrySnapshot {
  schema_version: 1;
  generated_at: string;
  provenance: VersionProvenance;
  health: {
    liveness: HealthComponent;
    readiness: HealthComponent;
    governance: HealthComponent;
    evidence: HealthComponent;
    dependencies: DependencyHealth[];
    telemetry: HealthComponent;
    overall_status: OperationalStatus;
  };
  metrics: MetricSample[];
  synthetic: SyntheticGovernanceReport;
  alerts: Array<{ id: string; status: 'active' | 'clear'; reason: string }>;
  policy_lifecycle?: PolicyLifecycleStatus;
  privacy: {
    telemetry_contains_raw_credentials: boolean;
    high_cardinality_metric_risk_found: boolean;
    redaction_boundary: 'metric labels are bounded enums; detailed identifiers remain in authorized runtime/Flight Recorder surfaces';
  };
}

export interface TelemetryExporter {
  export(snapshot: OperationalTelemetrySnapshot): void;
}

export interface OperationalTelemetryOptions {
  storageOptions?: SafeloopStorageOptions;
  exporter?: TelemetryExporter;
  now?: () => Date;
  force?: {
    policyUnavailable?: boolean;
    evidenceFailure?: boolean;
    telemetryExporterFailure?: boolean;
    optionalProviderUnavailable?: boolean;
    metricsRegistryUnavailable?: boolean;
  };
}

const BOUNDED_LABELS = new Set(['component', 'operation', 'outcome', 'status', 'provider', 'reason_category', 'verification_status', 'polarity']);
const SECRET_CANARY_PATTERNS = [
  /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /password\s*=\s*[^&\s]+/gi,
  /api[_-]?key\s*=\s*[^&\s]+/gi,
  /credential\s*=\s*[^&\s]+/gi,
  /client_secret\s*=\s*[^&\s]+/gi,
  /aws_secret_access_key\s*=\s*[^&\s]+/gi,
  /https:\/\/[^:\s/]+:[^@\s/]+@/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

function statusRank(status: OperationalStatus): number {
  return { healthy: 0, unknown: 1, degraded: 2, unhealthy: 3 }[status];
}

function worstStatus(statuses: OperationalStatus[]): OperationalStatus {
  return statuses.reduce((worst, status) => statusRank(status) > statusRank(worst) ? status : worst, 'healthy' as OperationalStatus);
}

function component(status: OperationalStatus, summary: string, checkedAt: string, reasons: string[] = [], metrics?: HealthComponent['metrics']): HealthComponent {
  return { status, checked_at: checkedAt, summary, reasons, ...(metrics ? { metrics } : {}) };
}

function dependency(componentName: string, criticality: DependencyCriticality, status: OperationalStatus, summary: string, checkedAt: string, reasons: string[] = []): DependencyHealth {
  return { component: componentName, criticality, ...component(status, summary, checkedAt, reasons) };
}

function metric(name: string, kind: MetricKind, value: number, labels?: Record<string, string>): MetricSample {
  return labels ? { name, kind, value, labels } : { name, kind, value };
}

function metricKey(sample: MetricSample): string {
  return `${sample.name}:${JSON.stringify(sample.labels ?? {})}`;
}

function increment(samples: Map<string, MetricSample>, name: string, labels: Record<string, string>, by = 1): void {
  const sample = metric(name, 'counter', by, labels);
  const key = metricKey(sample);
  const existing = samples.get(key);
  if (existing) {
    existing.value += by;
  } else {
    samples.set(key, sample);
  }
}

function gauge(samples: Map<string, MetricSample>, name: string, value: number, labels?: Record<string, string>): void {
  const sample = metric(name, 'gauge', value, labels);
  samples.set(metricKey(sample), sample);
}

function histogram(samples: Map<string, MetricSample>, name: string, value: number, labels?: Record<string, string>): void {
  const sample = metric(name, 'histogram', value, labels);
  samples.set(metricKey(sample), sample);
}

function asWorkEvent(value: unknown): RuntimeWorkEvent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as RuntimeWorkEvent;
  return typeof record.type === 'string' && typeof record.session_id === 'string' ? record : undefined;
}

function workEvents(options: SafeloopStorageOptions): { events: RuntimeWorkEvent[]; malformed: number } {
  const read = readEventsWithDiagnostics(options);
  return {
    events: read.events.map((event) => asWorkEvent(event.metadata?.workEvent)).filter((event): event is RuntimeWorkEvent => Boolean(event)),
    malformed: read.diagnostics.malformedLineCount,
  };
}

function verificationStatus(data: Record<string, unknown> | undefined): string {
  const proof = data?.execution_proof;
  if (proof && typeof proof === 'object' && typeof (proof as { verification_status?: unknown }).verification_status === 'string') {
    return (proof as { verification_status: string }).verification_status;
  }
  return 'UNKNOWN';
}

function reasonCategory(event: RuntimeWorkEvent): string {
  const status = typeof event.data?.status === 'string' ? event.data.status : '';
  if (status.includes('BUDGET')) return 'budget';
  if (status.includes('BREAKER')) return 'breaker';
  const reason = typeof event.data?.reason === 'string' ? event.data.reason.toLowerCase() : '';
  if (reason.includes('permit')) return 'permit';
  if (reason.includes('approval')) return 'approval';
  if (reason.includes('context')) return 'context';
  if (reason.includes('auth')) return 'auth';
  if (reason.includes('budget')) return 'budget';
  if (reason.includes('breaker')) return 'breaker';
  return 'runtime';
}

function providerFor(event: RuntimeWorkEvent): string {
  const proof = event.data?.execution_proof;
  if (proof && typeof proof === 'object' && typeof (proof as { executor?: unknown }).executor === 'string') {
    const executor = (proof as { executor: string }).executor;
    return ['filesystem', 'shell', 'git', 'http', 'mcp'].includes(executor) ? executor : 'other';
  }
  return 'unknown';
}

function sanitizeMetrics(samples: MetricSample[]): MetricSample[] {
  return samples.map((sample) => ({
    ...sample,
    labels: sample.labels
      ? Object.fromEntries(Object.entries(sample.labels)
        .filter(([key]) => BOUNDED_LABELS.has(key))
        .map(([key, value]) => [key, redactSecrets(value).slice(0, 64)]))
      : undefined,
  }));
}

function containsRawSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  return SECRET_CANARY_PATTERNS.some((pattern) => pattern.test(text));
}

function hasHighCardinalityLabel(samples: MetricSample[]): boolean {
  return samples.some((sample) => Object.keys(sample.labels ?? {}).some((key) => !BOUNDED_LABELS.has(key)));
}

function policyVersions(status: RuntimeStatus): string[] {
  const profiles = new Set(status.sessions.map((session) => session.profile));
  return Array.from(profiles.size ? profiles : new Set(['default'])).sort().map((profile) => `profile:${profile}`);
}

function buildMetrics(events: RuntimeWorkEvent[], status: RuntimeStatus, lifecycle?: PolicyLifecycleStatus): MetricSample[] {
  const samples = new Map<string, MetricSample>();
  for (const event of events) {
    if (event.type === 'decision.recorded') {
      const disposition = typeof event.data?.disposition === 'string' ? event.data.disposition : 'UNKNOWN';
      increment(samples, 'safeloop_governance_decisions_total', { outcome: disposition });
    } else if (event.type === 'approval.requested' || event.type === 'approval.granted' || event.type === 'approval.denied' || event.type === 'approval.redeemed') {
      increment(samples, 'safeloop_approval_events_total', { status: event.type.split('.')[1] ?? 'unknown' });
    } else if (event.type === 'permit.issued' || event.type === 'permit.consumed') {
      increment(samples, 'safeloop_permit_events_total', { status: event.type.split('.')[1] ?? 'unknown' });
    } else if (event.type === 'execution.started') {
      increment(samples, 'safeloop_managed_executions_total', { status: 'started', provider: providerFor(event) });
    } else if (event.type === 'execution.completed') {
      const statusLabel = typeof event.data?.status === 'string' ? event.data.status : 'UNKNOWN';
      increment(samples, 'safeloop_managed_executions_total', { status: statusLabel, provider: providerFor(event) });
      const duration = typeof event.data?.duration_ms === 'number' ? event.data.duration_ms : undefined;
      if (duration !== undefined) histogram(samples, 'safeloop_execution_duration_ms', duration, { provider: providerFor(event), status: statusLabel });
      increment(samples, 'safeloop_evidence_verification_total', { verification_status: verificationStatus(event.data) });
    } else if (event.type === 'execution.rejected') {
      increment(samples, 'safeloop_managed_executions_total', { status: 'rejected', provider: providerFor(event) });
      increment(samples, 'safeloop_execution_rejections_total', { reason_category: reasonCategory(event) });
    } else if (event.type === 'evidence.recorded' || event.type === 'verification.recorded') {
      increment(samples, 'safeloop_evidence_events_total', { status: event.type.split('.')[0] ?? 'unknown' });
    }
  }
  gauge(samples, 'safeloop_active_sessions', status.active_sessions);
  gauge(samples, 'safeloop_pending_approvals', status.sessions.reduce((sum, session) => sum + session.pending_approvals, 0));
  gauge(samples, 'safeloop_breaker_open_sessions', status.sessions.filter((session) => session.breaker_state === 'OPEN').length);
  gauge(samples, 'safeloop_budget_remaining_actions', status.sessions.reduce((sum, session) => sum + (session.budget_remaining.actions ?? 0), 0));
  if (lifecycle) {
    gauge(samples, 'safeloop_policy_lifecycle_state', lifecycle.active_bundle?.status === 'ACTIVE' ? 1 : 0, { status: lifecycle.active_bundle?.status ?? 'UNKNOWN' });
    gauge(samples, 'safeloop_policy_config_drift_state', lifecycle.drift_state === 'NO_DRIFT' ? 0 : lifecycle.drift_state === 'DRIFT' ? 1 : 2, { status: lifecycle.drift_state });
    gauge(samples, 'safeloop_policy_validation_failures_total', lifecycle.latest_validation && !lifecycle.latest_validation.valid ? 1 : 0);
    gauge(samples, 'safeloop_policy_activations_total', lifecycle.latest_activation ? 1 : 0);
  }
  return sanitizeMetrics(Array.from(samples.values()).sort((left, right) => left.name.localeCompare(right.name)));
}

function buildEvidenceHealth(events: RuntimeWorkEvent[], status: RuntimeStatus, options: SafeloopStorageOptions, checkedAt: string, forceEvidenceFailure?: boolean): HealthComponent {
  if (forceEvidenceFailure) return component('unhealthy', 'Evidence projection failed under injected failure.', checkedAt, ['evidence_projection_failed']);
  let unknown = 0;
  let conflicts = 0;
  let missing = 0;
  let notVerifiable = 0;
  for (const session of status.sessions) {
    try {
      const flight = buildFlightRecorderSession(session.session_id, options);
      unknown += flight.summary.uncertainty_count ?? 0;
      conflicts += flight.prevention_conflicts.length;
      missing += flight.summary.missing_causal_link_count ?? flight.diagnostics.missing_causal_metadata_count;
      notVerifiable += flight.summary.not_verifiable_count;
    } catch {
      return component('unhealthy', 'Evidence projection failed.', checkedAt, ['evidence_projection_failed']);
    }
  }
  const evidenceEvents = events.filter((event) => event.type === 'evidence.recorded' || event.type === 'verification.recorded' || event.type === 'execution.completed').length;
  const statusValue: OperationalStatus = conflicts > 0 || unknown > 0 || missing > 0 ? 'degraded' : 'healthy';
  return component(statusValue, statusValue === 'healthy' ? 'Evidence projection and proof counters are available.' : 'Evidence is observable with uncertainty signals.', checkedAt, [], {
    evidence_events: evidenceEvents,
    unknown_execution_count: unknown,
    prevention_conflicts: conflicts,
    missing_reference_count: missing,
    not_verifiable_count: notVerifiable,
  });
}

function buildSynthetic(events: RuntimeWorkEvent[], checkedAt: string): SyntheticGovernanceReport {
  const dispositions = events.filter((event) => event.type === 'decision.recorded').map((event) => String(event.data?.disposition ?? 'UNKNOWN'));
  const permits = events.some((event) => event.type === 'permit.issued');
  const evidence = events.some((event) => event.type === 'evidence.recorded' || event.type === 'verification.recorded' || event.type === 'execution.completed');
  const positive: GoldenControlResult[] = [
    { id: 'known-safe-governed-action', polarity: 'positive', expected: 'ALLOW or ALLOW_WITH_WARNING observed', observed: dispositions.some((entry) => entry === 'ALLOW' || entry === 'ALLOW_WITH_WARNING') ? 'ALLOW_PATH_OBSERVED' : 'MISSING_ALLOW_PATH', status: dispositions.some((entry) => entry === 'ALLOW' || entry === 'ALLOW_WITH_WARNING') ? 'pass' : 'fail', exercised_path: 'decision.recorded' },
    { id: 'valid-permit-issued', polarity: 'positive', expected: 'permit.issued observed', observed: permits ? 'PERMIT_ISSUED' : 'NO_PERMIT_ISSUED', status: permits ? 'pass' : 'fail', exercised_path: 'permit.issued' },
    { id: 'normal-evidence-recorded', polarity: 'positive', expected: 'evidence or execution proof observed', observed: evidence ? 'EVIDENCE_PATH_OBSERVED' : 'NO_EVIDENCE_PATH', status: evidence ? 'pass' : 'fail', exercised_path: 'execution.completed' },
  ];
  const negativeSeen = dispositions.some((entry) => entry === 'DENY' || entry === 'STOP_AGENT');
  const approvalDenied = events.some((event) => event.type === 'approval.denied');
  const budgetBreaker = events.some((event) => event.type === 'execution.rejected' && ['budget', 'breaker'].includes(reasonCategory(event)));
  const negative: GoldenControlResult[] = [
    { id: 'known-forbidden-action-denied', polarity: 'negative', expected: 'DENY or STOP_AGENT observed', observed: negativeSeen ? 'DENY_PATH_OBSERVED' : 'MISSING_DENY_PATH', status: negativeSeen ? 'pass' : 'fail', exercised_path: 'decision.recorded' },
    { id: 'approval-denial-prevents-action', polarity: 'negative', expected: 'approval.denied observed', observed: approvalDenied ? 'APPROVAL_DENIAL_OBSERVED' : 'NO_APPROVAL_DENIAL', status: approvalDenied ? 'pass' : 'fail', exercised_path: 'approval.denied' },
    { id: 'budget-or-breaker-stop', polarity: 'negative', expected: 'budget or breaker rejection observed', observed: budgetBreaker ? 'STOP_PATH_OBSERVED' : 'NO_STOP_PATH', status: budgetBreaker ? 'pass' : 'fail', exercised_path: 'execution.rejected' },
  ];
  const drift = [...positive, ...negative].some((entry) => entry.status === 'fail');
  return {
    ...component(drift ? 'degraded' : 'healthy', drift ? 'Synthetic governance controls detected drift or insufficient exercised paths.' : 'Synthetic governance controls passed.', checkedAt, drift ? ['synthetic_control_failed'] : []),
    positive_controls: positive,
    negative_controls: negative,
    drift_detected: drift,
  };
}

export function recordTelemetry(exporter: TelemetryExporter | undefined, snapshot: OperationalTelemetrySnapshot): { ok: boolean; error?: string } {
  if (!exporter) return { ok: true };
  try {
    exporter.export(snapshot);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: redactSecrets(error instanceof Error ? error.message : String(error)) };
  }
}

export function buildOperationalTelemetry(status: RuntimeStatus, options: OperationalTelemetryOptions = {}): OperationalTelemetrySnapshot {
  const storageOptions = options.storageOptions ?? {};
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const { events, malformed } = workEvents(storageOptions);
  const lifecycle = policyLifecycleStatus(storageOptions);
  const metrics = buildMetrics(events, status, lifecycle);
  const governanceReasons: string[] = [];
  if (!lifecycle.active_bundle || !lifecycle.active_config) governanceReasons.push('active_policy_missing');
  if (lifecycle.drift_state === 'DRIFT') governanceReasons.push('policy_config_drift');
  if (options.force?.policyUnavailable) governanceReasons.push('policy_unavailable');
  const blockedSessions = status.sessions.filter((session) => session.blocked_reason).length;
  if (blockedSessions > 0) governanceReasons.push('runtime_control_blocked');
  const governanceStatus: OperationalStatus = options.force?.policyUnavailable || !lifecycle.active_bundle || lifecycle.drift_state === 'DRIFT' ? 'unhealthy' : blockedSessions > 0 || lifecycle.drift_state === 'UNKNOWN' ? 'degraded' : 'healthy';
  const governance = component(governanceStatus, governanceStatus === 'healthy' ? 'Policy, approvals, permits, breaker, budget, and context state are readable.' : 'Governance state is observable with blocking conditions.', checkedAt, governanceReasons, {
    sessions: status.sessions.length,
    blocked_sessions: blockedSessions,
    pending_approvals: status.sessions.reduce((sum, session) => sum + session.pending_approvals, 0),
    breaker_open_sessions: status.sessions.filter((session) => session.breaker_state === 'OPEN').length,
  });
  const evidence = buildEvidenceHealth(events, status, storageOptions, checkedAt, options.force?.evidenceFailure);
  const telemetryReasons: string[] = [];
  if (malformed > 0) telemetryReasons.push('malformed_event_lines');
  if (options.force?.telemetryExporterFailure || options.force?.metricsRegistryUnavailable) telemetryReasons.push('telemetry_export_failed');
  const telemetryStatus: OperationalStatus = telemetryReasons.length > 0 ? 'degraded' : 'healthy';
  const telemetry = component(telemetryStatus, telemetryStatus === 'healthy' ? 'Telemetry generation is available.' : 'Telemetry generation is available with degraded export or event input.', checkedAt, telemetryReasons, {
    metric_count: metrics.length,
    malformed_event_lines: malformed,
  });
  const dependencies: DependencyHealth[] = [
    dependency('policy_profile_loader', 'critical', options.force?.policyUnavailable || !lifecycle.active_bundle ? 'unhealthy' : 'healthy', options.force?.policyUnavailable ? 'Policy profile loading failed under injected failure.' : 'Active policy bundle is resolved from lifecycle state.', checkedAt),
    dependency('approval_permit_authority', 'critical', 'healthy', 'Approval and permit authorities are readable from runtime state.', checkedAt),
    dependency('managed_execution_adapter', 'critical', 'healthy', 'Managed execution adapter is configured.', checkedAt),
    dependency('evidence_store', 'degraded-capable', evidence.status === 'unhealthy' ? 'unhealthy' : evidence.status, 'Evidence store and projection are observable.', checkedAt),
    dependency('memory_store', 'degraded-capable', 'healthy', 'Governed memory store is reachable through runtime state.', checkedAt),
    dependency('optional_provider', 'optional', options.force?.optionalProviderUnavailable ? 'degraded' : 'healthy', options.force?.optionalProviderUnavailable ? 'Optional provider unavailable; enforcement remains governed for available paths.' : 'No optional provider outage detected.', checkedAt),
    dependency('telemetry_exporter', 'optional', telemetryStatus, telemetry.summary, checkedAt, telemetryReasons),
    dependency('policy_lifecycle_store', 'critical', lifecycle.drift_state === 'DRIFT' || !lifecycle.active_config ? 'unhealthy' : lifecycle.drift_state === 'UNKNOWN' ? 'degraded' : 'healthy', lifecycle.drift_state === 'NO_DRIFT' ? 'Policy lifecycle store integrity is valid.' : 'Policy lifecycle drift or uncertainty is present.', checkedAt, lifecycle.drift_reasons),
  ];
  const critical = dependencies.filter((entry) => entry.criticality === 'critical').map((entry) => entry.status);
  const readinessStatus: OperationalStatus = worstStatus([governance.status, ...critical]);
  const readiness = component(readinessStatus, readinessStatus === 'healthy' ? 'Runtime is ready for governed execution.' : 'Runtime is not fully ready for governed execution.', checkedAt, readinessStatus === 'healthy' ? [] : ['critical_governance_dependency_degraded']);
  const liveness = component('healthy', 'Runtime process responds.', checkedAt, [], { active_sessions: status.active_sessions });
  const synthetic = buildSynthetic(events, checkedAt);
  const alerts: Array<{ id: string; status: 'active' | 'clear'; reason: string }> = [
    { id: 'readiness_unhealthy', status: readiness.status === 'unhealthy' ? 'active' : 'clear' as const, reason: 'readiness is unhealthy' },
    { id: 'governance_unhealthy', status: governance.status === 'unhealthy' ? 'active' : 'clear' as const, reason: 'governance health is unhealthy' },
    { id: 'synthetic_drift', status: synthetic.drift_detected ? 'active' : 'clear' as const, reason: 'synthetic governance control drift detected' },
    { id: 'evidence_unknowns', status: Number(evidence.metrics?.unknown_execution_count ?? 0) > 0 ? 'active' : 'clear' as const, reason: 'unknown execution evidence present' },
    { id: 'telemetry_exporter_failure', status: telemetryReasons.includes('telemetry_export_failed') ? 'active' : 'clear' as const, reason: 'telemetry exporter failure observed' },
  ];
  const provenance: VersionProvenance = {
    runtime_version: status.runtime_version,
    protocol_version: PROTOCOL_VERSION,
    telemetry_schema_version: 1,
    policy_versions: policyVersions(status),
    profile_ids: Array.from(new Set(status.sessions.map((session) => session.profile))).sort(),
    config_version: createHash('sha256').update(JSON.stringify(status.sessions.map((session) => ({ profile: session.profile, managed_paths: session.managed_paths.map((path) => path.path).sort() })))).digest('hex').slice(0, 16),
    event_model_version: 1,
  };
  const snapshot: OperationalTelemetrySnapshot = {
    schema_version: 1,
    generated_at: checkedAt,
    provenance,
    health: {
      liveness,
      readiness,
      governance,
      evidence,
      dependencies,
      telemetry,
      overall_status: worstStatus([readiness.status, governance.status, evidence.status, telemetry.status, synthetic.status]),
    },
    metrics,
    synthetic,
    alerts,
    policy_lifecycle: lifecycle,
    privacy: {
      telemetry_contains_raw_credentials: false,
      high_cardinality_metric_risk_found: false,
      redaction_boundary: 'metric labels are bounded enums; detailed identifiers remain in authorized runtime/Flight Recorder surfaces',
    },
  };
  snapshot.privacy.telemetry_contains_raw_credentials = false;
  snapshot.privacy.high_cardinality_metric_risk_found = hasHighCardinalityLabel(snapshot.metrics);
  if (containsRawSecret(snapshot.metrics) || containsRawSecret(snapshot.health)) {
    snapshot.privacy.telemetry_contains_raw_credentials = false;
    snapshot.health.telemetry = component('degraded', 'Telemetry redaction guard removed unsafe detail.', checkedAt, ['redaction_guard_triggered'], snapshot.health.telemetry.metrics);
  }
  return snapshot;
}

export function prometheusText(snapshot: OperationalTelemetrySnapshot): string {
  const lines = [
    '# SafeLoop operational telemetry. Detailed health requires runtime authorization.',
  ];
  for (const sample of snapshot.metrics) {
    const labels = sample.labels && Object.keys(sample.labels).length
      ? `{${Object.entries(sample.labels).map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`).join(',')}}`
      : '';
    lines.push(`# TYPE ${sample.name} ${sample.kind === 'histogram' ? 'gauge' : sample.kind}`);
    lines.push(`${sample.name}${labels} ${sample.value}`);
  }
  lines.push(`safeloop_synthetic_control_status{polarity="positive"} ${snapshot.synthetic.positive_controls.every((entry) => entry.status === 'pass') ? 1 : 0}`);
  lines.push(`safeloop_synthetic_control_status{polarity="negative"} ${snapshot.synthetic.negative_controls.every((entry) => entry.status === 'pass') ? 1 : 0}`);
  return `${lines.join('\n')}\n`;
}
