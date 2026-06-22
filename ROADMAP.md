# Safeloop Roadmap

## Completed

* ✓ v0.1 Case Files
* ✓ v0.2 Attachments
* ✓ v0.3 Agent Identity
* ✓ v0.4 Handoff Manifest
* ✓ v0.5 Query Layer
* ✓ v0.6 Agent Adapter Protocol
* ✓ v0.7 Live Loop Monitor + Cost & Steering Intelligence
* ✓ v0.8 Oversight Intelligence + Live Agent Activity

## Planned

* □ v0.8.x live dashboard refinements
* □ v0.9 hard-stop guardrails / pause before next model call
* □ v1.0 Agent Collaboration Protocol

## Product Direction

Safeloop is evolving from a local governance SDK into a local-first Agent Accountability + Handoff SDK.

It should remain:

* lightweight
* local-first
* file-based
* TypeScript-native
* compatible with Hermes, OpenCode, Claude Code, Codex, Replit Agents, and custom workflows

Do not add:

* cloud services
* auth
* hosted dashboards with external hosting
* databases
* hosted observability

Notes on next work

- v0.8.x: live dashboard refinements (polish live activity, handoff reconciliation, token-cost alerts)
- v0.9: hard-stop guardrails and operator approval flows
- v1.0: formal agent collaboration protocol and exchange formats
