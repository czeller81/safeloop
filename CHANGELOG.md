# Changelog

All notable changes to this project will be documented in this file.

## v0.7.0 - Current

Safeloop v0.7.0 adds the local live loop monitor, event stream, cost tracking, steering intelligence, goal drift detection, and release readiness scoring.

### Added

- `appendEvent`
- `readEvents`
- `streamEvents`
- `recordModelUsage`
- `setModelPricing`
- `calculateCost`
- `getCaseCostSummary`
- `recordSteeringProfile`
- `compareSteeringRuns`
- `detectGoalDrift`
- `calculateReadinessScore`
- live monitor CLI and dashboard API

### Notes

- Safeloop remains local-first and file-based
- Safeloop still records only explicit events
- No telemetry, conversation capture, or remote control was added

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
- live simulation harness in `examples/breaker-live-simulation.ts`
- `npm run example:live-simulation`

### Notes

- GitHub v0.1.0 release completed
- npm publish completed: `safeloop@0.1.0`
- Final npm registry install test passed
- External consumer test verified Policy Gate, Action Ledger, Circuit Breaker reports, token usage reporting, and no undefined/crashes
- Breaker runtime supervision for agent loops
- Policy gating before execution
- Action ledger recording for review and auditability
- Markdown reports for human-readable run summaries
