# SafeLoop Roadmap

## Current 0.1.x Line

SafeLoop is staying on the `0.1.x` release line while the repository is hardened, documented, and made easier to adopt.

Implemented work on the current branch includes:

- Case files, attachments, agent identity, handoff manifests, and query helpers
- Local event ledger with malformed JSONL tolerance
- Command guard and circuit-breaker controls
- Scenario loop proof
- MCP command gateway and stdio server
- MCP diagnostics for Hermes and MCPorter troubleshooting
- Specialist governance and effect guard coverage
- Trace-first local dashboard
- Token, cost, timecard, approval, risk, and evidence visibility
- Ledger seal and verification

## Planned

- Stronger connector install and verification workflows
- Async approval resume for scenario loops
- K-12/local RAG appliance hardening profile
- Offline deployment diagnostics for Hermes plus SafeLoop
- Clearer policy profiles for education, enterprise, and local developer use
- Exportable audit bundles for reviews and incident response
- Formal agent collaboration protocol and exchange formats

## K-12 / Local RAG Hardening

SafeLoop should support local AI appliances used by schools and districts for internal document retrieval and governed agent work.

Planned hardening areas:

- Appliance readiness check for network, storage, and MCP configuration
- Hermes profile that detects whether unmanaged raw command tools are still exposed
- Additional policy profiles for document ingestion, exports, deletes, network actions, removable media, and vector database resets
- Audit bundle export for district review
- Backup and ledger verification checks
- Additional docs for offline updates, NAS/SAN storage, retention, and incident response

## Product Direction

SafeLoop is a local-first agent governance and accountability layer. It should stay focused on deterministic identity, authorization, approvals, risk controls, audit trails, evidence, and execution boundaries around AI agents.

It should remain:

- lightweight
- local-first
- file-based
- TypeScript-native
- compatible with Hermes, OpenCode, Claude Code, Codex, Replit Agents, and custom workflows

Do not add:

- required cloud services
- hosted observability
- external telemetry
- hosted auth as a core requirement
- database requirements for the core SDK

## Notes on Next Work

- 0.1.x: documentation, repository polish, local deployment hardening, and MCP setup reliability
- Next minor line: connector hardening, approval resume, K-12/local RAG deployment diagnostics, and clearer policy configuration
- v1.0: formal agent collaboration protocol and exchange formats
