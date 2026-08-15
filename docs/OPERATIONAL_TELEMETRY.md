# SafeLoop Operational Telemetry and Health

SafeLoop Phase 5 adds read-only operational telemetry around the governed runtime. Telemetry observes SafeLoop; telemetry does not decide governance outcomes. A telemetry backend outage must not silently weaken SafeLoop enforcement.

## Health Model

The runtime health model is not a single boolean.

- `liveness`: the process responds to a lightweight request.
- `readiness`: critical governance dependencies are available for governed execution.
- `governance`: policy profile state, approval/permit authorities, managed execution, breaker/budget state, and execution-context binding are readable.
- `evidence`: Flight Recorder projection, execution proof states, missing references, prevention conflicts, and UNKNOWN evidence counts are observable.
- `dependencies`: components are classified as `critical`, `optional`, or `degraded-capable`.
- `telemetry`: metric generation and exporter status are observable.
- `overall_status`: the worst relevant health state after readiness, governance, evidence, telemetry, and synthetic controls.

Statuses are `healthy`, `degraded`, `unhealthy`, or `unknown`.

Public liveness is available at `/health` and `/health/live`. Detailed health and metrics require the runtime bearer credential:

- `/health/ready`
- `/health/governance`
- `/health/evidence`
- `/health/dependencies`
- `/health/telemetry`
- `/v1/health`
- `/v1/metrics`

## Metrics

SafeLoop uses a vendor-neutral internal metric representation. Current metric names include:

- `safeloop_governance_decisions_total`
- `safeloop_approval_events_total`
- `safeloop_permit_events_total`
- `safeloop_managed_executions_total`
- `safeloop_execution_duration_ms`
- `safeloop_execution_rejections_total`
- `safeloop_evidence_verification_total`
- `safeloop_evidence_events_total`
- `safeloop_active_sessions`
- `safeloop_pending_approvals`
- `safeloop_breaker_open_sessions`
- `safeloop_budget_remaining_actions`
- `safeloop_synthetic_control_status`

Labels are intentionally bounded. Allowed labels are `component`, `operation`, `outcome`, `status`, `provider`, `reason_category`, `verification_status`, and `polarity`. Raw session IDs, event IDs, task text, URLs, artifact paths, prompts, and raw errors do not belong in metric labels.

## Golden Signals

- Latency: managed execution duration samples.
- Traffic: governance decisions, approvals, permits, managed executions, evidence events, session/activity gauges.
- Errors: policy denials, approval denials, execution rejections, failed execution outcomes, failed verification states.
- Saturation: active sessions, pending approvals, breaker-open sessions, remaining action budget.

## Synthetic Governance Controls

The synthetic controls are deterministic regression controls, not a model benchmark. Positive controls check that an allowed governed action, permit issuance, and evidence path are observed. Negative controls check that denial, approval denial, and budget/breaker stop paths are observed.

If a required control path is absent, the synthetic report marks drift as detected. It does not perform remediation and does not change policy behavior.

## Version Provenance

Operational snapshots include runtime version, protocol version, telemetry schema version, policy/profile identifiers, a bounded config hash, and event model version. This is complete for the supported provenance set; it is not a claim about unknown external systems.

## Failure Isolation

Telemetry exporter failures are recorded as telemetry degradation. They do not convert a policy decision to ALLOW or DENY and do not crash the runtime governance path. Unless a deployment has an explicit policy requiring evidence persistence before execution, Phase 5 does not invent that behavior.

## Security and Privacy

Telemetry is treated as a possible exfiltration surface. Operational metrics and health summaries are redacted and bounded. Detailed identifiers stay in authorized runtime and Flight Recorder surfaces.

The telemetry layer must not emit raw values matching credential patterns such as bearer tokens, passwords, API keys, client secrets, AWS secret keys, URL userinfo, private keys, or session credentials.

## Boundaries

SafeLoop governs routed and managed execution paths. Shell proof does not prove every downstream side effect. HTTP proof covers the transaction, not the remote business outcome. MCP proof covers the call and result, not downstream side effects.
