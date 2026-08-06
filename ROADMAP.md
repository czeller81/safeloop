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
* ✓ v0.8.x Command Guard, MCP stdio, specialist governance, effect guard coverage, trace-first dashboard

## Planned

* □ v0.9 stronger connector install/verification workflows
* □ v0.9 async approval resume for scenario loops
* □ v1.0 Agent Collaboration Protocol

## Product Direction

SafeLoop is a local-first agent governance and accountability layer. It should stay focused on putting deterministic identity, authorization, approvals, risk controls, audit trails, evidence, and execution boundaries around AI agents.

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

- v0.8.x: docs/current-state consolidation and local demo hardening
- v0.9: connector hardening, approval resume, and clearer policy configuration
- v1.0: formal agent collaboration protocol and exchange formats
