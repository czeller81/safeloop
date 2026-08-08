# Changelog

All notable changes to this project will be documented in this file.

## 0.2.0 - Local Runtime Governance (unreleased, pending human merge approval)

SafeLoop becomes a local runtime governance layer for autonomous AI agents. The
defining change: for managed paths, the thing that decides and the thing that
acts are now the same thing.

### Added

- `safeloop.runtime.v1` protocol: 26 JSON Schema contracts under `protocol/schemas/`.
- Deterministic canonical action model and SHA-256 action fingerprints.
- Bound approvals: HMAC-signed, action-bound, single-use, atomically redeemed
  for an execution permit.
- Execution permits: the only authorization a managed executor accepts.
- Local runtime daemon on loopback HTTP plus a unix socket, with two-layer
  authentication and graceful shutdown.
- Managed executors for shell, filesystem, git (24 structured operations), HTTP,
  and downstream MCP.
- Memory candidate fingerprints, persistence permits, and provenance records.
- Reference governed memory store for conformance.
- Four data-driven governance profiles: coding, research, assistant, strict-local.
- MANAGED / UNMANAGED / DISABLED path model; an enabled consequential UNMANAGED
  path prevents full-profile certification.
- `safeloop daemon`, `safeloop run -- <agent>`, `safeloop status`,
  `safeloop certify`, `safeloop profiles`, `safeloop init --agent`.
- Conformance suite: 34 checks, applicability-aware, human and JSON output.
- TypeScript runtime SDK and a first-class Python adapter SDK.
- Adversarial test suite and a live Hermes bound-approval proof.

### Changed

- Hermes reference adapter migrated from adapter-level approved-context to bound
  approval tokens, and from decision-only governance to SafeLoop-performed
  execution for managed families.
- Budgets and circuit breakers are admission control at the executor call site
  rather than inputs to a risk score.

### Fixed

- **Approval double-spend.** The approval state store did read-modify-write on a
  shared JSON file, so two concurrent redemptions could both succeed. Claims are
  now made by exclusive file create, atomic across processes.
- **Memory TOCTOU.** A decision did not bind to the candidate it governed, so a
  safe candidate could be approved and a modified one persisted.
- **Profile default disposition.** `default_disposition` seeded the
  most-severe-wins reduce, so a restrictive default swallowed every ALLOW rule
  beneath it. It now applies only when no rule matches.

### Security

- Runtime signing secret is generated, stored `0600`, and never appears in any
  payload, event, log line, or error message.
- SafeLoop trust variables are stripped from child process environments.
- Captured output is secret-redacted and size-bounded before reaching evidence.
- Raw credentials in HTTP headers are refused in favour of credential references.
- No new runtime dependencies were added.

### Boundary

SafeLoop governs actions routed through SafeLoop-managed execution paths. It is
not a kernel security module, EDR, antivirus, firewall, IAM system, universal
syscall interceptor, arbitrary process container, or OS sandbox.

## Current branch - unreleased

This branch consolidates SafeLoop as a local-first agent governance and accountability layer.

### Added

- MCP stdio server support for `safeloop.checkCommand`, `safeloop.runCommand`, `safeloop.recordActivity`, and `safeloop.status`.
- MCP command gateway with specialist-aware command checks and guarded execution.
- Specialist governance APIs for deterministic routing, tool validation, context-bound delegation, review validation, and effect guard coverage.
- CommandGuard process diagnostics including `stdout`, `stderr`, `exitCode`, `signal`, `cwd`, `durationMs`, `timedOut`, `spawnError`, and `failureKind`.
- Trace-first local dashboard shell with Decision Inspector, governance strip, operational diagnostics, timecard/cost visibility, and malformed JSONL tolerance.
- Local Codex-governed workflow demo that proves allow, review, block, specialist-denied, and effect-guard-denied paths without fake OpenAI API integration.
- Local policy config and CLI commands: `safeloop init`, `safeloop check`, and `safeloop run`.
- Sidecar ledger integrity commands: `safeloop ledger seal` and `safeloop ledger verify`.
- MCP usability commands: `safeloop mcp serve`, `safeloop mcp doctor`, `safeloop mcp print-config hermes`, and `safeloop mcp mcporter`.
- Approval-aware `CommandGuard` execution with context-bound approval token redemption before guarded command execution.
- Governed memory adapter behavior for allow, TTL, merge, quarantine, review, and reject decisions.
- Handoff governance checks that prevent delegated work from widening inherited command or target authority.
- Native Python client tests and development setup instructions.

### Notes

- SafeLoop remains a cooperative local governance layer, not an OS-level sandbox.
- Current branch verification has 56 Jest suites / 394 Jest tests plus 13 Python tests passing locally.
- `npm audit --audit-level=moderate` reports 0 vulnerabilities after dependency remediation.
- No npm publish, GitHub release, tag, merge, or production website deployment has been performed by this changelog update.

## v0.7.0

Safeloop v0.7.0 adds the local live loop monitor, event stream, cost tracking, steering intelligence, goal drift detection, and release readiness scoring.

## v0.8.0 - Oversight Intelligence (v0.8.0)

v0.8.0 introduces the Oversight Intelligence Layer and a first Live Agent Activity + Handoff Flow feature slice. Key additions center on visibility and accountability for agent loops:

### Added

- Oversight Intelligence: loop timecards with oversight scoring, proactive warnings, anomaly detection, explainability coverage, feedback events, and recommended actions.
- Live Agent Activity + Handoff Flow (monitor slice): active agents, recent activity stream, handoff-to-handoff flow, and token-cost pulse.
- `appendEvent`, `readEvents`, `streamEvents`, `recordModelUsage`, `setModelPricing`, `calculateCost`, `getCaseCostSummary` (model usage & cost primitives).
- `recordSteeringProfile`, `compareSteeringRuns`, `detectGoalDrift`, `calculateReadinessScore` (steering & readiness primitives).
- Live monitor CLI and dashboard API: viewModel now exposes `oversight` and `liveActivity` slices for UI clients.

### Notes

- v0.8.0 focuses on visualization and reporting: it warns, scores, and visualizes loops and handoffs but does not enforce hard stops.
- The Live Agent Activity panel is a first, reversible slice to make the monitor feel alive. Hard-stop enforcement is planned for v0.9.

## v0.6.0 - Previous

Safeloop v0.6.0 introduced the Agent Adapter Protocol and the current accountability + handoff surface.

### Added

- `createAgentSession`
- `processAgentEvent`
- `querySafeloop`
- `createCaseFile`
- `generateHandoffManifest`
- `exportAgentSessionMarkdown`
- `exportAgentSessionJSON`
- `exportSafeloopQueryMarkdown`
- `exportSafeloopQueryJSON`

### Notes

- Portable Case Files now cover participants, attachments, approvals, risks, and handoffs
- Query reports now include safety-summary, release-readiness, governance-audit, and evidence-summary flows
- The protocol remains local-first and explicit

## v0.1.0 - Unreleased

Initial public launch candidate for the local AI agent governance SDK.

### Added

- `createBreaker`
- `BREAKER_PRESETS`
- `createCodingAgentBreaker`
- `toMarkdownReport`
- `createAgentRunLedger`
- `createPolicyGate`
- `live simulation harness in `examples/breaker-live-simulation.ts`

### Notes

- GitHub v0.1.0 release completed
- npm publish completed: `safeloop@0.1.0`
- Final npm registry install test passed
- External consumer test verified Policy Gate, Action Ledger, Circuit Breaker reports, token usage reporting, and no undefined/crashes
- Breaker runtime supervision for agent loops
- Policy gating before execution
- Action ledger recording for review and auditability
- Markdown reports for human-readable run summaries
