# Changelog

All notable changes to this project will be documented in this file.

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
