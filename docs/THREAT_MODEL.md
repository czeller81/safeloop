# Threat Model

SafeLoop is a cooperative local-first governance layer. It is designed to mediate agent actions that route through SafeLoop, record evidence, and make bypasses easier to detect.

## In Scope

- policy bypass attempts through command routing
- approval bypass for guarded actions
- approval replay, token forgery, token expiry, revocation, and context mismatch
- policy engine failure for high-risk actions
- scenario drift
- repeated tool calls and loops
- cost/token budget overruns
- malformed event lines
- ledger tampering after sealing
- unverified evidence claims
- evidence tampering after hash capture
- unsafe durable memory writes
- memory poisoning attempts
- identity spoofing through self-reported agent metadata
- tenant boundary mistakes in scenario contracts
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
- HMAC-signed approval tokens
- fail-closed policy wrapper
- artifact hash verification and evidence promotion rules

## Remaining Risks

- Connectors must opt in to runtime policy evaluation.
- Approval persistence and expiration are intentionally basic.
- Approval tokens are in-memory and session-scoped.
- Event identity is locally generated and can be spoofed by a malicious local writer.
- Tenant isolation is policy/context based, not an authenticated multi-tenant service boundary.
- Ledger seals detect post-seal changes but do not prevent writes.
- Dashboard visibility depends on local event quality.
- `npm audit` currently reports dependency advisories that should be remediated before broader production distribution.
