# Changelog

All notable changes to this project will be documented in this file.

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

- Breaker runtime supervision for agent loops
- Policy gating before execution
- Action ledger recording for review and auditability
- Markdown reports for human-readable run summaries
