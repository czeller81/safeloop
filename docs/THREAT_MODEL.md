# Threat Model

SafeLoop is a cooperative local-first governance layer. It is designed to mediate agent actions that route through SafeLoop, record evidence, and make bypasses easier to detect.

## In Scope

- policy bypass attempts through command routing
- approval bypass for guarded actions
- scenario drift
- repeated tool calls and loops
- cost/token budget overruns
- malformed event lines
- ledger tampering after sealing
- unverified evidence claims
- unsafe durable memory writes
- MCP and connector boundary clarity

## Out of Scope Without Additional Controls

- OS-level process isolation
- network firewalling
- kernel-level filesystem controls
- direct private agent tools that do not call SafeLoop
- direct API calls that bypass a SafeLoop adapter
- direct publishing, messaging, deployment, or payment tools that bypass SafeLoop

Use OS sandboxing, least-privilege accounts, local firewall rules, endpoint controls, and network isolation for non-cooperative containment.

## High-Value Controls Already Present

- command guard blocks or holds commands before execution
- MCP gateway routes command checks and execution
- specialist permission checks
- effect guard adapter coverage diagnostics
- local policy config and doctor checks
- malformed JSONL tolerance
- ledger seal and verify
- runtime policy decisions
- runtime circuit breaker
- memory verification API

## Remaining Risks

- Connectors must opt in to runtime policy evaluation.
- Approval persistence and expiration are intentionally basic.
- Event identity is locally generated and can be spoofed by a malicious local writer.
- Ledger seals detect post-seal changes but do not prevent writes.
- Dashboard visibility depends on local event quality.
